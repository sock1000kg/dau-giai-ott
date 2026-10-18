import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';
import { evaluateGate, GateError, type GateGameInput } from '../src/modules/qualification-gate/gate.ts';
import { registerQualificationGateRoutes } from '../src/modules/qualification-gate/routes.ts';
import { recordGateResult } from '../src/modules/qualification-gate/service.ts';

const win = (submissionSide: 'X' | 'O'): GateGameInput => ({ state: 'FINALIZED', submissionSide, winnerSide: submissionSide });
const loss = (submissionSide: 'X' | 'O'): GateGameInput => ({ state: 'FINALIZED', submissionSide, winnerSide: submissionSide === 'X' ? 'O' : 'X' });
const draw = (submissionSide: 'X' | 'O'): GateGameInput => ({ state: 'FINALIZED', submissionSide, winnerSide: null });

describe('evaluateGate', () => {
  it.each([
    ['win + loss', win('X'), loss('O'), 1, 'PASS'],
    ['loss + win', loss('X'), win('O'), 1, 'PASS'],
    ['draw + draw', draw('X'), draw('O'), 1, 'PASS'],
    ['win + win', win('X'), win('O'), 2, 'PASS'],
    ['win + draw', win('O'), draw('X'), 1.5, 'PASS'],
    ['draw + loss', draw('X'), loss('O'), 0.5, 'FAIL'],
    ['loss + loss', loss('X'), loss('O'), 0, 'FAIL'],
  ] as const)('%s', (_name, game1, game2, points, outcome) => {
    expect(evaluateGate(game1, game2)).toMatchObject({ state: 'DECIDED', points, outcome });
  });

  it('reports per-game points', () => {
    expect(evaluateGate(win('X'), draw('O'))).toEqual({ state: 'DECIDED', game1Points: 1, game2Points: 0.5, points: 1.5, outcome: 'PASS' });
  });

  it('rejects games that are not side-swapped', () => {
    for (const [a, b] of [[win('X'), win('X')], [loss('O'), win('O')]] as const) {
      try { evaluateGate(a, b); expect.unreachable(); } catch (error) {
        expect(error).toBeInstanceOf(GateError);
        expect(error).toMatchObject({ code: 'GATE_SIDES_NOT_SWAPPED', statusCode: 422 });
      }
    }
  });

  it.each(['PENDING', 'INFRA_FAILED', 'CANCELLED'] as const)('%s game yields GATE_PENDING, never a FAIL', (state) => {
    expect(evaluateGate({ state, submissionSide: 'X' }, win('O'))).toEqual({ state: 'PENDING', reason: 'GATE_PENDING' });
    expect(evaluateGate(loss('X'), { state, submissionSide: 'O' })).toEqual({ state: 'PENDING', reason: 'GATE_PENDING' });
    expect(evaluateGate({ state, submissionSide: 'X' }, { state, submissionSide: 'O' })).toEqual({ state: 'PENDING', reason: 'GATE_PENDING' });
  });
});

// ---------------------------------------------------------------- routes
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUB = uuid(1);
const M1 = uuid(2);
const M2 = uuid(3);
const DIGEST = `sha256:${'a'.repeat(64)}`;
const correlation = '0a0a0a0a-1111-4222-8333-444444444444';
const team: SessionPrincipal = { accountId: 'team-account', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
const btc: SessionPrincipal = { accountId: uuid(9), role: 'BTC_ADMIN', teamId: undefined };
const body = { reason: 'gate run', submissionId: SUB, gateBotDigest: DIGEST, game1MatchId: M1, game2MatchId: M2 };

type Handler = (sql: string, values: readonly unknown[]) => { rows: unknown[] } | undefined;

function createDb(handler: Handler = () => undefined) {
  const calls: { sql: string; values: readonly unknown[] }[] = [];
  const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    calls.push({ sql, values });
    return handler(sql, values) ?? { rows: [], rowCount: 0 };
  });
  const database = {
    query,
    transaction: vi.fn(async (work: (tx: Database) => Promise<unknown>) => work({ query } as unknown as Database)),
  } as unknown as Database;
  return { database, calls, query };
}

function createApp(principal: SessionPrincipal | null, handler?: Handler) {
  const db = createDb(handler);
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal; });
  registerQualificationGateRoutes(app, { database: db.database });
  return { app, ...db };
}

const base = '/api/v1/admin/qualification-gate';

