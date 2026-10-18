import { createHash, randomUUID } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import { canonicalJson } from '../rounds/types.ts';
import { stripSecretKeys } from './export.ts';
import {
  evaluateRerunEligibility,
  OperationsError,
  REVOCABLE_SUBMISSION_STATUSES,
  type AuditQuery,
} from './types.ts';

type Json = Record<string, unknown>;

export interface PrivilegedContext {
  readonly actorAccountId: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly idempotencyKey?: string | undefined;
}

export interface PrivilegedOutcome<Effects = undefined> {
  readonly after: Json;
  readonly replayed: boolean;
  readonly effects: Effects | undefined;
}

interface PrivilegedSpec<Effects> {
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly payload: unknown;
  readonly work: (tx: Database) => Promise<{ readonly before: Json; readonly after: Json; readonly effects?: Effects }>;
}

function requestHash(spec: { readonly action: string; readonly targetId: string; readonly payload: unknown }, reason: string): string {
  return createHash('sha256').update(canonicalJson({ action: spec.action, targetId: spec.targetId, payload: spec.payload, reason })).digest('hex');
}

/**
 * One transaction: optional idempotent replay check, the state change and exactly one audit row
 * carrying `{ before, after }`. The audit table is append-only, so a replay never writes a second row.
 */
async function runPrivileged<Effects>(
  database: Database,
  ctx: PrivilegedContext,
  spec: PrivilegedSpec<Effects>,
): Promise<PrivilegedOutcome<Effects>> {
  const hash = requestHash(spec, ctx.reason);
  return database.transaction(async (tx) => {
    if (ctx.idempotencyKey !== undefined) {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ops-idem:${ctx.actorAccountId}:${spec.action}:${ctx.idempotencyKey}`]);
      const found = await tx.query<{ readonly details: { readonly after?: Json; readonly requestHash?: string } | null }>(
        'SELECT details FROM audit_events WHERE actor_account_id = $1 AND action = $2 AND idempotency_key = $3',
        [ctx.actorAccountId, spec.action, ctx.idempotencyKey],
      );
      const existing = found.rows[0];
      if (existing !== undefined) {
        if (existing.details?.requestHash !== hash) {
          throw new OperationsError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used for another request');
        }
        return { after: existing.details.after ?? {}, replayed: true, effects: undefined };
      }
    }
    const outcome = await spec.work(tx);
    await tx.query(
      `INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, correlation_id, details, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        randomUUID(), ctx.actorAccountId, spec.action, spec.targetType, spec.targetId, ctx.reason, ctx.correlationId,
        JSON.stringify(stripSecretKeys({ before: outcome.before, after: outcome.after, requestHash: hash })),
        ctx.idempotencyKey ?? null,
      ],
    );
    return { after: outcome.after, replayed: false, effects: outcome.effects };
  });
}

// ---------------------------------------------------------------- teams

interface AccountRow { readonly id: string; readonly status: 'ACTIVE' | 'DISABLED' }

function accountSummary(rows: readonly AccountRow[]): Json {
  return {
    accounts: rows.length,
    active: rows.filter(({ status }) => status === 'ACTIVE').length,
    disabled: rows.filter(({ status }) => status === 'DISABLED').length,
  };
}

async function lockTeamAccounts(tx: Database, teamId: string): Promise<AccountRow[]> {
  const team = await tx.query('SELECT id FROM teams WHERE id = $1 FOR UPDATE', [teamId]);
  if (team.rows.length === 0) throw new OperationsError(404, 'TEAM_NOT_FOUND', 'Team not found');
  const accounts = await tx.query<AccountRow>('SELECT id, status FROM accounts WHERE team_id = $1 FOR UPDATE', [teamId]);
  return accounts.rows;
}

