import { vi } from 'vitest';
import type { RoundSummary } from './api.ts';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

export const id1 = '00000000-0000-4000-8000-0000000000a1';
export const id2 = '00000000-0000-4000-8000-0000000000a2';

function rules(engineVersion: string) {
  return {
    schemaVersion: 'ott.round-rules.v1', engineVersion,
    mapSet: [{ mapId: `map-${engineVersion}`, checksum: 'a'.repeat(64) }],
    maxTurns: 200, faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000, perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 } },
    resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
    schedule: { submissionOpensAt: '2026-10-14T07:00:00.000Z', submissionDeadlineAt: '2026-10-17T16:59:00.000Z', graceEndsAt: '2026-10-18T05:00:00.000Z', runStartsAt: '2026-10-18T07:00:00.000Z', runMaxHours: 48, appealEndsAt: '2026-10-21T05:00:00.000Z' },
    testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE'] },
  };
}

export function ruleSet(id: string, version: number, engineVersion: string) {
  return { id, version, rulesSha256: String(version).repeat(64), reason: `v${version} reason`, createdAt: '2026-10-14T00:00:00.000Z', tournamentStage: 'QUALIFICATION', rules: rules(engineVersion) };
}

export function round(overrides: Partial<RoundSummary> & { roundNumber: number }): RoundSummary {
  return {
    id: `00000000-0000-4000-8000-00000000010${overrides.roundNumber}`, tournamentStage: 'QUALIFICATION',
    status: 'DRAFT_RULES', ruleSetId: null, scheduleRoundId: null, pausedAt: null,
    createdAt: '2026-10-14T00:00:00.000Z', allowedActions: [], ...overrides,
  };
}

export function installPageMock(state: { rounds: RoundSummary[]; ruleSets: ReturnType<typeof ruleSet>[]; detailFails?: Set<string> }) {
  const detailCalls: string[] = [];
  const fetchMock = vi.fn(async (url: unknown): Promise<Response> => {
    const path = String(url);
    if (path.startsWith('/api/v1/admin/round-rule-sets?')) return response(200, { data: { items: state.ruleSets.map(({ rules: _rules, ...summary }) => summary) } });
    const detail = /^\/api\/v1\/admin\/round-rule-sets\/([^/]+)$/.exec(path);
    if (detail) {
      detailCalls.push(detail[1] as string);
      const found = state.ruleSets.find((entry) => entry.id === detail[1]);
      if (state.detailFails?.has(detail[1] as string)) return response(500, { error: { code: 'X' } });
      return found ? response(200, { data: found }) : response(404, { error: { code: 'NOPE' } });
    }
    if (path.startsWith('/api/v1/admin/rounds?')) return response(200, { data: { items: state.rounds } });
    if (path === '/api/v1/admin/teams') return response(200, { data: [] });
    throw new Error(`unmocked request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { detailCalls };
}


