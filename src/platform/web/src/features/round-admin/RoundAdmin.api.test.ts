import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRound,
  createRuleSet,
  getRound,
  getRuleSetDetail,
  listRounds,
  listRuleSets,
  listTeamsCount,
  RoundAdminApiError,
  transitionRound,
} from './api.ts';
import type { RoundRuleSetRulesV1 } from './rules-form.ts';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function roundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'round-1',
    tournamentStage: 'QUALIFICATION',
    roundNumber: 1,
    status: 'DRAFT_RULES',
    ruleSetId: null,
    scheduleRoundId: null,
    pausedAt: null,
    createdAt: '2026-10-14T00:00:00.000Z',
    allowedActions: ['open'],
    ...overrides,
  };
}

function rulesPayload(): RoundRuleSetRulesV1 {
  return {
    schemaVersion: 'ott.round-rules.v1',
    engineVersion: '1.0.0',
    mapSet: [{ mapId: 'map-v1', checksum: 'a'.repeat(64) }],
    maxTurns: 200,
    faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000, perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 } },
    resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
    schedule: {
      submissionOpensAt: '2026-10-14T07:00:00.000Z',
      submissionDeadlineAt: '2026-10-17T16:59:00.000Z',
      graceEndsAt: '2026-10-18T05:00:00.000Z',
      runStartsAt: '2026-10-18T07:00:00.000Z',
      runMaxHours: 48,
      appealEndsAt: '2026-10-21T05:00:00.000Z',
    },
    testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE'] },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RoundAdmin api client', () => {
  it('requests rule-set and round lists with the stage query and parses summaries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { data: { items: [{ id: 'rs-1', version: 1, rulesSha256: 's', reason: 'r', createdAt: '2026-10-14T00:00:00.000Z' }] } }))
      .mockResolvedValueOnce(response(200, { data: { items: [roundRow()] } }));
    vi.stubGlobal('fetch', fetchMock);
    const sets = await listRuleSets('QUALIFICATION');
    const rounds = await listRounds('QUALIFICATION');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/round-rule-sets?tournamentStage=QUALIFICATION');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/admin/rounds?tournamentStage=QUALIFICATION');
    expect(sets).toHaveLength(1);
    expect(rounds[0]?.allowedActions).toEqual(['open']);
  });

  it('fetches a rule-set detail with stored rules and posts new versions as JSON', async () => {
    const rules = rulesPayload();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { data: { id: 'rs-1', version: 2, rulesSha256: 's', reason: 'r', createdAt: '2026-10-14T00:00:00.000Z', tournamentStage: 'QUALIFICATION', rules } }))
      .mockResolvedValueOnce(response(201, { data: { id: 'rs-2', version: 3, rulesSha256: 't' } }));
    vi.stubGlobal('fetch', fetchMock);
    const detail = await getRuleSetDetail('rs-1');
    expect(detail.rules).toEqual(rules);
    expect(detail.tournamentStage).toBe('QUALIFICATION');
    const created = await createRuleSet('QUALIFICATION', rules, 'second version');
    expect(created.version).toBe(3);
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(new Headers(init?.headers).get('content-type')).toContain('application/json');
    expect(JSON.parse(String(init?.body))).toMatchObject({ tournamentStage: 'QUALIFICATION', reason: 'second version' });
  });

  it('sends the Idempotency-Key header only for start transitions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { data: roundRow({ status: 'RUNNING', allowedActions: ['pause', 'reconcile'] }) }))
      .mockResolvedValueOnce(response(200, { data: roundRow({ status: 'RUNNING', pausedAt: '2026-10-14T15:00:00.000Z', allowedActions: ['resume', 'reconcile'] }) }));
    vi.stubGlobal('fetch', fetchMock);
    await transitionRound('round-1', 'start', { reason: 'go', ruleSetId: 'rs-1', idempotencyKey: 'key-123' });
    await transitionRound('round-1', 'pause', { reason: 'hold' });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('idempotency-key')).toBe('key-123');
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('idempotency-key')).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/rounds/round-1/start');
  });

  it('requires an idempotency key before starting', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(transitionRound('round-1', 'start', { reason: 'go', ruleSetId: 'rs-1' })).rejects.toThrow(/idempotency/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carries server validation details on the typed error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(400, {
      error: { code: 'RULE_SET_INVALID', message: 'Invalid rule set', details: [{ path: 'engineVersion', code: 'TYPE_MISMATCH' }] },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const failure = await createRuleSet('QUALIFICATION', rulesPayload(), 'bad').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RoundAdminApiError);
    expect((failure as RoundAdminApiError).status).toBe(400);
    expect((failure as RoundAdminApiError).code).toBe('RULE_SET_INVALID');
    expect((failure as RoundAdminApiError).details).toEqual([{ path: 'engineVersion', code: 'TYPE_MISMATCH' }]);
  });

  it('rejects malformed round payloads instead of returning partial state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { data: { ...roundRow(), allowedActions: ['fly'] } }))
      .mockResolvedValueOnce(response(200, { data: { ...roundRow(), allowedActions: 'open' } }))
      .mockResolvedValueOnce(response(200, { data: { items: 'nope' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRound('round-1')).rejects.toThrow(/invalid round response/i);
    await expect(getRound('round-1')).rejects.toThrow(/invalid round response/i);
    await expect(listRounds('QUALIFICATION')).rejects.toThrow(/invalid round list response/i);
  });

  it('creates rounds and counts teams for the estimate default', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(201, { data: roundRow() }))
      .mockResolvedValueOnce(response(200, { data: [{ id: 'team-1' }, { id: 'team-2' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const created = await createRound('QUALIFICATION', 'open round one');
    expect(created.roundNumber).toBe(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ tournamentStage: 'QUALIFICATION', reason: 'open round one' });
    await expect(listTeamsCount()).resolves.toBe(2);
  });
});