export async function suspendTeam(database: Database, ctx: PrivilegedContext, teamId: string): Promise<PrivilegedOutcome<readonly string[]>> {
  return runPrivileged<readonly string[]>(database, ctx, {
    action: 'TEAM_SUSPENDED', targetType: 'TEAM', targetId: teamId, payload: {},
    work: async (tx) => {
      const accounts = await lockTeamAccounts(tx, teamId);
      if (accounts.length === 0 || accounts.every(({ status }) => status === 'DISABLED')) {
        throw new OperationsError(409, 'TRANSITION_INVALID', 'Team is already suspended');
      }
      const ids = accounts.map(({ id }) => id);
      await tx.query("UPDATE accounts SET status = 'DISABLED', updated_at = now() WHERE id = ANY($1::uuid[])", [ids]);
      const revoked = await tx.query('UPDATE sessions SET revoked_at = now() WHERE account_id = ANY($1::uuid[]) AND revoked_at IS NULL', [ids]);
      return {
        before: accountSummary(accounts),
        after: { ...accountSummary(accounts.map(({ id }) => ({ id, status: 'DISABLED' as const }))), sessionsRevoked: revoked.rowCount ?? 0 },
        effects: ids,
      };
    },
  });
}

export async function unsuspendTeam(database: Database, ctx: PrivilegedContext, teamId: string): Promise<PrivilegedOutcome> {
  return runPrivileged(database, ctx, {
    action: 'TEAM_UNSUSPENDED', targetType: 'TEAM', targetId: teamId, payload: {},
    work: async (tx) => {
      const accounts = await lockTeamAccounts(tx, teamId);
      if (!accounts.some(({ status }) => status === 'DISABLED')) {
        throw new OperationsError(409, 'TRANSITION_INVALID', 'Team is not suspended');
      }
      await tx.query("UPDATE accounts SET status = 'ACTIVE', updated_at = now() WHERE id = ANY($1::uuid[])", [accounts.map(({ id }) => id)]);
      return {
        before: accountSummary(accounts),
        after: accountSummary(accounts.map(({ id }) => ({ id, status: 'ACTIVE' as const }))),
      };
    },
  });
}

// ---------------------------------------------------------------- submissions

export async function revokeSubmission(database: Database, ctx: PrivilegedContext, submissionId: string): Promise<PrivilegedOutcome> {
  return runPrivileged(database, ctx, {
    action: 'SUBMISSION_REVOKED', targetType: 'SUBMISSION', targetId: submissionId, payload: {},
    work: async (tx) => {
      const found = await tx.query<{ readonly id: string; readonly team_id: string; readonly status: string }>(
        'SELECT id, team_id, status FROM submissions WHERE id = $1 FOR UPDATE', [submissionId],
      );
      const submission = found.rows[0];
      if (submission === undefined) throw new OperationsError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found');
      if (!REVOCABLE_SUBMISSION_STATUSES.includes(submission.status)) {
        throw new OperationsError(409, 'TRANSITION_INVALID', 'Submission cannot be revoked from its current status');
      }
      const played = await tx.query<{ readonly count: string }>(
        `SELECT count(*)::text AS count FROM match_results r JOIN matches m ON m.id = r.match_id
         WHERE m.x_submission_id = $1 OR m.o_submission_id = $1`, [submissionId],
      );
      await tx.query("UPDATE submissions SET status = 'REVOKED' WHERE id = $1", [submissionId]);
      return {
        before: { status: submission.status, teamId: submission.team_id, playedMatches: Number(played.rows[0]?.count ?? 0) },
        after: { status: 'REVOKED', teamId: submission.team_id, playedMatches: Number(played.rows[0]?.count ?? 0) },
      };
    },
  });
}

// ---------------------------------------------------------------- matches

export interface MatchOverrideInput {
  readonly publicReason: string;
}

