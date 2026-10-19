import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import type { OciArtifactReference } from '@ott/job-contract';
import { CoreGameAdapter } from '@ott/match-runner';
import {
  checkDuplicateSubmission,
  recordSubmissionLayers,
  type Database,
  type ObjectStorage,
} from '@ott/platform-api';
import { extractOciLayersFromArchive } from './artifacts.ts';
import { pingDocker } from './runtime/server.ts';
import { SandboxOciBotPort } from './sandbox/oci-bot-port.ts';
import { SANDBOX_POLICY_V1 } from './sandbox/policy.ts';

const PLATFORM_POLICY_VERSION = 'P2_BASELINE_V1';

interface SubmissionRow {
  readonly id: string;
  readonly team_id: string;
  readonly tournament_stage: string;
  readonly status: string;
  readonly archive_sha256: string;
  readonly oci_manifest_digest: string;
  readonly oci_config_digest: string;
  readonly entrypoint: unknown;
  readonly object_key: string;
  readonly policy_version: string;
}

export interface PreflightSubmissionOptions {
  readonly submissionId: string;
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly dockerReachable?: () => Promise<boolean>;
  readonly dockerSocketPath?: string | undefined;
  readonly createBotPort?: (options: {
    readonly archive: Uint8Array;
    readonly reference: OciArtifactReference;
    readonly expectedEntrypoint: readonly string[];
    readonly dockerSocketPath?: string;
  }) => {
    start: (msg: any) => Promise<{ ok: boolean; code?: string }>;
    requestAction: (msg: any, timeoutMs: number) => Promise<{ ok: boolean; code?: string }>;
    stop: () => Promise<void>;
  };
  readonly extractLayers?: typeof extractOciLayersFromArchive;
  readonly recordLayers?: typeof recordSubmissionLayers;
  readonly checkDuplicate?: typeof checkDuplicateSubmission;
  readonly logger?: {
    warn: (msg: string, ...args: any[]) => void;
    info?: (msg: string, ...args: any[]) => void;
    error?: (msg: string, ...args: any[]) => void;
  };
}

export interface PreflightSubmissionResult {
  readonly submissionId: string;
  readonly status: 'ACTIVE';
  readonly replayed: boolean;
}

function entrypointOf(value: unknown): readonly string[] {
  const entrypoint = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(entrypoint) || entrypoint.length === 0
    || entrypoint.some((part) => typeof part !== 'string' || part.length === 0)) throw new Error('PREFLIGHT_ENTRYPOINT_INVALID');
  return entrypoint;
}

function stableErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
    ? error.message
    : 'PREFLIGHT_FAILED';
}

function publicState(state: ReturnType<import('@ott/match-runner').CoreGameAdapter['create']>) {
  return {
    schemaVersion: 1 as const,
    engineVersion: state.engineVersion,
    map: state.map,
    status: 'PLAYING' as const,
    turn: state.turn,
    turnNumber: state.turnNumber,
    turnCount: state.turnCount,
    revision: state.revision,
    maxTurns: state.maxTurns,
    pieces: state.pieces,
    outcome: null,
  };
}

async function executeProtocolSmokeTest(
  submission: SubmissionRow,
  storage: ObjectStorage,
  dockerReachable?: () => Promise<boolean>,
  dockerSocketPath?: string,
  createBotPort?: PreflightSubmissionOptions['createBotPort'],
): Promise<Uint8Array> {
  if (submission.policy_version !== PLATFORM_POLICY_VERSION) throw new Error('PREFLIGHT_POLICY_UNSUPPORTED');
  let archive: Uint8Array;
  try {
    archive = await storage.get(submission.object_key);
  } catch {
    throw new Error('PREFLIGHT_INFRA_STORAGE');
  }
  const archiveSha256 = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
  if (archiveSha256 !== submission.archive_sha256) throw new Error('PREFLIGHT_ARCHIVE_CHECKSUM_MISMATCH');
  const entrypoint = entrypointOf(submission.entrypoint);

  const checkDocker = dockerReachable ?? (() => pingDocker(dockerSocketPath ?? process.env.OTT_DOCKER_SOCKET ?? '/var/run/docker.sock'));
  const dockerAvailableBefore = await checkDocker().catch(() => false);
  if (!dockerAvailableBefore) {
    throw new Error('PREFLIGHT_INFRA_DOCKER');
  }

  const reference: OciArtifactReference = {
    submissionId: submission.id,
    archiveSha256: submission.archive_sha256,
    manifestDigest: submission.oci_manifest_digest,
    configDigest: submission.oci_config_digest,
    policyVersion: SANDBOX_POLICY_V1.version,
  };
  const matchId = `preflight-${randomUUID()}`;
  const portOptions = {
    archive,
    reference,
    expectedEntrypoint: entrypoint,
    ...(dockerSocketPath === undefined ? {} : { dockerSocketPath }),
  };
  const bot = createBotPort ? createBotPort(portOptions) : new SandboxOciBotPort(portOptions);
  const maxTurns = 2;
  const game = new CoreGameAdapter();
  const state = game.create({ gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns });
  try {
    const started = await bot.start({
      type: 'INIT', protocolVersion: 1, matchId, engineVersion: '1.0.0', side: 'X', seed: randomUUID(),
      map: DEFAULT_MAP, limits: { ...DEFAULT_LIMITS, maxTurns },
    });
    if (!started.ok) {
      if (started.code === 'BOT_SPAWN_FAILED') {
        const dockerStillReachable = await checkDocker().catch(() => false);
        if (!dockerStillReachable) {
          throw new Error('PREFLIGHT_INFRA_DOCKER');
        }
      }
      throw new Error(`PREFLIGHT_START_${started.code}`);
    }
    const actions = game.listLegalActions(state, 'X');
    if (actions.length === 0) throw new Error('PREFLIGHT_NO_LEGAL_ACTION');
    const reply = await bot.requestAction({
      type: 'STATE_UPDATE', protocolVersion: 1, matchId, turnId: 1,
      state: publicState(state), legalActions: actions,
    }, DEFAULT_LIMITS.turnTimeoutMs);
    if (!reply.ok) throw new Error(`PREFLIGHT_ACTION_${reply.code}`);
  } finally {
    await bot.stop();
  }
  return archive;
}

