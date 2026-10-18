import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { MatchJobV1 } from '@ott/job-contract';
import type { GameConfig, GameResult, MapDefinition } from '@ott/game-core';
import { DEFAULT_LIMITS, compileProtocolValidator, validateTimeControlV2, type FaultSummary, type ProtocolValidator } from '@ott/bot-protocol';
import type { MatchConfig } from '@ott/match-runner';
import type { PlayerSide } from '@ott/game-core';
import type { Database } from '@ott/platform-api';

export interface MatchAttemptLease {
  readonly id: string;
  readonly token: string;
  readonly attemptNumber: number;
}

export interface PinnedSubmission {
  readonly reference: MatchJobV1['x'];
  readonly objectKey: string;
  readonly entrypoint: readonly string[];
}

export interface ClaimedMatch {
  readonly attempt: MatchAttemptLease;
  readonly config: MatchJobConfig;
  readonly submissions: Readonly<{ X: PinnedSubmission; O: PinnedSubmission }>;
}

export interface MatchJobConfig {
  readonly matchId: string;
  readonly policyVersion: string;
  readonly seed: string;
  readonly game: GameConfig;
  readonly turnTimeoutMs: number;
  readonly protocolV2?: NonNullable<MatchConfig['protocolV2']>;
}

export type ClaimMatchResult =
  | { readonly kind: 'claimed'; readonly value: ClaimedMatch }
  | { readonly kind: 'already-finalized'; readonly result: GameResult };

type MatchRow = {
  readonly id: string;
  readonly status: string;
  readonly series_id: string;
  readonly seed: string | null;
  readonly map_checksum: string | null;
  readonly map_definition: unknown;
  readonly engine_version: string;
  readonly max_turns: number;
  readonly turn_timeout_ms: number;
  readonly policy_version: string;
  readonly rule_set_id: string | null;
  readonly protocol_v2: unknown;
  readonly rule_set_version: number | null;
  readonly rules_sha256: string | null;
  readonly x_submission_id: string;
  readonly x_archive_sha256: string;
  readonly x_manifest_digest: string;
  readonly x_config_digest: string;
  readonly x_policy_version: string;
  readonly x_object_key: string;
  readonly x_entrypoint: unknown;
  readonly o_submission_id: string;
  readonly o_archive_sha256: string;
  readonly o_manifest_digest: string;
  readonly o_config_digest: string;
  readonly o_policy_version: string;
  readonly o_object_key: string;
  readonly o_entrypoint: unknown;
};

type StoredResult = {
  readonly winner_side: 'X' | 'O' | null;
  readonly reason: GameResult['reason'];
  readonly turn_count: number;
  readonly final_state_hash: string;
};

function parseEntrypoint(value: unknown): readonly string[] {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== 'string' || part.length === 0)) {
    throw new Error('MATCH_SUBMISSION_ENTRYPOINT_INVALID');
  }
  return parsed;
}

function finalizedResult(row: StoredResult | undefined): GameResult {
  if (row === undefined) throw new Error('MATCH_FINALIZED_RESULT_MISSING');
  return {
    winnerSide: row.winner_side,
    reason: row.reason,
    turnCount: row.turn_count,
    finalStateHash: row.final_state_hash,
    forfeitedSide: row.reason === 'FORFEIT' ? row.winner_side === 'X' ? 'O' : 'X' : null,
  };
}

function reference(job: MatchJobV1, side: 'X' | 'O', row: MatchRow): PinnedSubmission {
  const isX = side === 'X';
  const expected = isX ? job.x : job.o;
  const submissionId = isX ? row.x_submission_id : row.o_submission_id;
  const archiveSha256 = isX ? row.x_archive_sha256 : row.o_archive_sha256;
  const manifestDigest = isX ? row.x_manifest_digest : row.o_manifest_digest;
  const configDigest = isX ? row.x_config_digest : row.o_config_digest;
  const policyVersion = isX ? row.x_policy_version : row.o_policy_version;
  const objectKey = isX ? row.x_object_key : row.o_object_key;
  const entrypoint = isX ? row.x_entrypoint : row.o_entrypoint;
  if (expected.submissionId !== submissionId || expected.archiveSha256 !== archiveSha256
    || expected.manifestDigest !== manifestDigest || expected.configDigest !== configDigest
    || expected.policyVersion !== policyVersion) {
    throw new Error('MATCH_SUBMISSION_IDENTITY_MISMATCH');
  }
  return { reference: expected, objectKey, entrypoint: parseEntrypoint(entrypoint) };
}

