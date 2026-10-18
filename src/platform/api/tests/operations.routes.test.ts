import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { registerOperationsRoutes } from '../src/modules/operations/routes.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';

const uuid = '3f1b7c64-9d0e-4a53-8e55-0b1f4c2d7a11';
const correlation = '0a0a0a0a-1111-4222-8333-444444444444';

const anonymous = null;
const team: SessionPrincipal = { accountId: 'team-account', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
const btc: SessionPrincipal = { accountId: uuid, role: 'BTC_ADMIN', teamId: undefined };

type Handler = (text: string, values?: readonly unknown[]) => { rows: unknown[]; rowCount?: number } | undefined;

function createApp(principal: SessionPrincipal | null, handler: Handler = () => undefined, extras: { sessionStore?: { revokeAccount: ReturnType<typeof vi.fn> } } = {}) {
  const calls: { text: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    calls.push({ text, values });
    return handler(text, values) ?? { rows: [], rowCount: 0 };
  });
  const database = {
    query,
    transaction: vi.fn(async (work: (tx: Database) => Promise<unknown>) => work({ query, transaction: vi.fn(), close: vi.fn() } as unknown as Database)),
    close: vi.fn(),
  } as unknown as Database;
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal; });
  registerOperationsRoutes(app, { database, ...(extras.sessionStore ? { sessionStore: extras.sessionStore as never } : {}) });
  return { app, query, calls, database };
}

const adminEndpoints: readonly { readonly method: 'GET' | 'POST'; readonly url: string; readonly body?: unknown }[] = [
  { method: 'POST', url: `/teams/${uuid}/suspend`, body: { reason: 'cheating' } },
  { method: 'POST', url: `/teams/${uuid}/unsuspend`, body: { reason: 'cleared' } },
  { method: 'POST', url: `/submissions/${uuid}/revoke`, body: { reason: 'malicious' } },
  { method: 'POST', url: `/matches/${uuid}/cancel`, body: { reason: 'r', publicReason: 'p' } },
  { method: 'POST', url: `/matches/${uuid}/rerun`, body: { reason: 'r', publicReason: 'p', verifiedInfraFailure: true } },
  { method: 'GET', url: '/audit' },
  { method: 'GET', url: '/audit/export' },
];
const base = '/api/v1/admin/operations';

