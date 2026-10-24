import { createHash } from 'node:crypto';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import type { OciArtifactReference } from '@ott/job-contract';
import type { BotPort } from '@ott/match-runner';
import { CoreGameAdapter, runMatch, serializeEventLog, verifyReplay } from '@ott/match-runner';
import type { Database, ObjectStorage } from '@ott/platform-api';
import { completeTestRun, failTestRun, findMapByChecksum, type TestRunRecord } from '@ott/platform-api';
import { SANDBOX_POLICY_V1, resolveSandboxPolicy, type SandboxPolicy } from './sandbox/policy.ts';
import { SandboxOciBotPort } from './sandbox/oci-bot-port.ts';
import { defaultWorkerMetrics, type WorkerMetrics } from './metrics.ts';

export interface RunTestJobOptions {
  readonly testRunId: string;
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly policy?: SandboxPolicy;
  readonly metrics?: WorkerMetrics;
  readonly createBotPort?: (
    archive: Uint8Array,
    reference: OciArtifactReference,
    entrypoint: readonly string[],
    policy?: SandboxPolicy,
  ) => BotPort | Promise<BotPort>;
  readonly getReferenceBot?: (botName: string) => Promise<{
    archive: Uint8Array;
    reference: OciArtifactReference;
    entrypoint: readonly string[];
  }>;
}

export interface RunTestJobResult {
  readonly alreadyFinished: boolean;
  readonly outcome?: import('@ott/game-core').GameResult;
  readonly replayKey?: string;
  readonly isInfraFailure?: boolean;
}

