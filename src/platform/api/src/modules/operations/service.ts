import { createHash, randomUUID } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import { canonicalJson } from '../rounds/types.ts';
import { stripSecretKeys } from './export.ts';
import {
  canTransitionCase,
  evaluateRerunEligibility,
  isDecisionAllowedForKind,
  OperationsError,
  REVOCABLE_SUBMISSION_STATUSES,
  type AuditQuery,
  type CaseDecision,
  type CaseKind,
  type CaseStatus,
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

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
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
  readonly caseId: string | null;
}

async function insertQueueOverride(
  tx: Database,
  ctx: PrivilegedContext,
  action: 'RERUN' | 'CANCEL',
  matchId: string,
  input: MatchOverrideInput,
): Promise<void> {
  await tx.query(
    `INSERT INTO queue_overrides (id, action, match_id, public_reason, case_id, actor_account_id, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [randomUUID(), action, matchId, input.publicReason, input.caseId, ctx.actorAccountId, ctx.correlationId],
  );
}

function mapForeignKey(error: unknown, code: string, message: string): never {
  if (pgCode(error) === '23503') throw new OperationsError(400, code, message);
  throw error;
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
      try {
        await insertQueueOverride(tx, ctx, 'CANCEL', matchId, input);
      } catch (error) {
        mapForeignKey(error, 'CASE_NOT_FOUND', 'Case not found');
      }
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
      try {
        await insertQueueOverride(tx, ctx, 'RERUN', matchId, input);
      } catch (error) {
        mapForeignKey(error, 'CASE_NOT_FOUND', 'Case not found');
      }
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

// ---------------------------------------------------------------- cases

export interface CaseSummary {
  readonly id: string;
  readonly kind: CaseKind;
  readonly status: CaseStatus;
  readonly teamId: string | null;
  readonly roundId: string | null;
  readonly submissionId: string | null;
  readonly matchId: string | null;
  readonly seriesId: string | null;
  readonly openedBy: string;
  readonly openedAt: Date;
  readonly decidedAt: Date | null;
  readonly correlationId: string;
}

export interface CaseEventView {
  readonly seq: number;
  readonly eventType: string;
  readonly actorAccountId: string;
  readonly reason: string;
  readonly evidence: Json | null;
  readonly decision: CaseDecision | null;
  readonly correlationId: string;
  readonly createdAt: Date;
}

export interface CaseDetail extends CaseSummary { readonly events: readonly CaseEventView[] }

interface CaseRow {
  readonly id: string;
  readonly kind: CaseKind;
  readonly status: CaseStatus;
  readonly team_id: string | null;
  readonly round_id: string | null;
  readonly submission_id: string | null;
  readonly match_id: string | null;
  readonly series_id: string | null;
  readonly opened_by: string;
  readonly opened_at: Date;
  readonly decided_at: Date | null;
  readonly correlation_id: string;
}

const CASE_COLUMNS = 'id, kind, status, team_id, round_id, submission_id, match_id, series_id, opened_by, opened_at, decided_at, correlation_id';

function toCase(row: CaseRow): CaseSummary {
  return {
    id: row.id, kind: row.kind, status: row.status, teamId: row.team_id, roundId: row.round_id,
    submissionId: row.submission_id, matchId: row.match_id, seriesId: row.series_id, openedBy: row.opened_by,
    openedAt: row.opened_at, decidedAt: row.decided_at, correlationId: row.correlation_id,
  };
}

interface CaseEventRow {
  readonly case_id?: string;
  readonly seq: number;
  readonly event_type: string;
  readonly actor_account_id: string;
  readonly reason: string;
  readonly evidence: Json | null;
  readonly decision: CaseDecision | null;
  readonly correlation_id: string;
  readonly created_at: Date;
}

function toEvent(row: CaseEventRow): CaseEventView {
  return {
    seq: row.seq, eventType: row.event_type, actorAccountId: row.actor_account_id, reason: row.reason,
    evidence: row.evidence, decision: row.decision, correlationId: row.correlation_id, createdAt: row.created_at,
  };
}

const EVENT_COLUMNS = 'case_id, seq, event_type, actor_account_id, reason, evidence, decision, correlation_id, created_at';

async function appendCaseEvent(
  tx: Database,
  ctx: PrivilegedContext,
  caseId: string,
  event: { readonly eventType: 'OPENED' | 'EVIDENCE_ADDED' | 'STATUS_CHANGED' | 'DECIDED'; readonly evidence?: Json | null; readonly decision?: CaseDecision | null },
): Promise<number> {
  const next = await tx.query<{ readonly seq: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM operations_case_events WHERE case_id = $1', [caseId]);
  const seq = Number(next.rows[0]?.seq ?? 1);
  await tx.query(
    `INSERT INTO operations_case_events (id, case_id, seq, event_type, actor_account_id, reason, evidence, decision, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [randomUUID(), caseId, seq, event.eventType, ctx.actorAccountId, ctx.reason,
      event.evidence === undefined || event.evidence === null ? null : JSON.stringify(event.evidence),
      event.decision ?? null, ctx.correlationId],
  );
  return seq;
}

export interface OpenCaseInput {
  readonly kind: CaseKind;
  readonly teamId: string | null;
  readonly roundId: string | null;
  readonly submissionId: string | null;
  readonly matchId: string | null;
  readonly seriesId: string | null;
  readonly evidence: Json;
}

async function insertCase(tx: Database, ctx: PrivilegedContext, id: string, input: OpenCaseInput): Promise<void> {
  await tx.query(
    `INSERT INTO operations_cases (id, kind, team_id, round_id, submission_id, match_id, series_id, opened_by, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, input.kind, input.teamId, input.roundId, input.submissionId, input.matchId, input.seriesId, ctx.actorAccountId, ctx.correlationId],
  );
  await appendCaseEvent(tx, ctx, id, { eventType: 'OPENED', evidence: input.evidence });
}

export async function openCase(database: Database, ctx: PrivilegedContext, input: OpenCaseInput): Promise<PrivilegedOutcome> {
  const id = randomUUID();
  return runPrivileged(database, ctx, {
    action: 'CASE_OPENED', targetType: 'CASE', targetId: id, payload: input,
    work: async (tx) => {
      try {
        await insertCase(tx, ctx, id, input);
      } catch (error) {
        if (pgCode(error) === '23505') throw new OperationsError(409, 'CASE_ALREADY_EXISTS', 'A case already exists for this subject');
        mapForeignKey(error, 'CASE_SUBJECT_NOT_FOUND', 'Case subject not found');
      }
      return { before: {}, after: { caseId: id, kind: input.kind, status: 'OPEN' } };
    },
  });
}

/** Opens a DUPLICATE case for an N04-flagged submission; a second call returns the existing case. */
export async function openCaseFromDuplicate(database: Database, ctx: PrivilegedContext, submissionId: string): Promise<PrivilegedOutcome> {
  const id = randomUUID();
  return runPrivileged<undefined>(database, ctx, {
    action: 'CASE_OPENED', targetType: 'CASE', targetId: id, payload: { fromDuplicate: submissionId },
    work: async (tx) => {
      const found = await tx.query<{ readonly team_id: string; readonly duplicate_review_flag: boolean; readonly duplicate_of_submission_id: string | null }>(
        'SELECT team_id, duplicate_review_flag, duplicate_of_submission_id FROM submissions WHERE id = $1 FOR UPDATE', [submissionId],
      );
      const submission = found.rows[0];
      if (submission === undefined) throw new OperationsError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found');
      if (!submission.duplicate_review_flag) throw new OperationsError(409, 'SUBMISSION_NOT_FLAGGED', 'Submission is not flagged for duplicate review');
      const existing = await tx.query<{ readonly id: string; readonly status: CaseStatus }>(
        "SELECT id, status FROM operations_cases WHERE kind = 'DUPLICATE' AND submission_id = $1", [submissionId],
      );
      if (existing.rows[0] !== undefined) {
        throw new CaseExistsSignal(existing.rows[0].id, existing.rows[0].status);
      }
      const evidence: Json = { source: 'duplicate_review_flag', teamId: submission.team_id };
      if (submission.duplicate_of_submission_id !== null) evidence.submissionId = submission.duplicate_of_submission_id;
      await insertCase(tx, ctx, id, {
        kind: 'DUPLICATE', teamId: submission.team_id, roundId: null, submissionId, matchId: null, seriesId: null, evidence,
      });
      return { before: {}, after: { caseId: id, kind: 'DUPLICATE', status: 'OPEN' } };
    },
  }).catch((error: unknown) => {
    if (error instanceof CaseExistsSignal) return { after: { caseId: error.caseId, kind: 'DUPLICATE', status: error.status }, replayed: true, effects: undefined };
    throw error;
  });
}

class CaseExistsSignal extends Error {
  public readonly caseId: string;
  public readonly status: CaseStatus;

  public constructor(caseId: string, status: CaseStatus) {
    super('CASE_EXISTS');
    this.caseId = caseId;
    this.status = status;
  }
}

async function lockCase(tx: Database, caseId: string): Promise<CaseRow> {
  const found = await tx.query<CaseRow>(`SELECT ${CASE_COLUMNS} FROM operations_cases WHERE id = $1 FOR UPDATE`, [caseId]);
  const row = found.rows[0];
  if (row === undefined) throw new OperationsError(404, 'CASE_NOT_FOUND', 'Case not found');
  return row;
}

export async function addCaseEvidence(database: Database, ctx: PrivilegedContext, caseId: string, evidence: Json): Promise<PrivilegedOutcome> {
  return runPrivileged(database, ctx, {
    action: 'CASE_EVIDENCE_ADDED', targetType: 'CASE', targetId: caseId, payload: evidence,
    work: async (tx) => {
      const row = await lockCase(tx, caseId);
      if (row.status !== 'OPEN' && row.status !== 'UNDER_REVIEW') {
        throw new OperationsError(409, 'CASE_LOCKED', 'Evidence can only be added while the case is open');
      }
      const seq = await appendCaseEvent(tx, ctx, caseId, { eventType: 'EVIDENCE_ADDED', evidence });
      return { before: { status: row.status }, after: { caseId, status: row.status, eventSeq: seq } };
    },
  });
}

export async function changeCaseStatus(database: Database, ctx: PrivilegedContext, caseId: string, status: 'UNDER_REVIEW' | 'CLOSED'): Promise<PrivilegedOutcome> {
  return runPrivileged(database, ctx, {
    action: 'CASE_STATUS_CHANGED', targetType: 'CASE', targetId: caseId, payload: { status },
    work: async (tx) => {
      const row = await lockCase(tx, caseId);
      if (!canTransitionCase(row.status, status)) throw new OperationsError(409, 'CASE_TRANSITION_INVALID', 'Case status transition is not allowed');
      await tx.query('UPDATE operations_cases SET status = $2 WHERE id = $1', [caseId, status]);
      const seq = await appendCaseEvent(tx, ctx, caseId, { eventType: 'STATUS_CHANGED' });
      return { before: { status: row.status }, after: { caseId, status, eventSeq: seq } };
    },
  });
}

export async function decideCase(database: Database, ctx: PrivilegedContext, caseId: string, decision: CaseDecision): Promise<PrivilegedOutcome> {
  return runPrivileged(database, ctx, {
    action: 'CASE_DECIDED', targetType: 'CASE', targetId: caseId, payload: { decision },
    work: async (tx) => {
      const row = await lockCase(tx, caseId);
      if (!isDecisionAllowedForKind(row.kind, decision)) throw new OperationsError(409, 'DECISION_NOT_ALLOWED_FOR_KIND', 'Decision does not apply to this case kind');
      if (!canTransitionCase(row.status, 'DECIDED')) throw new OperationsError(409, 'CASE_TRANSITION_INVALID', 'Case status transition is not allowed');
      await tx.query("UPDATE operations_cases SET status = 'DECIDED', decided_at = now() WHERE id = $1", [caseId]);
      const seq = await appendCaseEvent(tx, ctx, caseId, { eventType: 'DECIDED', decision });
      return { before: { status: row.status }, after: { caseId, status: 'DECIDED', decision, eventSeq: seq } };
    },
  });
}

export interface CaseFilter {
  readonly status: CaseStatus | null;
  readonly kind: CaseKind | null;
  readonly page: number;
  readonly pageSize: number;
}

export async function listCases(database: Database, filter: CaseFilter): Promise<{ readonly items: readonly CaseSummary[]; readonly total: number }> {
  const where = 'WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR kind = $2)';
  const total = await database.query<{ readonly count: string }>(`SELECT count(*)::text AS count FROM operations_cases ${where}`, [filter.status, filter.kind]);
  const rows = await database.query<CaseRow>(
    `SELECT ${CASE_COLUMNS} FROM operations_cases ${where} ORDER BY opened_at DESC, id LIMIT $3 OFFSET $4`,
    [filter.status, filter.kind, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );
  return { items: rows.rows.map(toCase), total: Number(total.rows[0]?.count ?? 0) };
}

export async function getCase(database: Database, caseId: string): Promise<CaseDetail | null> {
  const found = await database.query<CaseRow>(`SELECT ${CASE_COLUMNS} FROM operations_cases WHERE id = $1`, [caseId]);
  const row = found.rows[0];
  if (row === undefined) return null;
  const events = await database.query<CaseEventRow>(`SELECT ${EVENT_COLUMNS} FROM operations_case_events WHERE case_id = $1 ORDER BY seq`, [caseId]);
  return { ...toCase(row), events: events.rows.map(toEvent) };
}

export const EXPORT_LIMIT = 10000;

export async function exportCases(database: Database): Promise<readonly CaseDetail[]> {
  const rows = await database.query<CaseRow>(`SELECT ${CASE_COLUMNS} FROM operations_cases ORDER BY opened_at, id LIMIT $1`, [EXPORT_LIMIT]);
  const ids = rows.rows.map(({ id }) => id);
  const events = ids.length === 0
    ? { rows: [] as CaseEventRow[] }
    : await database.query<CaseEventRow>(`SELECT ${EVENT_COLUMNS} FROM operations_case_events WHERE case_id = ANY($1::uuid[]) ORDER BY case_id, seq`, [ids]);
  return rows.rows.map((row) => ({
    ...toCase(row),
    events: events.rows.filter((event) => event.case_id === row.id).map(toEvent),
  }));
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