describe('qualification gate routes', () => {
  it.each([
    ['POST', `${base}/results`],
    ['GET', `${base}/submissions/${SUB}`],
  ] as const)('%s %s: anonymous 401, TEAM 403', async (method, url) => {
    for (const [principal, status] of [[null, 401], [team, 403]] as const) {
      const { app, query } = createApp(principal);
      const response = await app.inject({ method, url, ...(method === 'POST' ? { payload: body } : {}) });
      expect(response.statusCode).toBe(status);
      expect(query).not.toHaveBeenCalled();
      await app.close();
    }
  });

  it('BTC passes RBAC and a missing submission is a 404 with the correlation id echoed', async () => {
    const { app } = createApp(btc);
    const response = await app.inject({ method: 'POST', url: `${base}/results`, headers: { 'x-correlation-id': correlation }, payload: body });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-correlation-id']).toBe(correlation);
    expect(response.json()).toMatchObject({ error: { code: 'SUBMISSION_NOT_FOUND' }, correlationId: correlation });
    await app.close();
  });

  it.each([
    ['missing reason', { ...body, reason: undefined }, 'INVALID_REASON'],
    ['blank reason', { ...body, reason: '   ' }, 'INVALID_REASON'],
    ['overlong reason', { ...body, reason: 'x'.repeat(501) }, 'INVALID_REASON'],
    ['bad submission id', { ...body, submissionId: 'nope' }, 'INVALID_REQUEST'],
    ['bad match id', { ...body, game2MatchId: 'nope' }, 'INVALID_REQUEST'],
    ['bad digest', { ...body, gateBotDigest: 'sha256:xyz' }, 'INVALID_REQUEST'],
    ['bad gate bot id', { ...body, gateBotId: 'Capture First' }, 'INVALID_REQUEST'],
    ['client-supplied points', { ...body, points: 2 }, 'INVALID_REQUEST'],
    ['client-supplied outcome', { ...body, outcome: 'PASS' }, 'INVALID_REQUEST'],
  ])('rejects %s before touching the database', async (_name, payload, code) => {
    const { app, query } = createApp(btc);
    const response = await app.inject({ method: 'POST', url: `${base}/results`, payload: payload as object });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe(code);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a malformed correlation id', async () => {
    const { app, query } = createApp(btc);
    const response = await app.inject({ method: 'POST', url: `${base}/results`, headers: { 'x-correlation-id': 'nope' }, payload: body });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_CORRELATION_ID');
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET validates the id and reports rankable state', async () => {
    const bad = createApp(btc);
    expect((await bad.app.inject({ method: 'GET', url: `${base}/submissions/not-a-uuid` })).statusCode).toBe(400);
    await bad.app.close();
    const ok = createApp(btc, (sql) => {
      if (sql.startsWith('SELECT id FROM submissions')) return { rows: [{ id: SUB }] };
      if (sql.includes('FROM submission_gate_results')) return { rows: [{
        id: uuid(7), submission_id: SUB, gate_bot_id: 'capture_first_bot', gate_bot_digest: DIGEST, game1_match_id: M1, game2_match_id: M2,
        game1_points: '1.0', game2_points: '0.0', points: '1.0', outcome: 'PASS', reason: 'ok', created_at: new Date(0),
      }] };
      return undefined;
    });
    const response = await ok.app.inject({ method: 'GET', url: `${base}/submissions/${SUB}`, headers: { 'x-correlation-id': correlation } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ submissionId: SUB, rankable: true, results: [{ outcome: 'PASS', points: 1, game1Points: 1, game2Points: 0 }] });
    expect(response.json().correlationId).toBe(correlation);
    await ok.app.close();
  });
});

// ---------------------------------------------------------------- service with scripted database
interface Scenario {
  readonly submissionExists?: boolean;
  readonly stored?: Record<string, unknown>;
  readonly matches: Record<string, Record<string, unknown>>;
}

function match(id: string, overrides: Record<string, unknown> = {}) {
  return { id, status: 'FINALIZED', x_submission_id: SUB, o_submission_id: uuid(50), x_digest: 'sha256:' + 'b'.repeat(64), o_digest: DIGEST, has_result: true, winner_side: 'O', ...overrides };
}

function scripted(scenario: Scenario) {
  const inserts: { sql: string; values: readonly unknown[] }[] = [];
  const db = createDb((sql, values) => {
    if (sql.startsWith('SELECT id FROM submissions')) return { rows: scenario.submissionExists === false ? [] : [{ id: SUB }] };
    if (sql.includes('FROM submission_gate_results')) return { rows: scenario.stored === undefined ? [] : [scenario.stored] };
    if (sql.includes('FROM matches m')) {
      const found = scenario.matches[values[0] as string];
      return { rows: found === undefined ? [] : [found] };
    }
    if (sql.startsWith('INSERT INTO submission_gate_results')) {
      inserts.push({ sql, values });
      const [id, submission_id, gate_bot_id, gate_bot_digest, game1_match_id, game2_match_id, g1, g2, points, outcome, reason] = values as string[];
      return { rows: [{ id, submission_id, gate_bot_id, gate_bot_digest, game1_match_id, game2_match_id, game1_points: g1, game2_points: g2, points, outcome, reason, created_at: new Date(0) }] };
    }
    if (sql.startsWith('INSERT INTO audit_events')) { inserts.push({ sql, values }); return { rows: [] }; }
    return undefined;
  });
  return { ...db, inserts };
}

