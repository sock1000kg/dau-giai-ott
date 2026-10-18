import { randomUUID } from 'node:crypto';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REASON_MAX_LENGTH = 500;
export const PUBLIC_REASON_MAX_LENGTH = 200;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const EVIDENCE_MAX_BYTES = 4096;

export class OperationsError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'OperationsError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const CASE_KINDS = ['ANOMALY', 'DUPLICATE', 'APPEAL'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const CASE_STATUSES = ['OPEN', 'UNDER_REVIEW', 'DECIDED', 'CLOSED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_DECISIONS = ['NO_ACTION', 'WARN', 'REVOKE_SUBMISSION', 'SUSPEND_TEAM', 'RERUN_APPROVED', 'APPEAL_UPHELD', 'APPEAL_REJECTED'] as const;
export type CaseDecision = (typeof CASE_DECISIONS)[number];

export const CASE_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  OPEN: ['UNDER_REVIEW', 'DECIDED'],
  UNDER_REVIEW: ['DECIDED'],
  DECIDED: ['CLOSED'],
  CLOSED: [],
};

export function canTransitionCase(from: CaseStatus, to: CaseStatus): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

/** Appeal outcomes belong to appeals only; the other decisions apply to every kind. */
export function isDecisionAllowedForKind(kind: CaseKind, decision: CaseDecision): boolean {
  if (decision === 'APPEAL_UPHELD' || decision === 'APPEAL_REJECTED') return kind === 'APPEAL';
  return true;
}

export const QUEUE_OVERRIDE_ACTIONS = ['RERUN', 'CANCEL', 'PRIORITIZE', 'DEFER'] as const;

/** Submission lifecycle (docs/tai-lieu-yeu-cau.md §8.3): only VALID and ACTIVE may be revoked. */
export const REVOCABLE_SUBMISSION_STATUSES: readonly string[] = ['VALID', 'ACTIVE'];

/**
 * Closed set of match_attempts.failure_reason values that BTC may treat as infrastructure failures.
 * Anything else (including unknown codes) is never rerunnable.
 */
export const INFRA_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'MATCH_LEASE_EXPIRED',
  'MATCH_EXECUTION_FAILED',
  'SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH',
  'MATCH_EVENT_LOG_INTEGRITY_FAILED',
  'SANDBOX_NOT_RUNNING',
]);

export interface RerunEligibilityInput {
  readonly matchStatus: string;
  readonly hasResult: boolean;
  readonly latestAttemptStatus: string | null;
  readonly latestFailureReason: string | null;
  readonly roundStatus: string;
  readonly seriesStatus: string;
  readonly seriesCancellationReason: string | null;
  readonly hasRatingLedger: boolean;
  readonly hasPendingRerun: boolean;
}

export type RerunEligibility = { readonly ok: true } | { readonly ok: false; readonly code: string };

/** First failing rule wins; codes are stable API error codes. */
export function evaluateRerunEligibility(input: RerunEligibilityInput): RerunEligibility {
  if (input.matchStatus !== 'FAILED') return { ok: false, code: 'RERUN_MATCH_NOT_FAILED' };
  if (input.hasResult) return { ok: false, code: 'RERUN_RESULT_EXISTS' };
  if (input.latestAttemptStatus !== 'FAILED_TERMINAL'
    || input.latestFailureReason === null
    || !INFRA_FAILURE_REASONS.has(input.latestFailureReason)) {
    return { ok: false, code: 'RERUN_NOT_INFRA_FAILURE' };
  }
  if (input.roundStatus !== 'SCHEDULED' || input.hasRatingLedger || input.seriesStatus === 'FINALIZED') {
    return { ok: false, code: 'RERUN_ROUND_SETTLED' };
  }
  if (input.seriesStatus === 'CANCELLED' && input.seriesCancellationReason !== 'INFRASTRUCTURE_FAILURE') {
    return { ok: false, code: 'RERUN_SERIES_CANCELLED_BY_OPERATOR' };
  }
  if (input.hasPendingRerun) return { ok: false, code: 'RERUN_ALREADY_PENDING' };
  return { ok: true };
}

export const SECRET_KEY_PATTERN = /seed|password|secret|credential|stderr|object_?key|token|hash_of_password/i;

export const EVIDENCE_KEYS = ['summary', 'source', 'note', 'links', 'similarity', 'matchId', 'submissionId', 'seriesId', 'teamId', 'confirmed'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export function parseReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason.length >= 1 && reason.length <= REASON_MAX_LENGTH ? reason : null;
}

export function parsePublicReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (reason.length < 1 || reason.length > PUBLIC_REASON_MAX_LENGTH) return null;
  return reason;
}

