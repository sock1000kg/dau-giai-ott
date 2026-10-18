import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerRoundRoutes } from '../src/modules/rounds/routes.ts';
import type { Database } from '../src/db/client.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';
import { AuthorizationError } from '../src/modules/auth/authorize.ts';

function createApp(principal: SessionPrincipal | null, query: ReturnType<typeof vi.fn>) {
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal; });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthorizationError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
  const tx = { query, close: vi.fn() };
  const db = {
    query,
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(tx)),
    close: vi.fn(),
  } as unknown as Database;
  registerRoundRoutes(app, { database: db });
  return app;
}

function btcPrincipal(): SessionPrincipal {
  return { accountId: 'btc-account', role: 'BTC_ADMIN', teamId: undefined };
}

function teamPrincipal(): SessionPrincipal {
  return { accountId: 'team-account', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
}

function validRuleSetBody() {
  return {
    tournamentStage: 'QUALIFICATION',
    rules: {
      schemaVersion: 'ott.round-rules.v1',
      engineVersion: '1.0.0',
      mapSet: [{ mapId: 'default', checksum: 'a'.repeat(64) }],
      maxTurns: 200,
      faultPolicyVersion: 'P2_BASELINE_V1',
      timeControl: {
        startupMs: 5000,
        totalBotBudgetMs: 60000,
        matchWallClockMs: 150000,
        perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 },
      },
      resources: {
        memoryMiB: 256,
        milliCpu: 1000,
        pids: 64,
        tmpfsMiB: 64,
        archiveMiB: 512,
        unpackedMiB: 1024,
        maxLayers: 20,
      },
      schedule: {
        submissionOpensAt: '2026-10-14T14:00:00.000Z',
        submissionDeadlineAt: '2026-10-17T23:59:00.000Z',
        graceEndsAt: '2026-10-18T12:00:00.000Z',
        runStartsAt: '2026-10-18T14:00:00.000Z',
        runMaxHours: 48,
        appealEndsAt: '2026-10-21T12:00:00.000Z',
      },
      testRun: {
        quotaPerTeamPerDay: 2,
        opponents: ['BTC_REFERENCE'],
      },
    },
    reason: 'initial rules',
  };
}

function mockRoundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'DRAFT_RULES',
    rule_set_id: null,
    schedule_round_id: null,
    start_idempotency_key: null,
    start_request_hash: null,
    paused_at: null,
    tournament_stage: 'QUALIFICATION',
    ...overrides,
  };
}

