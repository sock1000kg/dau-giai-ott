import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP, ENGINE_VERSION } from '@ott/game-core';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { AuthorizationError } from '../src/modules/auth/authorize.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';
import {
  catalogView,
  findMap,
  isKnownEngine,
  isKnownFaultPolicy,
  MAP_REGISTRY,
  resolveMatchRules,
  validateAgainstCatalog,
} from '../src/modules/rounds/catalog.ts';
import { registerRoundRoutes } from '../src/modules/rounds/routes.ts';
import { createRuleSet, RuleSetInvalidError } from '../src/modules/rounds/service.ts';
import { validateRoundRuleSetRules, type RoundRuleSetRulesV1 } from '../src/modules/rounds/types.ts';

function validRules(overrides: Partial<RoundRuleSetRulesV1> = {}): RoundRuleSetRulesV1 {
  return {
    schemaVersion: 'ott.round-rules.v1',
    engineVersion: ENGINE_VERSION,
    mapSet: [{ mapId: DEFAULT_MAP.mapId, checksum: DEFAULT_MAP.checksum }],
    maxTurns: 150,
    faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: {
      startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000,
      perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 },
    },
    resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
    schedule: {
      submissionOpensAt: '2026-10-14T00:00:00.000Z', submissionDeadlineAt: '2026-10-15T00:00:00.000Z',
      graceEndsAt: '2026-10-15T00:05:00.000Z', runStartsAt: '2026-10-15T01:00:00.000Z',
      runMaxHours: 4, appealEndsAt: '2026-10-16T00:00:00.000Z',
    },
    testRun: { quotaPerTeamPerDay: 5, opponents: ['BTC_REFERENCE'] },
    ...overrides,
  };
}

function withPerTurn(perTurn: RoundRuleSetRulesV1['timeControl']['perTurn']): RoundRuleSetRulesV1 {
  const rules = validRules();
  return { ...rules, timeControl: { ...rules.timeControl, perTurn } };
}

describe('P3-D25 registry', () => {
  it('registers the engine, the default map and the baseline fault policy', () => {
    expect(isKnownEngine(ENGINE_VERSION)).toBe(true);
    expect(isKnownEngine('9.9.9')).toBe(false);
    expect(isKnownFaultPolicy('P2_BASELINE_V1')).toBe(true);
    expect(isKnownFaultPolicy('1.0.0')).toBe(false);
    expect(MAP_REGISTRY).toHaveLength(1);
    expect(findMap(DEFAULT_MAP.mapId, DEFAULT_MAP.checksum)?.definition).toBe(DEFAULT_MAP);
    expect(findMap(DEFAULT_MAP.mapId, 'b'.repeat(64))).toBeUndefined();
    expect(findMap('other', DEFAULT_MAP.checksum)).toBeUndefined();
  });

  it('resolves a catalogued rule set to match rules and rejects an unresolvable one', () => {
    expect(resolveMatchRules(validRules())).toEqual({
      engineVersion: ENGINE_VERSION, maxTurns: 150, turnTimeoutMs: 3000, maps: [MAP_REGISTRY[0]],
    });
    expect(resolveMatchRules(validRules({ mapSet: [{ mapId: 'nope', checksum: 'a'.repeat(64) }] }))).toBeNull();
    expect(resolveMatchRules(validRules({ engineVersion: '9.9.9' }))).toBeNull();
  });

  it('uses the maximum per-turn limit as the interim turn timeout', () => {
    expect(resolveMatchRules(withPerTurn({ mode: 'FIXED', fixedMs: 1200 }))?.turnTimeoutMs).toBe(1200);
    expect(resolveMatchRules(withPerTurn({ mode: 'DYNAMIC', baseMs: 500, stepMs: 100, everyTurns: 10, maxMs: 2500 }))?.turnTimeoutMs).toBe(2500);
  });
});