/** Returns the header UUID, a fresh UUID when absent, or null when present but malformed. */
export function resolveCorrelationId(header: unknown): string | null {
  if (header === undefined) return randomUUID();
  const value = Array.isArray(header) ? header[0] : header;
  return parseUuid(value) ? (value as string).toLowerCase() : null;
}

export function parseIdempotencyKey(header: unknown): { readonly ok: true; readonly key: string | undefined } | { readonly ok: false } {
  if (header === undefined) return { ok: true, key: undefined };
  if (typeof header !== 'string' || header.length < 1 || header.length > IDEMPOTENCY_KEY_MAX_LENGTH || !/^[\x21-\x7e]+$/.test(header)) {
    return { ok: false };
  }
  return { ok: true, key: header };
}

/** Evidence is a small flat object with allowlisted keys; secret-looking keys are rejected outright. */
export function parseEvidence(value: unknown): Record<string, string | number | boolean | string[]> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string | number | boolean | string[]> = {};
  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  for (const [key, item] of entries) {
    if (!(EVIDENCE_KEYS as readonly string[]).includes(key) || SECRET_KEY_PATTERN.test(key)) return null;
    if (typeof item === 'string') {
      if (item.length > 1000) return null;
      out[key] = item;
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) return null;
      out[key] = item;
    } else if (typeof item === 'boolean') {
      out[key] = item;
    } else if (Array.isArray(item) && item.length <= 20 && item.every((entry) => typeof entry === 'string' && entry.length <= 200)) {
      out[key] = item as string[];
    } else {
      return null;
    }
  }
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > EVIDENCE_MAX_BYTES) return null;
  return out;
}

function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}