describe('P3-D01 round-rules routes', () => {
  it('returns 401 for anonymous users', async () => {
    const app = createApp(null, vi.fn());
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/round-rule-sets?tournamentStage=QUALIFICATION' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('returns 403 for team accounts', async () => {
    const app = createApp(teamPrincipal(), vi.fn());
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/round-rule-sets?tournamentStage=QUALIFICATION' });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
    await app.close();
  });

  it('returns 400 for invalid tournament stage in query', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/round-rule-sets?tournamentStage=invalid!' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('TOURNAMENT_STAGE_INVALID');
    await app.close();
  });

  it('lists rule sets for BTC admin', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: 'rule-set-1',
        version: 1,
        rules_sha256: 'abc123',
        reason: 'initial',
        created_at: new Date('2026-10-14T00:00:00.000Z'),
      }],
    });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/round-rule-sets?tournamentStage=QUALIFICATION' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    await app.close();
  });

  it('returns 201 for valid rule set creation', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ max_version: null }] });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/round-rule-sets',
      payload: validRuleSetBody(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toHaveProperty('id');
    expect(response.json().data).toHaveProperty('version');
    expect(response.json().data).toHaveProperty('rulesSha256');
    await app.close();
  });

  it('returns 400 for unknown keys in rule set body', async () => {
    const query = vi.fn();
    const app = createApp(btcPrincipal(), query);
    const body = { ...validRuleSetBody(), unknownKey: true };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/round-rule-sets',
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('RULE_SET_INVALID');
    await app.close();
  });

  it('returns 400 for invalid rule content', async () => {
    const query = vi.fn();
    const app = createApp(btcPrincipal(), query);
    const body = { ...validRuleSetBody(), rules: { ...validRuleSetBody().rules, schemaVersion: 'wrong' } };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/round-rule-sets',
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('RULE_SET_INVALID');
    await app.close();
  });

  it('returns 404 for non-existent rule set', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/round-rule-sets/00000000-0000-4000-8000-000000000001',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('RULE_SET_NOT_FOUND');
    await app.close();
  });

  it('returns 404 for invalid UUID in path', async () => {
    const query = vi.fn();
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/round-rule-sets/not-a-uuid',
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('lists rounds for BTC admin', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: 'round-1',
        tournament_stage: 'QUALIFICATION',
        round_number: 1,
        status: 'DRAFT_RULES',
        rule_set_id: null,
        schedule_round_id: null,
        paused_at: null,
        created_at: new Date('2026-10-14T00:00:00.000Z'),
      }],
    });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/rounds?tournamentStage=QUALIFICATION' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toHaveLength(1);
    await app.close();
  });

  it('creates a round with valid body', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rounds',
      payload: { tournamentStage: 'QUALIFICATION', reason: 'create round' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toHaveProperty('id');
    expect(response.json().data.status).toBe('DRAFT_RULES');
    await app.close();
  });

  it('returns 400 for round creation without tournamentStage', async () => {
    const query = vi.fn();
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rounds',
      payload: { reason: 'no stage' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for invalid transition body', async () => {
    const query = vi.fn();
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001/pause',
      payload: { wrongKey: true },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for start without Idempotency-Key header', async () => {
    const query = vi.fn();
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001/start',
      payload: { reason: 'start', ruleSetId: '00000000-0000-4000-8000-000000000002' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('IDEMPOTENCY_KEY_INVALID');
    await app.close();
  });

  it('returns 409 for invalid transition (wrong from status)', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [mockRoundRow({ status: 'DRAFT_RULES' })],
    });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001/close',
      payload: { reason: 'cannot close from draft' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ROUND_TRANSITION_INVALID');
    await app.close();
  });

  it('returns the stored rules and tournament stage for a rule set', async () => {
    const rules = validRuleSetBody().rules;
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: '00000000-0000-4000-8000-000000000001',
        tournament_stage: 'QUALIFICATION',
        version: 2,
        rules,
        rules_sha256: 'b'.repeat(64),
        reason: 'second version',
        created_at: new Date('2026-10-14T00:00:00.000Z'),
      }],
    });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/round-rule-sets/00000000-0000-4000-8000-000000000001',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.tournamentStage).toBe('QUALIFICATION');
    expect(response.json().data.rules).toEqual(rules);
    expect(response.json().data.version).toBe(2);
    await app.close();
  });

  it('returns validation paths without echoed values for invalid rule content', async () => {
    const query = vi.fn();
    const app = createApp(btcPrincipal(), query);
    const body = {
      ...validRuleSetBody(),
      rules: { ...validRuleSetBody().rules, schemaVersion: 'WRONG_SCHEMA_MARKER', engineVersion: 'EVIL_VALUE_NEVER_ECHOED_123' },
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/round-rule-sets',
      payload: body,
    });
    expect(response.statusCode).toBe(400);
    const error = response.json().error;
    expect(error.code).toBe('RULE_SET_INVALID');
    expect(Array.isArray(error.details)).toBe(true);
    expect(error.details.length).toBeGreaterThan(0);
    for (const detail of error.details) {
      expect(Object.keys(detail).sort()).toEqual(['code', 'path']);
      expect(typeof detail.path).toBe('string');
      expect(typeof detail.code).toBe('string');
    }
    expect(response.body).not.toContain('EVIL_VALUE_NEVER_ECHOED_123');
    await app.close();
  });

  it('lists rounds with server-computed allowedActions', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        id: 'round-1',
        tournament_stage: 'QUALIFICATION',
        round_number: 1,
        status: 'DRAFT_RULES',
        rule_set_id: null,
        schedule_round_id: null,
        paused_at: null,
        created_at: new Date('2026-10-14T00:00:00.000Z'),
      }],
    });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/rounds?tournamentStage=QUALIFICATION' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0].allowedActions).toEqual(['open']);
    await app.close();
  });

  it('reports pause only when unpaused and resume only when paused', async () => {
    const runningRow = (pausedAt: Date | null) => ({
      id: '00000000-0000-4000-8000-000000000001',
      tournament_stage: 'QUALIFICATION',
      round_number: 1,
      status: 'RUNNING',
      rule_set_id: '00000000-0000-4000-8000-000000000002',
      schedule_round_id: null,
      paused_at: pausedAt,
      created_at: new Date('2026-10-14T00:00:00.000Z'),
    });
    const unpausedApp = createApp(btcPrincipal(), vi.fn().mockResolvedValue({ rows: [runningRow(null)] }));
    const unpaused = await unpausedApp.inject({ method: 'GET', url: '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001' });
    expect(unpaused.json().data.allowedActions).toEqual(['pause', 'reconcile']);
    await unpausedApp.close();

    const pausedApp = createApp(btcPrincipal(), vi.fn().mockResolvedValue({ rows: [runningRow(new Date('2026-10-14T15:00:00.000Z'))] }));
    const paused = await pausedApp.inject({ method: 'GET', url: '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001' });
    expect(paused.json().data.allowedActions).toEqual(['resume', 'reconcile']);
    await pausedApp.close();
  });

  it('includes allowedActions in transition responses', async () => {
    const pausedAt = new Date('2026-10-14T15:00:00.000Z');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) {
        return { rows: [mockRoundRow({ status: 'RUNNING', rule_set_id: '00000000-0000-4000-8000-000000000002' })] };
      }
      if (sql.includes('round_number')) {
        return {
          rows: [{
            id: '00000000-0000-4000-8000-000000000001',
            tournament_stage: 'QUALIFICATION',
            round_number: 1,
            status: 'RUNNING',
            rule_set_id: '00000000-0000-4000-8000-000000000002',
            schedule_round_id: null,
            paused_at: pausedAt,
            created_at: new Date('2026-10-14T00:00:00.000Z'),
          }],
        };
      }
      return { rows: [] };
    });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001/pause',
      payload: { reason: 'pause for maintenance' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.allowedActions).toEqual(['resume', 'reconcile']);
    await app.close();
  });

  it('returns 200 for valid pause transition', async () => {
    const pausedAt = new Date('2026-10-14T15:00:00.000Z');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) {
        return { rows: [mockRoundRow({ status: 'RUNNING', rule_set_id: '00000000-0000-4000-8000-000000000002' })] };
      }
      if (sql.includes('round_number')) {
        return {
          rows: [{
            id: '00000000-0000-4000-8000-000000000001',
            tournament_stage: 'QUALIFICATION',
            round_number: 1,
            status: 'RUNNING',
            rule_set_id: '00000000-0000-4000-8000-000000000002',
            schedule_round_id: null,
            paused_at: pausedAt,
            created_at: new Date('2026-10-14T00:00:00.000Z'),
          }],
        };
      }
      return { rows: [] };
    });
    const app = createApp(btcPrincipal(), query);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001/pause',
      payload: { reason: 'pause for maintenance' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('RUNNING');
    expect(response.json().data.pausedAt).not.toBeNull();
    await app.close();
  });
});