function readMap(value: unknown): MapDefinition {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('MATCH_MAP_INVALID');
  const map = parsed as Partial<MapDefinition>;
  if (map.schemaVersion !== 1 || typeof map.mapId !== 'string' || !Number.isInteger(map.version)
    || typeof map.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(map.checksum)
    || !Number.isInteger(map.width) || !Number.isInteger(map.height)
    || !Array.isArray(map.obstacles) || !Array.isArray(map.spawns) || typeof map.goals !== 'object' || map.goals === null) {
    throw new Error('MATCH_MAP_INVALID');
  }
  return map as MapDefinition;
}

export async function claimMatch(database: Database, job: MatchJobV1): Promise<ClaimMatchResult> {
  return database.transaction(async (transaction) => {
    const selected = await transaction.query<MatchRow>(`
      SELECT m.id, m.status, m.series_id, m.seed, m.map_checksum, m.map_definition,
        m.engine_version, m.max_turns, m.turn_timeout_ms, m.policy_version, m.rule_set_id, m.protocol_v2,
        rrs.version AS rule_set_version, rrs.rules_sha256,
        sx.id AS x_submission_id, sx.archive_sha256 AS x_archive_sha256,
        sx.oci_manifest_digest AS x_manifest_digest, sx.oci_config_digest AS x_config_digest,
        sx.policy_version AS x_policy_version, sx.object_key AS x_object_key, sx.entrypoint AS x_entrypoint,
        so.id AS o_submission_id, so.archive_sha256 AS o_archive_sha256,
        so.oci_manifest_digest AS o_manifest_digest, so.oci_config_digest AS o_config_digest,
        so.policy_version AS o_policy_version, so.object_key AS o_object_key, so.entrypoint AS o_entrypoint
      FROM matches m
      JOIN submissions sx ON sx.id = m.x_submission_id
      JOIN submissions so ON so.id = m.o_submission_id
      LEFT JOIN round_rule_sets rrs ON rrs.id = m.rule_set_id
      WHERE m.id = $1
      FOR UPDATE OF m`, [job.matchId]);
    const row = selected.rows[0];
    if (row === undefined) throw new Error('MATCH_NOT_FOUND');
    if (row.policy_version !== job.policyVersion) throw new Error('MATCH_POLICY_VERSION_MISMATCH');
    const x = reference(job, 'X', row);
    const o = reference(job, 'O', row);

    const existing = await transaction.query<StoredResult>(
      'SELECT winner_side, reason, turn_count, final_state_hash FROM match_results WHERE match_id = $1', [job.matchId],
    );
    if (row.status === 'FINALIZED') return { kind: 'already-finalized', result: finalizedResult(existing.rows[0]) };
    if (existing.rows.length > 0) throw new Error('MATCH_RESULT_STATUS_INCONSISTENT');
    if (row.status === 'FAILED' || row.status === 'CANCELLED') throw new Error('MATCH_NOT_RUNNABLE');

    const activeLease = await transaction.query<{ readonly id: string }>(
      "SELECT id FROM match_attempts WHERE match_id = $1 AND status = 'RUNNING' AND lease_expires_at > now() FOR UPDATE",
      [job.matchId],
    );
    if (activeLease.rows.length > 0) throw new Error('MATCH_LEASE_ACTIVE');
    await transaction.query(
      "UPDATE match_attempts SET status = 'FAILED_RETRYABLE', finished_at = now(), failure_reason = 'MATCH_LEASE_EXPIRED' WHERE match_id = $1 AND status = 'RUNNING' AND lease_expires_at <= now()",
      [job.matchId],
    );

    const map = readMap(row.map_definition);
    if (row.map_checksum !== map.checksum || row.seed === null || row.max_turns <= 0
      || (row.protocol_v2 == null && row.max_turns > DEFAULT_LIMITS.maxTurns) || row.turn_timeout_ms <= 0
      || row.turn_timeout_ms > DEFAULT_LIMITS.turnTimeoutMs) {
      throw new Error('MATCH_EXECUTION_SNAPSHOT_INVALID');
    }

    const game: GameConfig = {
      gameId: job.matchId, engineVersion: row.engine_version, map, maxTurns: row.max_turns,
    };
    const protocolV2 = await readProtocolSnapshot(row, game);
    const attemptNumber = await transaction.query<{ readonly next_attempt: number }>(
      'SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt FROM match_attempts WHERE match_id = $1', [job.matchId],
    );
    const id = randomUUID();
    const token = randomUUID();
    const next = attemptNumber.rows[0]?.next_attempt ?? 1;
    await transaction.query(
      "INSERT INTO match_attempts (id, match_id, attempt_number, status, leased_at, lease_token, lease_expires_at) VALUES ($1,$2,$3,'RUNNING',now(),$4,now() + ($5::bigint * interval '1 millisecond'))",
      [id, job.matchId, next, token, Math.max(900000, protocolV2 ? protocolV2.timeControl.matchWallClockMs + 2 * protocolV2.timeControl.startupMs + 60000 : 0)],
    );
    await transaction.query("UPDATE matches SET status = 'RUNNING' WHERE id = $1", [job.matchId]);

    return {
      kind: 'claimed',
      value: {
        attempt: { id, token, attemptNumber: next },
        config: { matchId: job.matchId, policyVersion: row.policy_version, seed: row.seed, game, turnTimeoutMs: row.turn_timeout_ms,
          ...(protocolV2 ? { protocolV2 } : {}) },
        submissions: { X: x, O: o },
      },
    };
  });
}

