import { describe, expect, it } from 'vitest';
import {
  AUDIT_EXPORT_FIELDS,
  sanitizeAuditRecord,
  sanitizeCaseRecord,
  stripSecretKeys,
  toNdjson,
} from '../src/modules/operations/export.ts';
import {
  CASE_DECISIONS,
  CASE_STATUSES,
  INFRA_FAILURE_REASONS,
  canTransitionCase,
  evaluateRerunEligibility,
  isDecisionAllowedForKind,
  parseAuditQuery,
  parseCancelBody,
  parseDecisionBody,
  parseEvidence,
  parseIdempotencyKey,
  parseOpenCaseBody,
  parseReasonBody,
  parseRerunBody,
  parseStatusBody,
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
    expect(parseRerunBody(base)).toMatchObject({ ok: true, value: { verifiedInfraFailure: true, caseId: null } });
    expect(parseRerunBody({ ...base, verifiedInfraFailure: false })).toMatchObject({ ok: false, code: 'RERUN_CONFIRMATION_REQUIRED' });
    expect(parseRerunBody({ reason: 'infra', publicReason: 'x' })).toMatchObject({ ok: false, code: 'RERUN_CONFIRMATION_REQUIRED' });
    expect(parseRerunBody({ ...base, publicReason: '' })).toMatchObject({ ok: false, code: 'INVALID_PUBLIC_REASON' });
    expect(parseRerunBody({ ...base, publicReason: 'x'.repeat(201) })).toMatchObject({ ok: false, code: 'INVALID_PUBLIC_REASON' });
    expect(parseRerunBody({ ...base, caseId: 'bad' })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(parseCancelBody({ reason: 'r', publicReason: 'p', caseId: uuid })).toMatchObject({ ok: true, value: { caseId: uuid } });
  });

  it('validates case bodies: kind, subject and allowlisted evidence', () => {
    const evidence = { summary: 'same layers', similarity: 0.97 };
    expect(parseOpenCaseBody({ reason: 'r', kind: 'ANOMALY', matchId: uuid, evidence })).toMatchObject({ ok: true });
    expect(parseOpenCaseBody({ reason: 'r', kind: 'ANOMALY', evidence })).toMatchObject({ ok: false, code: 'CASE_SUBJECT_REQUIRED' });
    expect(parseOpenCaseBody({ reason: 'r', kind: 'APPEAL', matchId: uuid, evidence })).toMatchObject({ ok: false, code: 'CASE_SUBJECT_REQUIRED' });
    expect(parseOpenCaseBody({ reason: 'r', kind: 'DUPLICATE', teamId: uuid, evidence })).toMatchObject({ ok: false, code: 'CASE_SUBJECT_REQUIRED' });
    expect(parseOpenCaseBody({ reason: 'r', kind: 'OTHER', matchId: uuid, evidence })).toMatchObject({ ok: false, code: 'INVALID_CASE_KIND' });
    expect(parseOpenCaseBody({ reason: 'r', kind: 'ANOMALY', matchId: 'x', evidence })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(parseOpenCaseBody({ reason: 'r', kind: 'ANOMALY', matchId: uuid })).toMatchObject({ ok: false, code: 'INVALID_EVIDENCE' });
  });

  it('rejects non-allowlisted, secret-looking, nested and oversized evidence', () => {
    expect(parseEvidence({ summary: 'ok', links: ['a', 'b'], confirmed: true })).not.toBeNull();
    expect(parseEvidence({ seed: 'SEED_SENTINEL' })).toBeNull();
    expect(parseEvidence({ stderr: 'STDERR_SENTINEL' })).toBeNull();
    expect(parseEvidence({ unknownKey: 'x' })).toBeNull();
    expect(parseEvidence({ summary: { nested: 1 } })).toBeNull();
    expect(parseEvidence({ summary: 'x'.repeat(1001) })).toBeNull();
    expect(parseEvidence({})).toBeNull();
    expect(parseEvidence(['x'])).toBeNull();
    expect(parseEvidence({ links: Array.from({ length: 21 }, () => 'a') })).toBeNull();
    expect(parseEvidence(Object.fromEntries(['summary', 'source', 'note', 'links', 'matchId'].map((key) => [key, 'x'.repeat(1000)])))).toBeNull();
  });

  it('accepts only UNDER_REVIEW and CLOSED through the status endpoint and known decisions', () => {
    expect(parseStatusBody({ reason: 'r', status: 'UNDER_REVIEW' }).ok).toBe(true);
    expect(parseStatusBody({ reason: 'r', status: 'DECIDED' })).toMatchObject({ ok: false, code: 'INVALID_CASE_STATUS' });
    for (const decision of CASE_DECISIONS) expect(parseDecisionBody({ reason: 'r', decision }).ok).toBe(true);
    expect(parseDecisionBody({ reason: 'r', decision: 'DELETE_EVERYTHING' })).toMatchObject({ ok: false, code: 'INVALID_CASE_DECISION' });
  });

  it('parses audit queries with bounded pagination and typed filters', () => {
    expect(parseAuditQuery({})).toMatchObject({ ok: true, value: { page: 1, pageSize: 50, targetType: null } });
    expect(parseAuditQuery({ targetType: 'MATCH', targetId: uuid, actorAccountId: uuid, action: 'MATCH_RERUN', from: '2026-10-01T00:00:00Z', to: '2026-10-31T00:00:00Z', page: '2', pageSize: '10' })).toMatchObject({ ok: true, value: { page: 2, pageSize: 10 } });
    for (const bad of [{ pageSize: '101' }, { page: '0' }, { targetId: 'x' }, { action: 'lower' }, { from: 'yesterday' }, { unknown: '1' }]) {
      expect(parseAuditQuery(bad)).toMatchObject({ ok: false, code: 'INVALID_QUERY' });
    }
  });
});

describe('operations case state machine', () => {
  const allowed = new Set(['OPEN>UNDER_REVIEW', 'OPEN>DECIDED', 'UNDER_REVIEW>DECIDED', 'DECIDED>CLOSED']);
  it('allows exactly OPEN→UNDER_REVIEW→DECIDED→CLOSED and OPEN→DECIDED', () => {
    for (const from of CASE_STATUSES) {
      for (const to of CASE_STATUSES) {
        expect(canTransitionCase(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it('keeps appeal outcomes for appeals only', () => {
    expect(isDecisionAllowedForKind('APPEAL', 'APPEAL_UPHELD')).toBe(true);
    expect(isDecisionAllowedForKind('ANOMALY', 'APPEAL_REJECTED')).toBe(false);
    expect(isDecisionAllowedForKind('DUPLICATE', 'REVOKE_SUBMISSION')).toBe(true);
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

  it('exports cases with events and no secrets, as NDJSON', () => {
    const record = sanitizeCaseRecord({
      id: 'c', kind: 'ANOMALY', status: 'OPEN', openedBy: 'u', secretNote: 'PASSWORD_SENTINEL',
      events: [{ seq: 1, eventType: 'OPENED', reason: 'r', evidence: { summary: 's', stderr: 'STDERR_SENTINEL' }, token: 'PASSWORD_SENTINEL', caseId: 'dropped' }],
    });
    const ndjson = toNdjson([record, record]);
    expect(ndjson.split('\n').filter(Boolean)).toHaveLength(2);
    expect(ndjson).not.toMatch(/SENTINEL|dropped/);
    expect(JSON.parse(ndjson.split('\n')[0]!).events[0]).toEqual({ seq: 1, eventType: 'OPENED', reason: 'r', evidence: { summary: 's' } });
    expect(toNdjson([])).toBe('');
  });
});