function archiveChecksum(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function defaultBotPort(
  archive: Uint8Array,
  reference: OciArtifactReference,
  entrypoint: readonly string[],
  policy?: SandboxPolicy,
): BotPort {
  return new SandboxOciBotPort({ archive, reference, expectedEntrypoint: entrypoint, ...(policy ? { policy } : {}) });
}

interface TestRunJoinedRow {
  readonly id: string;
  readonly team_id: string;
  readonly status: string;
  readonly submission_id: string;
  readonly opponent_type: 'BTC_REFERENCE' | 'OWN_SUBMISSION';
  readonly opponent_submission_id: string | null;
  readonly opponent_reference_bot: string | null;
  readonly seed: string;
  readonly map_checksum?: string;
  readonly sub_object_key: string;
  readonly sub_archive_sha256: string;
  readonly sub_manifest_digest: string;
  readonly sub_config_digest: string;
  readonly sub_entrypoint: string | readonly string[];
  readonly sub_policy_version: string;
}

/**
 * Executes a test-run job with low priority, isolated artifacts,
 * and automatic quota refunding on infrastructure failure.
 * Never touches rating ledger.
 */
export async function runTestJob(options: RunTestJobOptions): Promise<RunTestJobResult> {
  const { testRunId, database, storage } = options;

  // 1. Fetch test run details and primary submission metadata
  const queryRes = await database.query<TestRunJoinedRow>(
    `SELECT tr.id, tr.team_id, tr.status, tr.submission_id, tr.opponent_type,
            tr.opponent_submission_id, tr.opponent_reference_bot, tr.seed,
            tr.map_checksum,
            s.object_key as sub_object_key,
            s.archive_sha256 as sub_archive_sha256,
            s.oci_manifest_digest as sub_manifest_digest,
            s.oci_config_digest as sub_config_digest,
            s.entrypoint as sub_entrypoint,
            s.policy_version as sub_policy_version
     FROM test_runs tr
     JOIN submissions s ON s.id = tr.submission_id
     WHERE tr.id = $1`,
    [testRunId],
  );

  const testRun = queryRes.rows[0];
  if (!testRun) {
    throw new Error('TEST_RUN_NOT_FOUND');
  }

  if (testRun.status === 'COMPLETED' || testRun.status === 'CANCELLED') {
    return { alreadyFinished: true };
  }

  // Claim exactly once and consume quota when execution starts.
  const claim = async (tx: Database) => {
    const claimed = await tx.query<{ id: string }>(
      `UPDATE test_runs SET status = 'RUNNING', started_at = now(), quota_consumed = TRUE
       WHERE id = $1 AND status = 'QUEUED' RETURNING id`, [testRunId],
    );
    return claimed.rows.length > 0;
  };
  const didClaim = typeof database.transaction === 'function'
    ? await database.transaction(claim)
    : await claim(database);
  if (!didClaim) return { alreadyFinished: true };

  const effectivePolicy = options.policy ?? resolveSandboxPolicy(testRun.sub_policy_version);
  const factory = options.createBotPort ?? defaultBotPort;
  const metrics = options.metrics ?? defaultWorkerMetrics;

  try {
    // 3. Load primary submission archive
    const archiveX = await storage.get(testRun.sub_object_key);
    if (archiveChecksum(archiveX) !== testRun.sub_archive_sha256) {
      throw new Error('SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH');
    }

    const entrypointX = Array.isArray(testRun.sub_entrypoint)
      ? testRun.sub_entrypoint
      : JSON.parse(testRun.sub_entrypoint as string);

    const refX: OciArtifactReference = {
      submissionId: testRun.submission_id,
      archiveSha256: testRun.sub_archive_sha256,
      manifestDigest: testRun.sub_manifest_digest,
      configDigest: testRun.sub_config_digest,
      policyVersion: effectivePolicy.version,
    };

    // 4. Load opponent archive (either reference bot or team's own other submission)
    let archiveO: Uint8Array;
    let entrypointO: readonly string[];
    let refO: OciArtifactReference;

    if (testRun.opponent_type === 'BTC_REFERENCE') {
      const getRef = options.getReferenceBot ?? (async (botId: string) => {
        const found = await database.query<{
          id: string;
          object_key: string;
          archive_sha256: string;
          manifest_digest: string;
          config_digest: string;
          entrypoint: string | readonly string[];
          policy_version: string;
        }>(
          `SELECT id, object_key, archive_sha256, manifest_digest, config_digest, entrypoint, policy_version
           FROM test_run_reference_bots WHERE id = $1 AND enabled = TRUE`,
          [botId],
        );
        const row = found.rows[0];
        if (!row) throw new Error('REFERENCE_BOT_UNAVAILABLE');
        let refPolicy: SandboxPolicy;
        try {
          refPolicy = resolveSandboxPolicy(row.policy_version);
        } catch {
          throw new Error('REFERENCE_BOT_POLICY_MISMATCH');
        }
        if (refPolicy.version !== effectivePolicy.version) {
          throw new Error('REFERENCE_BOT_POLICY_MISMATCH');
        }
        const entrypoint = Array.isArray(row.entrypoint)
          ? row.entrypoint
          : (JSON.parse(row.entrypoint as string) as string[]);
        return {
          archive: await storage.get(row.object_key),
          entrypoint,
          reference: {
            submissionId: `reference:${row.id}`,
            archiveSha256: row.archive_sha256,
            manifestDigest: row.manifest_digest,
            configDigest: row.config_digest,
            policyVersion: effectivePolicy.version,
          },
        };
      });
      if (!testRun.opponent_reference_bot) {
        throw new Error('REFERENCE_BOT_UNAVAILABLE');
      }
      const refBot = await getRef(testRun.opponent_reference_bot);
      archiveO = refBot.archive;
      if (archiveChecksum(archiveO) !== refBot.reference.archiveSha256) {
        throw new Error('OPPONENT_ARCHIVE_CHECKSUM_MISMATCH');
      }
      if (refBot.reference.policyVersion !== effectivePolicy.version) {
        try {
          const resolved = resolveSandboxPolicy(refBot.reference.policyVersion);
          if (resolved.version !== effectivePolicy.version) {
            throw new Error('REFERENCE_BOT_POLICY_MISMATCH');
          }
        } catch {
          throw new Error('REFERENCE_BOT_POLICY_MISMATCH');
        }
      }
      entrypointO = refBot.entrypoint;
      refO = {
        ...refBot.reference,
        policyVersion: effectivePolicy.version,
      };
    } else {
      // OWN_SUBMISSION
      const oppSubRes = await database.query<{
        object_key: string;
        archive_sha256: string;
        oci_manifest_digest: string;
        oci_config_digest: string;
        entrypoint: string | readonly string[];
      }>(
        `SELECT object_key, archive_sha256, oci_manifest_digest, oci_config_digest, entrypoint
         FROM submissions
         WHERE id = $1 AND team_id = $2`,
        [testRun.opponent_submission_id, testRun.team_id],
      );

      const oppSub = oppSubRes.rows[0];
      if (!oppSub) {
        throw new Error('OPPONENT_SUBMISSION_NOT_FOUND');
      }

      archiveO = await storage.get(oppSub.object_key);
      if (archiveChecksum(archiveO) !== oppSub.archive_sha256) {
        throw new Error('OPPONENT_ARCHIVE_CHECKSUM_MISMATCH');
      }

      entrypointO = Array.isArray(oppSub.entrypoint)
        ? oppSub.entrypoint
        : JSON.parse(oppSub.entrypoint as string);

      refO = {
        submissionId: testRun.opponent_submission_id!,
        archiveSha256: oppSub.archive_sha256,
        manifestDigest: oppSub.oci_manifest_digest,
        configDigest: oppSub.oci_config_digest,
        policyVersion: effectivePolicy.version,
      };
    }

    // 4b. Resolve map definition from map_checksum
    let effectiveMap: import('@ott/game-core').MapDefinition;
    if (!testRun.map_checksum || testRun.map_checksum === 'test_map_default') {
      effectiveMap = DEFAULT_MAP;
    } else {
      const registered = findMapByChecksum(testRun.map_checksum);
      if (!registered) {
        throw new Error('MAP_UNKNOWN');
      }
      effectiveMap = registered.definition;
    }

    // 5. Instantiate bot ports
    const [botX, botO] = await Promise.all([
      factory(archiveX, refX, entrypointX, effectivePolicy),
      factory(archiveO, refO, entrypointO, effectivePolicy),
    ]);

    // 6. Execute match through MatchRunner
    const report = await runMatch(
      {
        matchId: testRun.id,
        seed: testRun.seed,
        game: {
          gameId: testRun.id,
          engineVersion: '1.0.0',
          map: effectiveMap,
          maxTurns: 100,
        },
        limits: { ...DEFAULT_LIMITS, maxTurns: 100 },
      },
      {
        game: new CoreGameAdapter(),
        bots: { X: botX, O: botO },
      },
    );

    // 7. Save replay event log to storage
    const replayKey = `replays/test-runs/${testRun.id}.json`;
    const replayVerdict = verifyReplay(report.log, new CoreGameAdapter());
    if (!replayVerdict.ok) throw new Error('REPLAY_INTEGRITY_FAILED');
    const replayBytes = new TextEncoder().encode(serializeEventLog(report.log));
    const replaySha256 = `sha256:${createHash('sha256').update(replayBytes).digest('hex')}`;
    await storage.put(replayKey, replayBytes);

    // 8. Complete test run in database
    await completeTestRun(database, {
      testRunId: testRun.id,
      result: {
        ...(report.result as unknown as Record<string, unknown>),
        mapId: effectiveMap.mapId,
        mapChecksum: effectiveMap.checksum,
      },
      replayKey,
      replaySha256,
      finalStateHash: report.log.footer.result.finalStateHash,
    });

    metrics.recordAttempt({
      matchId: testRun.id,
      status: report.result.reason === 'FORFEIT' ? 'forfeit' : 'completed',
      reason: report.result.reason,
      policyVersion: testRun.sub_policy_version,
    });

    return {
      alreadyFinished: false,
      outcome: report.result,
      replayKey,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TEST_RUN_EXECUTION_FAILED';
    const isInfra = isInfrastructureFailure(message);

    // If infrastructure failure: quota is refunded automatically in failTestRun
    await failTestRun(database, {
      testRunId: testRun.id,
      failureReason: message,
      isInfraFailure: isInfra,
    });

    metrics.recordAttempt({
      matchId: testRun.id,
      status: 'failed',
      reason: message,
      policyVersion: testRun.sub_policy_version,
    });

    return {
      alreadyFinished: false,
      isInfraFailure: isInfra,
    };
  }
}

function isInfrastructureFailure(message: string): boolean {
  const infraErrors = [
    'SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH',
    'OPPONENT_ARCHIVE_CHECKSUM_MISMATCH',
    'STORAGE_UNAVAILABLE',
    'DATABASE_TIMEOUT',
    'WORKER_CRASH',
    'OBJECT_NOT_FOUND',
    'REFERENCE_BOT_UNAVAILABLE',
    'REFERENCE_BOT_POLICY_MISMATCH',
    'REPLAY_INTEGRITY_FAILED',
  ];
  return infraErrors.some((code) => message.includes(code));
}