let v2Validator: ProtocolValidator | undefined;
async function readProtocolSnapshot(row: MatchRow, game: GameConfig): Promise<MatchConfig['protocolV2']> {
  if (row.protocol_v2 == null) {
    if (row.rule_set_id != null) throw new Error('MATCH_PROTOCOL_SNAPSHOT_INVALID');
    return undefined;
  }
  if (row.rule_set_id == null || typeof row.protocol_v2 !== 'object' || Array.isArray(row.protocol_v2)) {
    throw new Error('MATCH_PROTOCOL_SNAPSHOT_INVALID');
  }
  if (Object.keys(row.protocol_v2).sort().join(',') !== 'botSeeds,timeControl') throw new Error('MATCH_PROTOCOL_SNAPSHOT_INVALID');
  const value = row.protocol_v2 as NonNullable<MatchConfig['protocolV2']>;
  v2Validator ??= compileProtocolValidator(JSON.parse(await readFile(new URL('../../../../docs/contracts/bot-protocol-v2.schema.json', import.meta.url), 'utf8')));
  for (const side of ['X', 'O'] as const) {
    const { startupTimeoutMs: _startup, turnTimeoutMs: _turn, ...limits } = DEFAULT_LIMITS;
    if (!v2Validator.isProtocolMessage({ type: 'INIT', protocolVersion: 2, matchId: row.id, engineVersion: game.engineVersion,
      side, botSeed: value.botSeeds?.[side], map: game.map, limits: { ...limits, maxTurns: game.maxTurns, timeControl: value.timeControl } })) {
      throw new Error('MATCH_PROTOCOL_SNAPSHOT_INVALID');
    }
  }
  if (!validateTimeControlV2(value.timeControl).ok || value.botSeeds.X === value.botSeeds.O
    || value.botSeeds.X === row.seed || value.botSeeds.O === row.seed) throw new Error('MATCH_PROTOCOL_SNAPSHOT_INVALID');
  if (!Number.isSafeInteger(row.rule_set_version) || row.rule_set_version! < 1
    || typeof row.rules_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.rules_sha256)) throw new Error('MATCH_PROTOCOL_SNAPSHOT_INVALID');
  return { ...value, ruleSet: { id: row.rule_set_id, version: row.rule_set_version!, sha256: row.rules_sha256 } };
}