describe('P3-D25 validateAgainstCatalog', () => {
  it('accepts a catalogued rule set that passes the structural validator', () => {
    expect(validateRoundRuleSetRules(validRules()).errors).toEqual([]);
    expect(validateAgainstCatalog(validRules())).toEqual([]);
  });

  it('reports each unknown catalog value with its path and code', () => {
    expect(validateAgainstCatalog(validRules({ engineVersion: '2.0.0' }))).toEqual([{ path: 'engineVersion', code: 'UNKNOWN_ENGINE_VERSION' }]);
    expect(validateAgainstCatalog(validRules({ faultPolicyVersion: 'OTHER' }))).toEqual([{ path: 'faultPolicyVersion', code: 'UNKNOWN_FAULT_POLICY' }]);
    expect(validateAgainstCatalog(validRules({ mapSet: [{ mapId: DEFAULT_MAP.mapId, checksum: DEFAULT_MAP.checksum }, { mapId: 'ghost', checksum: 'a'.repeat(64) }] })))
      .toEqual([{ path: 'mapSet[1].mapId', code: 'UNKNOWN_MAP' }]);
    expect(validateAgainstCatalog(validRules({ mapSet: [{ mapId: DEFAULT_MAP.mapId, checksum: 'b'.repeat(64) }] })))
      .toEqual([{ path: 'mapSet[0].checksum', code: 'UNKNOWN_MAP' }]);
  });

  it('enforces the runner maxTurns limit at the boundary', () => {
    expect(validateAgainstCatalog(validRules({ maxTurns: DEFAULT_LIMITS.maxTurns }))).toEqual([]);
    expect(validateAgainstCatalog(validRules({ maxTurns: DEFAULT_LIMITS.maxTurns + 1 })))
      .toEqual([{ path: 'maxTurns', code: 'MAX_TURNS_EXCEEDS_RUNNER_LIMIT' }]);
  });

  it('enforces the runner turn timeout for FIXED and DYNAMIC at the boundary', () => {
    const limit = DEFAULT_LIMITS.turnTimeoutMs;
    expect(validateAgainstCatalog(withPerTurn({ mode: 'FIXED', fixedMs: limit }))).toEqual([]);
    expect(validateAgainstCatalog(withPerTurn({ mode: 'FIXED', fixedMs: limit + 1 })))
      .toEqual([{ path: 'timeControl.perTurn.fixedMs', code: 'TURN_LIMIT_EXCEEDS_RUNNER_LIMIT' }]);
    const dynamic = (maxMs: number) => withPerTurn({ mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs });
    expect(validateAgainstCatalog(dynamic(limit))).toEqual([]);
    expect(validateAgainstCatalog(dynamic(limit + 1)))
      .toEqual([{ path: 'timeControl.perTurn.maxMs', code: 'TURN_LIMIT_EXCEEDS_RUNNER_LIMIT' }]);
  });

  it('createRuleSet rejects catalog violations before touching the database', async () => {
    const database = { transaction: vi.fn(), query: vi.fn() } as unknown as Database;
    const call = createRuleSet(database, {
      tournamentStage: 'QUALIFICATION', rules: validRules({ mapSet: [{ mapId: 'ghost', checksum: 'a'.repeat(64) }] }),
      reason: 'unknown map', actorAccountId: 'acc-1',
    });
    await expect(call).rejects.toBeInstanceOf(RuleSetInvalidError);
    await expect(call).rejects.toMatchObject({ details: [{ path: 'mapSet[0].mapId', code: 'UNKNOWN_MAP' }] });
    expect(database.transaction).not.toHaveBeenCalled();
  });
});

function createApp(principal: SessionPrincipal | null, query = vi.fn()) {
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal; });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthorizationError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
  const database = { query, transaction: vi.fn(), close: vi.fn() } as unknown as Database;
  registerRoundRoutes(app, { database });
  return { app, query };
}

describe('P3-D25 catalog route', () => {
  it('maps a catalog violation on rule-set creation to 400 RULE_SET_INVALID with details', async () => {
    const { app } = createApp({ accountId: 'btc', role: 'BTC_ADMIN', teamId: undefined });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/admin/round-rule-sets',
      payload: { tournamentStage: 'QUALIFICATION', reason: 'unknown map', rules: validRules({ mapSet: [{ mapId: 'ghost', checksum: 'a'.repeat(64) }] }) },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: 'RULE_SET_INVALID', details: [{ path: 'mapSet[0].mapId', code: 'UNKNOWN_MAP' }] });
    await app.close();
  });

  it('is 401 anonymous and 403 for a team account', async () => {
    const anonymous = createApp(null);
    expect((await anonymous.app.inject({ method: 'GET', url: '/api/v1/admin/rounds/catalog' })).statusCode).toBe(401);
    const team = createApp({ accountId: 'team-account', role: 'TEAM_ACCOUNT', teamId: 'team-1' });
    expect((await team.app.inject({ method: 'GET', url: '/api/v1/admin/rounds/catalog' })).statusCode).toBe(403);
    await anonymous.app.close();
    await team.app.close();
  });

  it('returns the catalog for BTC_ADMIN without map definitions or spawns, and is not parsed as a round id', async () => {
    const { app, query } = createApp({ accountId: 'btc', role: 'BTC_ADMIN', teamId: undefined });
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/rounds/catalog' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        engineVersions: [ENGINE_VERSION],
        maps: [{ mapId: 'default', version: 1, checksum: DEFAULT_MAP.checksum, width: 9, height: 9 }],
        faultPolicyVersions: ['P2_BASELINE_V1'],
      },
    });
    expect(response.body).not.toContain('spawns');
    expect(response.body).not.toContain('definition');
    expect(query).not.toHaveBeenCalled();
    expect(catalogView().maps[0]).not.toHaveProperty('definition');
    await app.close();
  });

  it('still routes a UUID to /rounds/:roundId', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const { app } = createApp({ accountId: 'btc', role: 'BTC_ADMIN', teamId: undefined }, query);
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('ROUND_NOT_FOUND');
    expect(query).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