async function recordInvalid(database: Database, submissionId: string, reason: string): Promise<void> {
  await database.transaction(async (transaction) => {
    const changed = await transaction.query(
      "UPDATE submissions SET status = 'INVALID' WHERE id = $1 AND status = 'PREFLIGHT' RETURNING id",
      [submissionId],
    );
    if (changed.rowCount !== 1) return;
    await transaction.query(
      "INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason) VALUES ($1, NULL, 'SUBMISSION_PREFLIGHT_FAILED', 'SUBMISSION', $2, $3)",
      [randomUUID(), submissionId, reason],
    );
  });
}

async function activate(database: Database, submission: SubmissionRow): Promise<void> {
  await database.transaction(async (transaction) => {
    const locked = await transaction.query<{ readonly status: string }>(
      'SELECT status FROM submissions WHERE id = $1 FOR UPDATE', [submission.id],
    );
    const status = locked.rows[0]?.status;
    if (status === 'ACTIVE') return;
    if (status !== 'PREFLIGHT') throw new Error('PREFLIGHT_SUBMISSION_STATE_CONFLICT');
    await transaction.query(
      "UPDATE submissions SET status = 'SUPERSEDED' WHERE team_id = $1 AND tournament_stage = $2 AND status = 'ACTIVE'",
      [submission.team_id, submission.tournament_stage],
    );
    const validated = await transaction.query(
      "UPDATE submissions SET status = 'VALID' WHERE id = $1 AND status = 'PREFLIGHT' RETURNING id",
      [submission.id],
    );
    if (validated.rowCount !== 1) throw new Error('PREFLIGHT_SUBMISSION_STATE_CONFLICT');
    const activated = await transaction.query(
      "UPDATE submissions SET status = 'ACTIVE' WHERE id = $1 AND status = 'VALID' RETURNING id",
      [submission.id],
    );
    if (activated.rowCount !== 1) throw new Error('PREFLIGHT_SUBMISSION_STATE_CONFLICT');
    await transaction.query(
      "INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason) VALUES ($1, NULL, 'SUBMISSION_ACTIVATED', 'SUBMISSION', $2, 'sandbox protocol preflight passed')",
      [randomUUID(), submission.id],
    );
  });
}

/** Verify an uploaded OCI canary in the locked sandbox and activate its immutable identity. */
export async function preflightSubmission(options: PreflightSubmissionOptions): Promise<PreflightSubmissionResult> {
  const result = await options.database.query<SubmissionRow>(
    'SELECT id, team_id, tournament_stage, status, archive_sha256, oci_manifest_digest, oci_config_digest, entrypoint, object_key, policy_version FROM submissions WHERE id = $1',
    [options.submissionId],
  );
  const submission = result.rows[0];
  if (submission === undefined) throw new Error('PREFLIGHT_SUBMISSION_NOT_FOUND');
  if (submission.status === 'ACTIVE') return { submissionId: submission.id, status: 'ACTIVE', replayed: true };
  if (submission.status !== 'PREFLIGHT') throw new Error('PREFLIGHT_SUBMISSION_STATE_CONFLICT');

  try {
    const archive = await executeProtocolSmokeTest(
      submission,
      options.storage,
      options.dockerReachable,
      options.dockerSocketPath,
      options.createBotPort,
    );

    try {
      const extracted = (options.extractLayers ?? extractOciLayersFromArchive)(archive);
      await (options.recordLayers ?? recordSubmissionLayers)(options.database, {
        submissionId: submission.id,
        layers: extracted.layers.map((layer) => ({
          digest: layer.digest,
          mediaType: layer.mediaType,
          sizeBytes: layer.size,
          storageKey: `layers/sha256/${layer.digest.replace(/^sha256:/, '')}`,
          isBaseLayer: extracted.baseLayerDigests.includes(layer.digest),
        })),
      });
      await (options.checkDuplicate ?? checkDuplicateSubmission)(options.database, {
        submissionId: submission.id,
        teamId: submission.team_id,
        manifestDigest: extracted.manifestDigest,
        nonBaseLayerDigests: extracted.nonBaseLayerDigests,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const payload = {
        level: 'warn',
        message: 'duplicate check skipped',
        submissionId: submission.id,
        code,
      };
      if (options.logger?.warn) {
        options.logger.warn(JSON.stringify(payload));
      } else {
        console.warn(JSON.stringify(payload));
      }
    }

    await activate(options.database, submission);
    return { submissionId: submission.id, status: 'ACTIVE', replayed: false };
  } catch (error) {
    const reason = stableErrorCode(error);
    if (reason === 'PREFLIGHT_INFRA_DOCKER' || reason === 'PREFLIGHT_INFRA_STORAGE') {
      throw error;
    }
    await recordInvalid(options.database, submission.id, reason);
    throw new Error(reason);
  }
}