export async function markAttemptFailed(
  database: Database,
  claim: ClaimedMatch,
  errorCode: string,
  terminal: boolean,
): Promise<void> {
  await database.transaction(async (transaction) => {
    const status = terminal ? 'FAILED_TERMINAL' : 'FAILED_RETRYABLE';
    const failed = await transaction.query<{ readonly match_id: string }>(
      "UPDATE match_attempts SET status = $1, finished_at = now(), failure_reason = $2 WHERE id = $3 AND lease_token = $4 AND status = 'RUNNING' RETURNING match_id",
      [status, errorCode, claim.attempt.id, claim.attempt.token],
    );
    if (failed.rowCount === 0) return;
    await transaction.query("UPDATE matches SET status = $1 WHERE id = $2 AND status = 'RUNNING'", [terminal ? 'FAILED' : 'SCHEDULED', claim.config.matchId]);
  });
}

export async function persistFinalizedResult(
  database: Database,
  input: {
    readonly claim: ClaimedMatch;
    readonly result: GameResult;
    readonly events: readonly MatchReportEvent[];
    readonly eventLogKey: string;
    readonly eventLogSha256: string;
    readonly faults: Readonly<Record<PlayerSide, FaultSummary>>;
  },
): Promise<{ readonly alreadyFinalized: boolean }> {
  return database.transaction(async (transaction) => {
    const match = await transaction.query<{ readonly status: string }>('SELECT status FROM matches WHERE id = $1 FOR UPDATE', [input.claim.config.matchId]);
    if (match.rows[0] === undefined) throw new Error('MATCH_NOT_FOUND');
    const existing = await transaction.query<StoredResult & { readonly event_log_sha256: string | null }>(
      'SELECT winner_side, reason, turn_count, final_state_hash, event_log_sha256 FROM match_results WHERE match_id = $1', [input.claim.config.matchId],
    );
    if (existing.rows[0] !== undefined) {
      const row = existing.rows[0];
      if (row.winner_side !== input.result.winnerSide || row.reason !== input.result.reason
        || row.turn_count !== input.result.turnCount || row.final_state_hash !== input.result.finalStateHash
        || row.event_log_sha256 !== input.eventLogSha256) throw new Error('MATCH_RESULT_CONFLICT');
      return { alreadyFinalized: true };
    }
    if (match.rows[0].status !== 'RUNNING') throw new Error('MATCH_NOT_RUNNING');
    const lease = await transaction.query<{ readonly id: string }>(
      "SELECT id FROM match_attempts WHERE id = $1 AND lease_token = $2 AND status = 'RUNNING' AND lease_expires_at > now() FOR UPDATE",
      [input.claim.attempt.id, input.claim.attempt.token],
    );
    if (lease.rows.length === 0) throw new Error('MATCH_LEASE_LOST');

    await transaction.query(
      'INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash, event_log_key, event_log_sha256, faults) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [input.claim.config.matchId, input.result.winnerSide, input.result.reason, input.result.turnCount, input.result.finalStateHash, input.eventLogKey, input.eventLogSha256, JSON.stringify(input.faults)],
    );
    for (const event of input.events) {
      await transaction.query(
        'INSERT INTO match_events (match_id, sequence, event_type, payload) VALUES ($1,$2,$3,$4::jsonb)',
        [input.claim.config.matchId, event.sequence, event.type, JSON.stringify(event)],
      );
    }
    await transaction.query(
      "INSERT INTO match_outbox (match_id, event_type, payload) VALUES ($1,'MATCH_FINALIZED',$2::jsonb)",
      [input.claim.config.matchId, JSON.stringify({
        matchId: input.claim.config.matchId,
        policyVersion: input.claim.config.policyVersion,
        result: input.result,
        eventLogKey: input.eventLogKey,
        eventLogSha256: input.eventLogSha256,
        submissions: { X: input.claim.submissions.X.reference, O: input.claim.submissions.O.reference },
      })],
    );
    await transaction.query("UPDATE match_attempts SET status = 'SUCCEEDED', finished_at = now(), failure_reason = NULL WHERE id = $1 AND lease_token = $2", [input.claim.attempt.id, input.claim.attempt.token]);
    await transaction.query("UPDATE matches SET status = 'FINALIZED' WHERE id = $1", [input.claim.config.matchId]);
    return { alreadyFinalized: false };
  });
}

type MatchReportEvent = import('@ott/game-core').GameEvent;