describe('removed cases routes (P3-D27)', () => {
  it.each([
    { method: 'POST', url: '/cases', payload: { reason: 'r', kind: 'ANOMALY', matchId: uuid, evidence: { summary: 's' } } },
    { method: 'GET', url: '/cases' },
    { method: 'GET', url: `/cases/${uuid}` },
    { method: 'GET', url: '/cases/export' },
  ] as const)('$method $url is no longer registered: 404 for a BTC admin, database untouched', async ({ method, url, ...rest }) => {
    const { app, query } = createApp(btc);
    const response = await app.inject({ method, url: base + url, ...rest });
    expect(response.statusCode).toBe(404);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('operations RBAC matrix', () => {
  it.each(adminEndpoints)('$method $url: anonymous 401, TEAM 403, BTC passes the gate', async ({ method, url, body }) => {
    for (const [principal, expected] of [[anonymous, 401], [team, 403]] as const) {
      const { app, query } = createApp(principal);
      const response = await app.inject({ method, url: base + url, ...(body === undefined ? {} : { payload: body as object }) });
      expect(response.statusCode).toBe(expected);
      expect(query).not.toHaveBeenCalled();
      await app.close();
    }
    const { app } = createApp(btc);
    const response = await app.inject({ method, url: base + url, ...(body === undefined ? {} : { payload: body as object }) });
    expect([401, 403, 500]).not.toContain(response.statusCode);
    await app.close();
  });

  it('serves the public override list without authentication', async () => {
    const { app } = createApp(anonymous, () => ({ rows: [] }));
    const response = await app.inject({ method: 'GET', url: '/api/v1/public/queue-overrides' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { items: [] } });
    await app.close();
  });
});

describe('operations request validation', () => {
  it('requires a reason on every mutation and never touches the database without one', async () => {
    for (const endpoint of adminEndpoints.filter(({ method }) => method === 'POST')) {
      const { app, query } = createApp(btc);
      const { reason: _reason, ...withoutReason } = endpoint.body as Record<string, unknown>;
      const response = await app.inject({ method: 'POST', url: base + endpoint.url, payload: withoutReason });
      expect(response.statusCode, endpoint.url).toBe(400);
      expect(response.json().error.code).toBe('INVALID_REASON');
      expect(query).not.toHaveBeenCalled();
      await app.close();
    }
  });

  it('rejects an over-long reason, malformed ids and a rerun without explicit confirmation', async () => {
    const { app, query } = createApp(btc);
    const long = await app.inject({ method: 'POST', url: `${base}/teams/${uuid}/suspend`, payload: { reason: 'x'.repeat(501) } });
    expect(long.statusCode).toBe(400);
    const badId = await app.inject({ method: 'POST', url: `${base}/teams/not-a-uuid/suspend`, payload: { reason: 'ok' } });
    expect(badId.statusCode).toBe(404);
    const noConfirm = await app.inject({ method: 'POST', url: `${base}/matches/${uuid}/rerun`, payload: { reason: 'r', publicReason: 'p' } });
    expect(noConfirm.statusCode).toBe(400);
    expect(noConfirm.json().error.code).toBe('RERUN_CONFIRMATION_REQUIRED');
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects malformed correlation and idempotency headers', async () => {
    const { app, query } = createApp(btc);
    const badCorrelation = await app.inject({ method: 'POST', url: `${base}/teams/${uuid}/suspend`, headers: { 'x-correlation-id': 'nope' }, payload: { reason: 'ok' } });
    expect(badCorrelation.statusCode).toBe(400);
    expect(badCorrelation.json().error.code).toBe('INVALID_CORRELATION_ID');
    const badKey = await app.inject({ method: 'POST', url: `${base}/teams/${uuid}/suspend`, headers: { 'idempotency-key': 'a b' }, payload: { reason: 'ok' } });
    expect(badKey.statusCode).toBe(400);
    expect(badKey.json().error.code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an unfiltered audit query with bad pagination', async () => {
    const { app, query } = createApp(btc);
    const response = await app.inject({ method: 'GET', url: `${base}/audit?pageSize=1000` });
    expect(response.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('operations correlation id and audit', () => {
  const suspendHandler: Handler = (text) => {
    if (text.startsWith('SELECT id FROM teams')) return { rows: [{ id: uuid }] };
    if (text.startsWith('SELECT id, status FROM accounts')) return { rows: [{ id: 'acc-1', status: 'ACTIVE' }] };
    if (text.startsWith('UPDATE sessions')) return { rows: [], rowCount: 2 };
    return undefined;
  };

  it('echoes a supplied correlation id in the header and body and writes one audit row with before/after', async () => {
    const revokeAccount = vi.fn(async () => undefined);
    const { app, calls } = createApp(btc, suspendHandler, { sessionStore: { revokeAccount } });
    const response = await app.inject({
      method: 'POST', url: `${base}/teams/${uuid}/suspend`,
      headers: { 'x-correlation-id': correlation, 'idempotency-key': 'key-1' }, payload: { reason: 'confirmed cheating' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-correlation-id']).toBe(correlation);
    expect(response.json()).toEqual({
      data: { accounts: 1, active: 0, disabled: 1, sessionsRevoked: 2, replayed: false },
      correlationId: correlation,
    });
    const audits = calls.filter(({ text }) => text.includes('INSERT INTO audit_events'));
    expect(audits).toHaveLength(1);
    const values = audits[0]!.values!;
    expect(values[2]).toBe('TEAM_SUSPENDED');
    expect(values[5]).toBe('confirmed cheating');
    expect(values[6]).toBe(correlation);
    expect(values[8]).toBe('key-1');
    const details = JSON.parse(values[7] as string) as { before: unknown; after: unknown };
    expect(details.before).toEqual({ accounts: 1, active: 1, disabled: 0 });
    expect(details.after).toEqual({ accounts: 1, active: 0, disabled: 1, sessionsRevoked: 2 });
    expect(revokeAccount).toHaveBeenCalledWith('acc-1');
    await app.close();
  });

  it('generates and echoes a correlation id when the header is absent, also on errors', async () => {
    const { app } = createApp(btc, (text) => (text.startsWith('SELECT id FROM teams') ? { rows: [] } : undefined));
    const response = await app.inject({ method: 'POST', url: `${base}/teams/${uuid}/suspend`, payload: { reason: 'ok' } });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('TEAM_NOT_FOUND');
    const generated = response.headers['x-correlation-id'];
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.json().correlationId).toBe(generated);
    await app.close();
  });

  it('returns the stored outcome on an idempotent replay without writing a second audit row', async () => {
    const stored = { details: { requestHash: 'will-be-replaced', after: { accounts: 1, active: 0, disabled: 1, sessionsRevoked: 2 } } };
    let capturedHash = '';
    const { app, calls } = createApp(btc, (text, values) => {
      if (text.startsWith('SELECT details FROM audit_events')) return { rows: [{ details: { ...stored.details, requestHash: capturedHash } }] };
      return suspendHandler(text, values);
    });
    // First call computes the hash the service stores; reuse it for the replay lookup.
    const first = createApp(btc, suspendHandler);
    await first.app.inject({ method: 'POST', url: `${base}/teams/${uuid}/suspend`, headers: { 'idempotency-key': 'k' }, payload: { reason: 'same' } });
    capturedHash = (JSON.parse(first.calls.find(({ text }) => text.includes('INSERT INTO audit_events'))!.values![7] as string) as { requestHash: string }).requestHash;
    await first.app.close();

    const replay = await app.inject({ method: 'POST', url: `${base}/teams/${uuid}/suspend`, headers: { 'idempotency-key': 'k' }, payload: { reason: 'same' } });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toEqual({ accounts: 1, active: 0, disabled: 1, sessionsRevoked: 2, replayed: true });
    expect(calls.filter(({ text }) => text.includes('INSERT INTO audit_events'))).toHaveLength(0);

    const changed = await app.inject({ method: 'POST', url: `${base}/teams/${uuid}/suspend`, headers: { 'idempotency-key': 'k' }, payload: { reason: 'different payload' } });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await app.close();
  });
});

describe('operations rerun and cancel gates (mocked rows)', () => {
  function rerunHandler(over: { match?: object; attempt?: object | null; result?: boolean; ledger?: boolean; pending?: boolean }): Handler {
    return (text) => {
      if (text.includes('FROM matches m') && text.includes('FOR UPDATE OF m, s')) {
        return { rows: [{ status: 'FAILED', series_id: 's1', series_status: 'CANCELLED', cancellation_reason: 'INFRASTRUCTURE_FAILURE', round_status: 'SCHEDULED', ...over.match }] };
      }
      if (text.includes('FROM match_results')) return { rows: over.result ? [{}] : [] };
      if (text.includes('FROM match_attempts')) return { rows: over.attempt === null ? [] : [{ id: 'a1', attempt_number: 1, status: 'FAILED_TERMINAL', failure_reason: 'MATCH_LEASE_EXPIRED', ...over.attempt }] };
      if (text.includes('FROM rating_ledger')) return { rows: over.ledger ? [{}] : [] };
      if (text.includes("event_type = 'MATCH_RERUN'")) return { rows: over.pending ? [{}] : [] };
      if (text.includes("event_type = 'MATCH_SCHEDULED'")) return { rows: [{ payload: { matchId: uuid } }] };
      if (text.includes('MAX(generation)')) return { rows: [{ generation: 1 }] };
      return undefined;
    };
  }
  const rerun = { reason: 'infra restart', publicReason: 'Worker restarted', verifiedInfraFailure: true };

  it('creates one MATCH_RERUN outbox row, one queue override and one audit row for an eligible match', async () => {
    const { app, calls } = createApp(btc, rerunHandler({}));
    const response = await app.inject({ method: 'POST', url: `${base}/matches/${uuid}/rerun`, payload: rerun });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ matchStatus: 'SCHEDULED', seriesStatus: 'SCHEDULED', outboxGeneration: 1, replayed: false });
    const texts = calls.map(({ text }) => text);
    expect(texts.filter((text) => text.includes("INSERT INTO match_outbox"))).toHaveLength(1);
    expect(texts.filter((text) => text.includes('INSERT INTO queue_overrides'))).toHaveLength(1);
    expect(texts.filter((text) => text.includes('INSERT INTO audit_events'))).toHaveLength(1);
    expect(texts.some((text) => /INSERT INTO match_results|INSERT INTO rating_ledger/.test(text))).toBe(false);
    const details = JSON.parse(calls.find(({ text }) => text.includes('INSERT INTO audit_events'))!.values![7] as string) as { before: Record<string, unknown> };
    expect(details.before).toMatchObject({ verifiedInfraFailure: true, lastFailureReason: 'MATCH_LEASE_EXPIRED' });
    await app.close();
  });

  it('writes the queue override without any case reference and refuses caseId in the body', async () => {
    const { app, calls } = createApp(btc, rerunHandler({}));
    const response = await app.inject({ method: 'POST', url: `${base}/matches/${uuid}/rerun`, payload: rerun });
    expect(response.statusCode).toBe(200);
    const insert = calls.find(({ text }) => text.includes('INSERT INTO queue_overrides'))!;
    expect(insert.text).not.toMatch(/case_id/);
    expect(insert.values).toHaveLength(6);
    const refused = await app.inject({ method: 'POST', url: `${base}/matches/${uuid}/rerun`, payload: { ...rerun, caseId: uuid } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('INVALID_REQUEST');
    await app.close();
  });

  it.each([
    ['bot-fault style reason', { attempt: { failure_reason: 'BOT_PROTOCOL_VIOLATION' } }, 'RERUN_NOT_INFRA_FAILURE'],
    ['no attempt at all', { attempt: null }, 'RERUN_NOT_INFRA_FAILURE'],
    ['already resulted', { result: true }, 'RERUN_RESULT_EXISTS'],
    ['round finalized', { match: { round_status: 'FINALIZED' } }, 'RERUN_ROUND_SETTLED'],
    ['ratings applied', { ledger: true }, 'RERUN_ROUND_SETTLED'],
    ['operator-cancelled series', { match: { cancellation_reason: 'MATCH_CANCELLED' } }, 'RERUN_SERIES_CANCELLED_BY_OPERATOR'],
    ['rerun already pending', { pending: true }, 'RERUN_ALREADY_PENDING'],
    ['match not failed', { match: { status: 'FINALIZED' } }, 'RERUN_MATCH_NOT_FAILED'],
  ] as const)('refuses with 409 and writes nothing: %s', async (_name, over, code) => {
    const { app, calls } = createApp(btc, rerunHandler(over));
    const response = await app.inject({ method: 'POST', url: `${base}/matches/${uuid}/rerun`, payload: rerun });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe(code);
    expect(calls.some(({ text }) => /^(INSERT|UPDATE|DELETE)/.test(text))).toBe(false);
    await app.close();
  });

  it('refuses to cancel a RUNNING or FINALIZED match', async () => {
    for (const status of ['RUNNING', 'FINALIZED']) {
      const { app, calls } = createApp(btc, (text) => (text.includes('FROM matches WHERE id') ? { rows: [{ status, series_id: 's1' }] } : undefined));
      const response = await app.inject({ method: 'POST', url: `${base}/matches/${uuid}/cancel`, payload: { reason: 'r', publicReason: 'p' } });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('CANCEL_NOT_ALLOWED');
      expect(calls.some(({ text }) => /^(INSERT|UPDATE)/.test(text))).toBe(false);
      await app.close();
    }
  });

  it('refuses to revoke submissions outside VALID/ACTIVE', async () => {
    for (const status of ['UPLOADED', 'INVALID', 'PREFLIGHT', 'SUPERSEDED', 'REVOKED']) {
      const { app } = createApp(btc, (text) => (text.includes('FROM submissions WHERE id') ? { rows: [{ id: uuid, team_id: 't', status }] } : undefined));
      const response = await app.inject({ method: 'POST', url: `${base}/submissions/${uuid}/revoke`, payload: { reason: 'r' } });
      expect(response.statusCode, status).toBe(409);
      expect(response.json().error.code).toBe('TRANSITION_INVALID');
      await app.close();
    }
  });
});

describe('operations exports and public list', () => {
  it('audit export strips secrets from details and never emits non-allowlisted columns', async () => {
    const { app } = createApp(btc, (text) => (text.includes('FROM audit_events') ? {
      rows: [{
        id: 'a', actor_account_id: uuid, action: 'MATCH_RERUN', target_type: 'MATCH', target_id: uuid, reason: 'r', correlation_id: correlation,
        created_at: new Date('2026-10-18T00:00:00Z'), details: { before: { status: 'FAILED' }, after: { seed: 'SEED_SENTINEL', stderr: 'STDERR_SENTINEL', status: 'SCHEDULED' } },
      }],
    } : undefined));
    const response = await app.inject({ method: 'GET', url: `${base}/audit/export` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    expect(response.body).not.toMatch(/SENTINEL/);
    expect(JSON.parse(response.body.trim()).details.after).toEqual({ status: 'SCHEDULED' });
    await app.close();
  });

  it('public override list exposes only id, action, opaque match id, public reason and time', async () => {
    const { app } = createApp(anonymous, () => ({
      rows: [{ id: 'o1', action: 'RERUN', match_id: uuid, public_reason: 'Worker restarted', created_at: new Date('2026-10-18T00:00:00Z'), actor_account_id: 'ADMIN_SENTINEL', case_id: 'CASE_SENTINEL', team_name: 'TEAM_SENTINEL' }],
    }));
    const response = await app.inject({ method: 'GET', url: '/api/v1/public/queue-overrides' });
    const item = response.json().data.items[0];
    expect(Object.keys(item).sort()).toEqual(['action', 'createdAt', 'id', 'matchOpaqueId', 'publicReason']);
    expect(item.matchOpaqueId).toMatch(/^[0-9a-f]{16}$/);
    expect(item.matchOpaqueId).not.toContain(uuid.slice(0, 8));
    expect(response.body).not.toMatch(/SENTINEL/);
    await app.close();
  });
});