async function insertQueueOverride(
  tx: Database,
  ctx: PrivilegedContext,
  action: 'RERUN' | 'CANCEL',
  matchId: string,
  input: MatchOverrideInput,
): Promise<void> {
  await tx.query(
    `INSERT INTO queue_overrides (id, action, match_id, public_reason, actor_account_id, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), action, matchId, input.publicReason, ctx.actorAccountId, ctx.correlationId],
  );
}

export async function cancelMatch(database: Database, ctx: PrivilegedContext, matchId: string, input: MatchOverrideInput): Promise<PrivilegedOutcome> {
  return runPrivileged(database, ctx, {
    action: 'MATCH_CANCELLED', targetType: 'MATCH', targetId: matchId, payload: input,
    work: async (tx) => {
      const found = await tx.query<{ readonly status: string; readonly series_id: string }>(
        'SELECT status, series_id FROM matches WHERE id = $1 FOR UPDATE', [matchId],
      );
      const match = found.rows[0];
      if (match === undefined) throw new OperationsError(404, 'MATCH_NOT_FOUND', 'Match not found');
      if (match.status !== 'SCHEDULED' && match.status !== 'FAILED') {
        throw new OperationsError(409, 'CANCEL_NOT_ALLOWED', 'Only SCHEDULED or FAILED matches can be cancelled');
      }
      await tx.query("UPDATE matches SET status = 'CANCELLED' WHERE id = $1", [matchId]);
      await insertQueueOverride(tx, ctx, 'CANCEL', matchId, input);
      return {
        before: { matchStatus: match.status, seriesId: match.series_id },
        after: { matchStatus: 'CANCELLED', seriesId: match.series_id },
      };
    },
  });
}

export interface RerunEffects { readonly generation: number }

export async function rerunMatch(database: Database, ctx: PrivilegedContext, matchId: string, input: MatchOverrideInput): Promise<PrivilegedOutcome<RerunEffects>> {
  return runPrivileged<RerunEffects>(database, ctx, {
    action: 'MATCH_RERUN', targetType: 'MATCH', targetId: matchId, payload: { ...input, verifiedInfraFailure: true },
    work: async (tx) => {
      const found = await tx.query<{
        readonly status: string;
        readonly series_id: string;
        readonly series_status: string;
        readonly cancellation_reason: string | null;
        readonly round_status: string;
      }>(
        `SELECT m.status, m.series_id, s.status AS series_status, s.cancellation_reason, r.status AS round_status
         FROM matches m
         JOIN series s ON s.id = m.series_id
         JOIN rounds r ON r.id = s.round_id
         WHERE m.id = $1
         FOR UPDATE OF m, s`, [matchId],
      );
      const match = found.rows[0];
      if (match === undefined) throw new OperationsError(404, 'MATCH_NOT_FOUND', 'Match not found');
      const result = await tx.query('SELECT 1 FROM match_results WHERE match_id = $1', [matchId]);
      const attempt = await tx.query<{ readonly id: string; readonly attempt_number: number; readonly status: string; readonly failure_reason: string | null }>(
        'SELECT id, attempt_number, status, failure_reason FROM match_attempts WHERE match_id = $1 ORDER BY attempt_number DESC LIMIT 1', [matchId],
      );
      const ledger = await tx.query('SELECT 1 FROM rating_ledger WHERE series_id = $1 LIMIT 1', [match.series_id]);
      const pending = await tx.query(
        "SELECT 1 FROM match_outbox WHERE match_id = $1 AND event_type = 'MATCH_RERUN' AND dispatched_at IS NULL LIMIT 1", [matchId],
      );
      const latest = attempt.rows[0];
      const eligibility = evaluateRerunEligibility({
        matchStatus: match.status,
        hasResult: result.rows.length > 0,
        latestAttemptStatus: latest?.status ?? null,
        latestFailureReason: latest?.failure_reason ?? null,
        roundStatus: match.round_status,
        seriesStatus: match.series_status,
        seriesCancellationReason: match.cancellation_reason,
        hasRatingLedger: ledger.rows.length > 0,
        hasPendingRerun: pending.rows.length > 0,
      });
      if (!eligibility.ok) throw new OperationsError(409, eligibility.code, `Rerun refused: ${eligibility.code}`);

      const original = await tx.query<{ readonly payload: unknown }>(
        "SELECT payload FROM match_outbox WHERE match_id = $1 AND event_type = 'MATCH_SCHEDULED' AND generation = 0", [matchId],
      );
      if (original.rows[0] === undefined) throw new OperationsError(409, 'RERUN_JOB_PAYLOAD_MISSING', 'Original match job payload is missing');
      const next = await tx.query<{ readonly generation: number }>(
        'SELECT COALESCE(MAX(generation), 0) + 1 AS generation FROM match_outbox WHERE match_id = $1', [matchId],
      );
      const generation = Number(next.rows[0]?.generation ?? 1);

      await tx.query("UPDATE matches SET status = 'SCHEDULED' WHERE id = $1 AND status = 'FAILED'", [matchId]);
      if (match.series_status === 'CANCELLED') {
        await tx.query(
          "UPDATE series SET status = 'SCHEDULED', cancellation_reason = NULL, finalized_at = NULL WHERE id = $1 AND status = 'CANCELLED'",
          [match.series_id],
        );
      }
      await tx.query(
        "INSERT INTO match_outbox (match_id, event_type, payload, generation) VALUES ($1, 'MATCH_RERUN', $2::jsonb, $3)",
        [matchId, JSON.stringify(original.rows[0].payload), generation],
      );
      await insertQueueOverride(tx, ctx, 'RERUN', matchId, input);
      return {
        before: {
          matchStatus: match.status, seriesStatus: match.series_status,
          lastAttemptId: latest?.id ?? null, lastFailureReason: latest?.failure_reason ?? null,
          verifiedInfraFailure: true,
        },
        after: { matchStatus: 'SCHEDULED', seriesStatus: 'SCHEDULED', outboxGeneration: generation },
        effects: { generation },
      };
    },
  });
}

// ---------------------------------------------------------------- audit read

export interface AuditView {
  readonly id: string;
  readonly actorAccountId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly reason: string | null;
  readonly correlationId: string | null;
  readonly createdAt: Date;
  readonly details: Json | null;
}

interface AuditRow {
  readonly id: string;
  readonly actor_account_id: string | null;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string | null;
  readonly reason: string | null;
  readonly correlation_id: string | null;
  readonly created_at: Date;
  readonly details: Json | null;
}

function toAudit(row: AuditRow): AuditView {
  return {
    id: row.id, actorAccountId: row.actor_account_id, action: row.action, targetType: row.target_type, targetId: row.target_id,
    reason: row.reason, correlationId: row.correlation_id, createdAt: row.created_at, details: row.details,
  };
}

const AUDIT_WHERE = `WHERE ($1::text IS NULL OR target_type = $1)
  AND ($2::uuid IS NULL OR target_id = $2)
  AND ($3::uuid IS NULL OR actor_account_id = $3)
  AND ($4::text IS NULL OR action = $4)
  AND ($5::timestamptz IS NULL OR created_at >= $5)
  AND ($6::timestamptz IS NULL OR created_at <= $6)`;

function auditParams(query: AuditQuery): unknown[] {
  return [query.targetType, query.targetId, query.actorAccountId, query.action, query.from, query.to];
}

export async function listAudit(database: Database, query: AuditQuery): Promise<{ readonly items: readonly AuditView[]; readonly total: number }> {
  const total = await database.query<{ readonly count: string }>(`SELECT count(*)::text AS count FROM audit_events ${AUDIT_WHERE}`, auditParams(query));
  const rows = await database.query<AuditRow>(
    `SELECT id, actor_account_id, action, target_type, target_id, reason, correlation_id, created_at, details
     FROM audit_events ${AUDIT_WHERE} ORDER BY created_at DESC, id LIMIT $7 OFFSET $8`,
    [...auditParams(query), query.pageSize, (query.page - 1) * query.pageSize],
  );
  return { items: rows.rows.map(toAudit), total: Number(total.rows[0]?.count ?? 0) };
}

export const EXPORT_LIMIT = 10000;

export async function exportAudit(database: Database, query: AuditQuery): Promise<readonly AuditView[]> {
  const rows = await database.query<AuditRow>(
    `SELECT id, actor_account_id, action, target_type, target_id, reason, correlation_id, created_at, details
     FROM audit_events ${AUDIT_WHERE} ORDER BY created_at, id LIMIT $7`,
    [...auditParams(query), EXPORT_LIMIT],
  );
  return rows.rows.map(toAudit);
}

// ---------------------------------------------------------------- public queue overrides

export interface PublicQueueOverride {
  readonly id: string;
  readonly action: string;
  readonly matchOpaqueId: string;
  readonly publicReason: string;
  readonly createdAt: Date;
}

export function opaqueMatchId(matchId: string): string {
  return createHash('sha256').update(`queue-override-match:${matchId}`).digest('hex').slice(0, 16);
}

export async function listPublicQueueOverrides(database: Database, limit = 100): Promise<readonly PublicQueueOverride[]> {
  const rows = await database.query<{ readonly id: string; readonly action: string; readonly match_id: string; readonly public_reason: string; readonly created_at: Date }>(
    'SELECT id, action, match_id, public_reason, created_at FROM queue_overrides ORDER BY created_at DESC, id LIMIT $1', [limit],
  );
  return rows.rows.map((row) => ({
    id: row.id, action: row.action, matchOpaqueId: opaqueMatchId(row.match_id), publicReason: row.public_reason, createdAt: row.created_at,
  }));
}
