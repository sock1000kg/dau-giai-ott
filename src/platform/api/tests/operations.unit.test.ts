import { describe, expect, it } from 'vitest';
import {
  AUDIT_EXPORT_FIELDS,
  sanitizeAuditRecord,
  stripSecretKeys,
  toNdjson,
} from '../src/modules/operations/export.ts';
import {
  INFRA_FAILURE_REASONS,
  evaluateRerunEligibility,
  parseAuditQuery,
  parseCancelBody,
  parseIdempotencyKey,
  parseReasonBody,
  parseRerunBody,
  resolveCorrelationId,
  type RerunEligibilityInput,
} from '../src/modules/operations/types.ts';

const uuid = '3f1b7c64-9d0e-4a53-8e55-0b1f4c2d7a11';

describe('operations validators', () => {
  it('requires a non-empty reason of at most 500 characters', () => {
    expect(parseReasonBody({ reason: 'ok' })).toEqual({ ok: true, value: { reason: 'ok' } });
    expect(parseReasonBody({})).toMatchObject({ ok: false, code: 'INVALID_REASON' });
    expect(parseReasonBody({ reason: '   ' })).toMatchObject({ ok: false, code: 'INVALID_REASON' });
    expect(parseReasonBody({ reason: 'x'.repeat(500) }).ok).toBe(true);
    expect(parseReasonBody({ reason: 'x'.repeat(501) })).toMatchObject({ ok: false, code: 'INVALID_REASON' });
    expect(parseReasonBody({ reason: 'ok', extra: 1 })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(parseReasonBody(null)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('generates a correlation id when absent, echoes a valid one and rejects malformed ids', () => {
    expect(resolveCorrelationId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveCorrelationId(uuid.toUpperCase())).toBe(uuid);
    expect(resolveCorrelationId('not-a-uuid')).toBeNull();
  });

  it('validates the idempotency key header', () => {
    expect(parseIdempotencyKey(undefined)).toEqual({ ok: true, key: undefined });
    expect(parseIdempotencyKey('abc-123')).toEqual({ ok: true, key: 'abc-123' });
    expect(parseIdempotencyKey('')).toEqual({ ok: false });
    expect(parseIdempotencyKey('x'.repeat(201))).toEqual({ ok: false });
    expect(parseIdempotencyKey('has space')).toEqual({ ok: false });
  });

  it('requires an explicit verifiedInfraFailure and a bounded public reason for rerun', () => {
    const base = { reason: 'infra', publicReason: 'Worker restarted', verifiedInfraFailure: true };
    expect(parseRerunBody(base)).toMatchObject({ ok: true, value: { verifiedInfraFailure: true } });
    expect(parseRerunBody({ ...base, verifiedInfraFailure: false })).toMatchObject({ ok: false, code: 'RERUN_CONFIRMATION_REQUIRED' });
    expect(parseRerunBody({ reason: 'infra', publicReason: 'x' })).toMatchObject({ ok: false, code: 'RERUN_CONFIRMATION_REQUIRED' });
    expect(parseRerunBody({ ...base, publicReason: '' })).toMatchObject({ ok: false, code: 'INVALID_PUBLIC_REASON' });
    expect(parseRerunBody({ ...base, publicReason: 'x'.repeat(201) })).toMatchObject({ ok: false, code: 'INVALID_PUBLIC_REASON' });
    expect(parseRerunBody({ ...base, caseId: uuid })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(parseCancelBody({ reason: 'r', publicReason: 'p' })).toMatchObject({ ok: true, value: { reason: 'r', publicReason: 'p' } });
    expect(parseCancelBody({ reason: 'r', publicReason: 'p', caseId: uuid })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
  });

  it('parses audit queries with bounded pagination and typed filters', () => {
    expect(parseAuditQuery({})).toMatchObject({ ok: true, value: { page: 1, pageSize: 50, targetType: null } });
    expect(parseAuditQuery({ targetType: 'MATCH', targetId: uuid, actorAccountId: uuid, action: 'MATCH_RERUN', from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z', page: '2', pageSize: '10' })).toMatchObject({ ok: true, value: { page: 2, pageSize: 10 } });
    for (const bad of [{ pageSize: '101' }, { page: '0' }, { targetId: 'x' }, { action: 'lower' }, { from: 'yesterday' }, { unknown: '1' }]) {
      expect(parseAuditQuery(bad)).toMatchObject({ ok: false, code: 'INVALID_QUERY' });
    }
  });
});

describe('operations rerun eligibility', () => {
  const eligible: RerunEligibilityInput = {
    matchStatus: 'FAILED', hasResult: false, latestAttemptStatus: 'FAILED_TERMINAL', latestFailureReason: 'MATCH_LEASE_EXPIRED',
    roundStatus: 'SCHEDULED', seriesStatus: 'CANCELLED', seriesCancellationReason: 'INFRASTRUCTURE_FAILURE',
    hasRatingLedger: false, hasPendingRerun: false,
  };

  it('keeps the closed infra allowlist exactly as planned', () => {
    expect([...INFRA_FAILURE_REASONS].sort()).toEqual([
      'MATCH_EVENT_LOG_INTEGRITY_FAILED', 'MATCH_EXECUTION_FAILED', 'MATCH_LEASE_EXPIRED', 'SANDBOX_NOT_RUNNING', 'SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH',
    ]);
  });

  it('accepts every allowlisted reason and a still-scheduled series', () => {
    for (const reason of INFRA_FAILURE_REASONS) {
      expect(evaluateRerunEligibility({ ...eligible, latestFailureReason: reason })).toEqual({ ok: true });
    }
    expect(evaluateRerunEligibility({ ...eligible, seriesStatus: 'SCHEDULED', seriesCancellationReason: null })).toEqual({ ok: true });
  });

  it.each([
    ['match not FAILED', { matchStatus: 'SCHEDULED' }, 'RERUN_MATCH_NOT_FAILED'],
    ['match FINALIZED', { matchStatus: 'FINALIZED' }, 'RERUN_MATCH_NOT_FAILED'],
    ['result exists', { hasResult: true }, 'RERUN_RESULT_EXISTS'],
    ['no attempt', { latestAttemptStatus: null, latestFailureReason: null }, 'RERUN_NOT_INFRA_FAILURE'],
    ['retryable attempt', { latestAttemptStatus: 'FAILED_RETRYABLE' }, 'RERUN_NOT_INFRA_FAILURE'],
    ['null reason', { latestFailureReason: null }, 'RERUN_NOT_INFRA_FAILURE'],
    ['unknown reason', { latestFailureReason: 'BOT_CRASHED' }, 'RERUN_NOT_INFRA_FAILURE'],
    ['ARTIFACT_* reason', { latestFailureReason: 'ARTIFACT_DOCKER_IDENTITY_MISMATCH' }, 'RERUN_NOT_INFRA_FAILURE'],
    ['MATCH_RESULT_CONFLICT', { latestFailureReason: 'MATCH_RESULT_CONFLICT' }, 'RERUN_NOT_INFRA_FAILURE'],
    ['round FINALIZED', { roundStatus: 'FINALIZED' }, 'RERUN_ROUND_SETTLED'],
    ['ledger exists', { hasRatingLedger: true }, 'RERUN_ROUND_SETTLED'],
    ['series FINALIZED', { seriesStatus: 'FINALIZED' }, 'RERUN_ROUND_SETTLED'],
    ['series cancelled by operator', { seriesCancellationReason: 'MATCH_CANCELLED' }, 'RERUN_SERIES_CANCELLED_BY_OPERATOR'],
    ['rerun pending', { hasPendingRerun: true }, 'RERUN_ALREADY_PENDING'],
  ] as const)('refuses: %s', (_name, patch, code) => {
    expect(evaluateRerunEligibility({ ...eligible, ...patch })).toEqual({ ok: false, code });
  });
});

describe('operations export sanitizer', () => {
  it('strips every secret-looking key recursively and keeps the rest', () => {
    const dirty = {
      ok: 1,
      seed: 'SEED_SENTINEL',
      matchSeed: 'SEED_SENTINEL',
      nested: { password: 'PASSWORD_SENTINEL', password_hash: 'x', stderr: 'STDERR_SENTINEL', keep: 'yes', list: [{ objectKey: 'k', object_key: 'k', apiToken: 't', credential: 'c', client_secret: 's', fine: 2 }] },
    };
    const clean = JSON.stringify(stripSecretKeys(dirty));
    for (const sentinel of ['SEED_SENTINEL', 'PASSWORD_SENTINEL', 'STDERR_SENTINEL']) expect(clean).not.toContain(sentinel);
    expect(JSON.parse(clean)).toEqual({ ok: 1, nested: { keep: 'yes', list: [{ fine: 2 }] } });
  });

  it('exports only allowlisted audit fields', () => {
    const record = sanitizeAuditRecord({
      id: 'a', actorAccountId: 'b', action: 'X', targetType: 'T', targetId: 'c', reason: 'r', correlationId: 'd', createdAt: '2026-10-18T00:00:00Z',
      details: { before: { status: 'A' }, after: { status: 'B' }, seed: 'SEED_SENTINEL' },
      passwordHash: 'PASSWORD_SENTINEL', idempotencyKey: 'abc', internal: 'nope',
    });
    expect(Object.keys(record).every((key) => (AUDIT_EXPORT_FIELDS as readonly string[]).includes(key))).toBe(true);
    expect(JSON.stringify(record)).not.toMatch(/SENTINEL|nope|abc/);
    expect(record.details).toEqual({ before: { status: 'A' }, after: { status: 'B' } });
  });

  it('serializes audit records as NDJSON', () => {
    const record = sanitizeAuditRecord({ id: 'a', action: 'X', details: { stderr: 'STDERR_SENTINEL', after: { ok: true } } });
    const ndjson = toNdjson([record, record]);
    expect(ndjson.split('\n').filter(Boolean)).toHaveLength(2);
    expect(ndjson).not.toMatch(/SENTINEL/);
    expect(JSON.parse(ndjson.split('\n')[0]!).details).toEqual({ after: { ok: true } });
    expect(toNdjson([])).toBe('');
  });
});
