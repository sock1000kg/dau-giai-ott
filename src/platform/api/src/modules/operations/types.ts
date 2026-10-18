import { randomUUID } from 'node:crypto';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REASON_MAX_LENGTH = 500;
export const PUBLIC_REASON_MAX_LENGTH = 200;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

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

function onlyKeys(body: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(body).every((key) => allowed.includes(key));
}

export interface ReasonBody { readonly reason: string }
export interface CancelBody extends ReasonBody { readonly publicReason: string }
export interface RerunBody extends CancelBody { readonly verifiedInfraFailure: true }
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };
const invalid = (code: string): { ok: false; code: string } => ({ ok: false, code });

export function parseReasonBody(body: unknown): Parsed<ReasonBody> {
  if (!isRecord(body) || !onlyKeys(body, ['reason'])) return invalid('INVALID_REQUEST');
  const reason = parseReason(body.reason);
  return reason === null ? invalid('INVALID_REASON') : { ok: true, value: { reason } };
}

export function parseCancelBody(body: unknown): Parsed<CancelBody> {
  if (!isRecord(body) || !onlyKeys(body, ['reason', 'publicReason'])) return invalid('INVALID_REQUEST');
  const reason = parseReason(body.reason);
  if (reason === null) return invalid('INVALID_REASON');
  const publicReason = parsePublicReason(body.publicReason);
  if (publicReason === null) return invalid('INVALID_PUBLIC_REASON');
  return { ok: true, value: { reason, publicReason } };
}

export function parseRerunBody(body: unknown): Parsed<RerunBody> {
  if (!isRecord(body) || !onlyKeys(body, ['reason', 'publicReason', 'verifiedInfraFailure'])) return invalid('INVALID_REQUEST');
  const { verifiedInfraFailure, ...rest } = body;
  const cancel = parseCancelBody(rest);
  if (!cancel.ok) return cancel;
  if (verifiedInfraFailure !== true) return invalid('RERUN_CONFIRMATION_REQUIRED');
  return { ok: true, value: { ...cancel.value, verifiedInfraFailure: true } };
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
