import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestRun, TestRunApiError } from './api.ts';
import { ids, installRouteFetch } from '../../test/route-fixtures.ts';

describe('test-run API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the intent key and parses the created run', async () => {
    const api = installRouteFetch('TEAM_ACCOUNT');
    const run = await createTestRun({ submissionId: ids.submission, opponentType: 'BTC_REFERENCE', opponentReferenceBot: 'FIRST_LEGAL' }, 'intent-12345678');
    expect(run.status).toBe('QUEUED');
    expect(api.requests).toContain('POST /api/v1/test-runs');
    expect(fetch).toHaveBeenCalledWith('/api/v1/test-runs', expect.objectContaining({
      headers: expect.objectContaining({ 'Idempotency-Key': 'intent-12345678' }),
    }));
  });

  it('preserves structured API errors for quota and pause handling', async () => {
    installRouteFetch('TEAM_ACCOUNT');
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: 'TEST_RUN_QUOTA_EXCEEDED' } }), {
      status: 429, headers: { 'content-type': 'application/json' },
    }));
    const quotaError = await createTestRun({ submissionId: ids.submission, opponentType: 'BTC_REFERENCE', opponentReferenceBot: 'FIRST_LEGAL' }, 'intent-12345678').catch((error: unknown) => error);
    expect(quotaError).toBeInstanceOf(TestRunApiError);
    expect(quotaError).toMatchObject({ status: 429, code: 'TEST_RUN_QUOTA_EXCEEDED' });
  });
});