const ctx = { actorAccountId: uuid(9), correlationId: correlation, reason: 'gate run' };
const input = { submissionId: SUB, gateBotId: 'capture_first_bot', gateBotDigest: DIGEST, game1MatchId: M1, game2MatchId: M2 };

describe('recordGateResult', () => {
  it('computes points from the finalized results itself and writes one audit row', async () => {
    // game 1: submission is X and the gate bot (O) wins -> 0; game 2: submission is O and wins -> 1
    const s = scripted({ matches: {
      [M1]: match(M1, { winner_side: 'O' }),
      [M2]: match(M2, { x_submission_id: uuid(50), o_submission_id: SUB, x_digest: DIGEST, o_digest: 'sha256:' + 'b'.repeat(64), winner_side: 'O' }),
    } });
    const { result, replayed } = await recordGateResult(s.database, ctx, input);
    expect(replayed).toBe(false);
    expect(result).toMatchObject({ game1Points: 0, game2Points: 1, points: 1, outcome: 'PASS' });
    expect(s.inserts.map(({ sql }) => sql.split(' ').slice(0, 3).join(' '))).toEqual(['INSERT INTO submission_gate_results', 'INSERT INTO audit_events']);
    expect(s.inserts[1]?.values).toContain(correlation);
  });

  it('records FAIL when both games are lost', async () => {
    const s = scripted({ matches: {
      [M1]: match(M1, { winner_side: 'O' }),
      [M2]: match(M2, { x_submission_id: uuid(50), o_submission_id: SUB, x_digest: DIGEST, o_digest: 'sha256:' + 'b'.repeat(64), winner_side: 'X' }),
    } });
    expect((await recordGateResult(s.database, ctx, input)).result).toMatchObject({ points: 0, outcome: 'FAIL' });
  });

  it.each([
    ['not finalized', { status: 'RUNNING', has_result: false }, 'GATE_PENDING', 409],
    ['infra failed', { status: 'FAILED', has_result: false }, 'GATE_PENDING', 409],
    ['cancelled', { status: 'CANCELLED', has_result: false }, 'GATE_PENDING', 409],
    ['foreign submission', { x_submission_id: uuid(60), o_submission_id: uuid(61) }, 'GATE_MATCH_FOREIGN', 422],
    ['other opponent digest', { o_digest: 'sha256:' + 'c'.repeat(64) }, 'GATE_MATCH_FOREIGN', 422],
  ])('rejects a game that is %s', async (_name, overrides, code, status) => {
    const s = scripted({ matches: {
      [M1]: match(M1, overrides),
      [M2]: match(M2, { x_submission_id: uuid(50), o_submission_id: SUB, x_digest: DIGEST, o_digest: 'sha256:' + 'b'.repeat(64) }),
    } });
    await expect(recordGateResult(s.database, ctx, input)).rejects.toMatchObject({ code, statusCode: status });
    expect(s.inserts).toHaveLength(0);
  });

  it('rejects two games played on the same side', async () => {
    const s = scripted({ matches: { [M1]: match(M1), [M2]: match(M2) } });
    await expect(recordGateResult(s.database, ctx, input)).rejects.toMatchObject({ code: 'GATE_SIDES_NOT_SWAPPED', statusCode: 422 });
    expect(s.inserts).toHaveLength(0);
  });

  it('404s for unknown submissions and matches', async () => {
    await expect(recordGateResult(scripted({ submissionExists: false, matches: {} }).database, ctx, input)).rejects.toMatchObject({ code: 'SUBMISSION_NOT_FOUND' });
    await expect(recordGateResult(scripted({ matches: {} }).database, ctx, input)).rejects.toMatchObject({ code: 'GATE_MATCH_NOT_FOUND' });
  });

  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: uuid(7), submission_id: SUB, gate_bot_id: 'capture_first_bot', gate_bot_digest: DIGEST, game1_match_id: M1, game2_match_id: M2,
    game1_points: '0.0', game2_points: '1.0', points: '1.0', outcome: 'PASS', reason: 'ok', created_at: new Date(0), ...overrides,
  });

  it('replays an identical request without new rows', async () => {
    const s = scripted({ stored: stored(), matches: {} });
    const { result, replayed } = await recordGateResult(s.database, ctx, input);
    expect(replayed).toBe(true);
    expect(result.id).toBe(uuid(7));
    expect(s.inserts).toHaveLength(0);
  });

  it('409s when a different match pair is replayed for the same key', async () => {
    const s = scripted({ stored: stored({ game2_match_id: uuid(99) }), matches: {} });
    await expect(recordGateResult(s.database, ctx, input)).rejects.toMatchObject({ code: 'GATE_RESULT_CONFLICT', statusCode: 409 });
    expect(s.inserts).toHaveLength(0);
  });
});