export interface ReasonBody { readonly reason: string }
export interface CancelBody extends ReasonBody { readonly publicReason: string; readonly caseId: string | null }
export interface RerunBody extends CancelBody { readonly verifiedInfraFailure: true }
export interface OpenCaseBody extends ReasonBody {
  readonly kind: CaseKind;
  readonly teamId: string | null;
  readonly roundId: string | null;
  readonly submissionId: string | null;
  readonly matchId: string | null;
  readonly seriesId: string | null;
  readonly evidence: Record<string, string | number | boolean | string[]>;
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
const invalid = (code: string): { ok: false; code: string } => ({ ok: false, code });

export function parseReasonBody(body: unknown): Parsed<ReasonBody> {
  if (!isRecord(body) || !onlyKeys(body, ['reason'])) return invalid('INVALID_REQUEST');
  const reason = parseReason(body.reason);
  return reason === null ? invalid('INVALID_REASON') : { ok: true, value: { reason } };
}

export function parseCancelBody(body: unknown): Parsed<CancelBody> {
  if (!isRecord(body) || !onlyKeys(body, ['reason', 'publicReason', 'caseId'])) return invalid('INVALID_REQUEST');
  const reason = parseReason(body.reason);
  if (reason === null) return invalid('INVALID_REASON');
  const publicReason = parsePublicReason(body.publicReason);
  if (publicReason === null) return invalid('INVALID_PUBLIC_REASON');
  const caseId = body.caseId === undefined ? null : parseUuid(body.caseId);
  if (body.caseId !== undefined && caseId === null) return invalid('INVALID_REQUEST');
  return { ok: true, value: { reason, publicReason, caseId } };
}

export function parseRerunBody(body: unknown): Parsed<RerunBody> {
  if (!isRecord(body) || !onlyKeys(body, ['reason', 'publicReason', 'caseId', 'verifiedInfraFailure'])) return invalid('INVALID_REQUEST');
  const { verifiedInfraFailure, ...rest } = body;
  const cancel = parseCancelBody(rest);
  if (!cancel.ok) return cancel;
  if (verifiedInfraFailure !== true) return invalid('RERUN_CONFIRMATION_REQUIRED');
  return { ok: true, value: { ...cancel.value, verifiedInfraFailure: true } };
}

export function parseOpenCaseBody(body: unknown): Parsed<OpenCaseBody> {
  if (!isRecord(body) || !onlyKeys(body, ['reason', 'kind', 'teamId', 'roundId', 'submissionId', 'matchId', 'seriesId', 'evidence'])) return invalid('INVALID_REQUEST');
  const reason = parseReason(body.reason);
  if (reason === null) return invalid('INVALID_REASON');
  if (typeof body.kind !== 'string' || !(CASE_KINDS as readonly string[]).includes(body.kind)) return invalid('INVALID_CASE_KIND');
  const kind = body.kind as CaseKind;
  const refs: Record<'teamId' | 'roundId' | 'submissionId' | 'matchId' | 'seriesId', string | null> = {
    teamId: null, roundId: null, submissionId: null, matchId: null, seriesId: null,
  };
  for (const key of Object.keys(refs) as (keyof typeof refs)[]) {
    if (body[key] === undefined) continue;
    const id = parseUuid(body[key]);
    if (id === null) return invalid('INVALID_REQUEST');
    refs[key] = id;
  }
  if (kind === 'APPEAL' && refs.teamId === null) return invalid('CASE_SUBJECT_REQUIRED');
  if (kind === 'DUPLICATE' && refs.submissionId === null) return invalid('CASE_SUBJECT_REQUIRED');
  if (Object.values(refs).every((id) => id === null)) return invalid('CASE_SUBJECT_REQUIRED');
  const evidence = parseEvidence(body.evidence);
  if (evidence === null) return invalid('INVALID_EVIDENCE');
  return { ok: true, value: { reason, kind, ...refs, evidence } };
}

export function parseEvidenceBody(body: unknown): Parsed<ReasonBody & { readonly evidence: Record<string, string | number | boolean | string[]> }> {
  if (!isRecord(body) || !onlyKeys(body, ['reason', 'evidence'])) return invalid('INVALID_REQUEST');
  const reason = parseReason(body.reason);
  if (reason === null) return invalid('INVALID_REASON');
  const evidence = parseEvidence(body.evidence);
  return evidence === null ? invalid('INVALID_EVIDENCE') : { ok: true, value: { reason, evidence } };
}

export function parseStatusBody(body: unknown): Parsed<ReasonBody & { readonly status: 'UNDER_REVIEW' | 'CLOSED' }> {
  if (!isRecord(body) || !onlyKeys(body, ['reason', 'status'])) return invalid('INVALID_REQUEST');
  const reason = parseReason(body.reason);
  if (reason === null) return invalid('INVALID_REASON');
  if (body.status !== 'UNDER_REVIEW' && body.status !== 'CLOSED') return invalid('INVALID_CASE_STATUS');
  return { ok: true, value: { reason, status: body.status } };
}

export function parseDecisionBody(body: unknown): Parsed<ReasonBody & { readonly decision: CaseDecision }> {
  if (!isRecord(body) || !onlyKeys(body, ['reason', 'decision'])) return invalid('INVALID_REQUEST');
  const reason = parseReason(body.reason);
  if (reason === null) return invalid('INVALID_REASON');
  if (typeof body.decision !== 'string' || !(CASE_DECISIONS as readonly string[]).includes(body.decision)) return invalid('INVALID_CASE_DECISION');
  return { ok: true, value: { reason, decision: body.decision as CaseDecision } };
}

export interface AuditQuery {
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly actorAccountId: string | null;
  readonly action: string | null;
  readonly from: Date | null;
  readonly to: Date | null;
  readonly page: number;
  readonly pageSize: number;
}

function parseIsoDate(value: unknown): Date | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseAuditQuery(query: unknown, maxPageSize = 100): Parsed<AuditQuery> {
  const q = isRecord(query) ? query : {};
  if (!onlyKeys(q, ['targetType', 'targetId', 'actorAccountId', 'action', 'from', 'to', 'page', 'pageSize'])) return invalid('INVALID_QUERY');
  const word = (value: unknown): string | null | undefined => {
    if (value === undefined) return null;
    return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : undefined;
  };
  const uuid = (value: unknown): string | null | undefined => {
    if (value === undefined) return null;
    return parseUuid(value) ?? undefined;
  };
  const targetType = word(q.targetType);
  const action = word(q.action);
  const targetId = uuid(q.targetId);
  const actorAccountId = uuid(q.actorAccountId);
  const from = parseIsoDate(q.from);
  const to = parseIsoDate(q.to);
  if ([targetType, action, targetId, actorAccountId, from, to].some((item) => item === undefined)) return invalid('INVALID_QUERY');
  const int = (value: unknown, fallback: number): number | undefined => {
    if (value === undefined) return fallback;
    return typeof value === 'string' && /^[0-9]{1,6}$/.test(value) ? Number(value) : undefined;
  };
  const page = int(q.page, 1);
  const pageSize = int(q.pageSize, 50);
  if (page === undefined || pageSize === undefined || page < 1 || pageSize < 1 || pageSize > maxPageSize) return invalid('INVALID_QUERY');
  return {
    ok: true,
    value: {
      targetType: targetType ?? null,
      targetId: targetId ?? null,
      actorAccountId: actorAccountId ?? null,
      action: action ?? null,
      from: from ?? null,
      to: to ?? null,
      page,
      pageSize,
    },
  };
}
