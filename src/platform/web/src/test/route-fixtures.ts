import { createHash } from 'node:crypto';
import { createGame, DEFAULT_MAP, getGameResult, hashGameState, skipTurn } from '@ott/game-core';
import { vi } from 'vitest';
import type { SpectatorReplayV1 } from '../features/spectator/replay-schema.ts';

export type TestRole = 'ANONYMOUS' | 'BTC_ADMIN' | 'TEAM_ACCOUNT';

const SHA = `sha256:${'ab'.repeat(32)}`;
export const ids = {
  team: '11111111-1111-4111-8111-111111111111',
  otherTeam: '22222222-2222-4222-8222-222222222222',
  match: '33333333-3333-4333-8333-333333333333',
  submission: '55555555-5555-4555-8555-555555555555',
};

const teams = [
  { id: ids.team, name: 'Alpha Team', representativeEmail: null },
  { id: ids.otherTeam, name: 'Beta Team', representativeEmail: null },
];

const matchResult = {
  matchId: ids.match, seriesId: 'series-1', stage: 'QUALIFICATION', gameNumber: 1, status: 'FINALIZED',
  teams: { x: { id: ids.team, name: 'Alpha Team' }, o: { id: ids.otherTeam, name: 'Beta Team' } },
  winnerTeamId: ids.team, winnerSide: 'X', reason: 'REACHED_GOAL', turnCount: 12, finalizedAt: '2026-10-18T17:30:00.000Z', faults: null,
};

const seriesResult = {
  seriesId: 'series-1', stage: 'QUALIFICATION', status: 'FINALIZED', format: 'BEST_OF_3',
  teams: { a: { id: ids.team, name: 'Alpha Team' }, b: { id: ids.otherTeam, name: 'Beta Team' } },
  score: { a: 2, b: 1 }, winnerTeamId: ids.team, cancellationReason: null, finalizedAt: '2026-10-18T17:30:00.000Z',
};

const leaderboardEntry = {
  rank: 1, tieBreakStatus: 'CLEAR', ratingStatus: 'RANKED', team: { id: ids.team, name: 'Alpha Team' }, rating: 1500, headToHeadPoints: 3,
  series: { wins: 2, draws: 1, losses: 0 }, winRate: 0.66, technicalFaultCount: 0, forfeitCount: 0, updatedAt: '2026-10-13T20:30:00.000Z',
};

const replayEntry = {
  matchId: ids.match, state: 'PRIVATE', eventLogSha256: SHA, seriesId: 'series-1', stage: 'FINALS', finalizedAt: '2026-10-13T08:00:00.000Z',
  teamX: { id: ids.team, name: 'Alpha Team' }, teamO: { id: ids.otherTeam, name: 'Beta Team' },
};

const submission = { id: ids.submission, status: 'VALID', archiveSha256: SHA, createdAt: '2026-10-18T00:00:00.000Z' };
const sampleTestRun = {
  id: ids.match, submissionId: ids.submission, opponentType: 'BTC_REFERENCE', opponentSubmissionId: null,
  opponentReferenceBot: 'FIRST_LEGAL', status: 'COMPLETED', quotaConsumed: true,
  result: { winnerSide: 'X', reason: 'REACHED_GOAL' }, stderrX: null, stderrO: null,
  failureReason: null, isInfraFailure: false, createdAt: '2026-10-18T10:00:00.000Z',
  startedAt: '2026-10-18T10:00:01.000Z', finishedAt: '2026-10-18T10:00:05.000Z',
};

function replayBody(): string {
  const t = skipTurn(createGame({ gameId: ids.match, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 }), 'X', 'NO_LEGAL_ACTION');
  if (!t.ok) throw new Error('replay fixture failed');
  const result = getGameResult(t.state);
  if (result === null) throw new Error('replay fixture must be terminal');
  const replay: SpectatorReplayV1 = {
    schema: 'ott.spectator-replay', schemaVersion: 1, matchId: ids.match,
    header: { format: 'ott.match-event-log', formatVersion: 1, matchId: ids.match, protocolVersion: 1, engineVersion: '1.0.0', game: { engineVersion: '1.0.0', maxTurns: 1, map: DEFAULT_MAP } },
    entries: [{ index: 1, input: { kind: 'skip', side: 'X', reason: 'NO_LEGAL_ACTION' }, events: t.events, revision: t.state.revision, stateHash: hashGameState(t.state) }],
    result,
    faults: { X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null }, O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null } },
  };
  return JSON.stringify(replay);
}

function replayResponse(): Response {
  const text = replayBody();
  return new Response(text, { headers: { 'content-type': 'application/vnd.ott.spectator-replay+json;version=1', 'x-replay-sha256': `sha256:${createHash('sha256').update(text).digest('hex')}` } });
}

function publicSnapshot() {
  const updatedAt = new Date().toISOString();
  return {
    schemaVersion: 1, updatedAt, stage: 'QUALIFICATION', round: { name: 'Week 1', status: 'RUNNING' },
    queue: [{ position: 1, teams: 'A vs B', etaSeconds: 30 }],
    results: [{ matchId: ids.match, teams: 'A vs B', score: '1–0', syncVerified: true, replayPublished: true }],
    leaderboard: [{ rank: 1, team: 'A', rating: 1500, eligible: true }],
    rules: { version: 'rules-1', engineVersion: '1.0.0', sections: [{ title: 'Map set', body: 'map-v1' }] },
    schedule: [{ title: 'Cutoff', body: '18:00' }], announcements: [{ title: 'Thông báo BTC', body: 'Đang thi đấu' }],
    faq: [{ title: 'Nộp bot ở đâu?', body: 'Cổng đội thi' }], status: { message: 'Worker recovery', incidentEta: null },
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (items: unknown[]) => ({ page: 1, pageSize: 25, total: items.length, totalItems: items.length, totalPages: 1 });

export interface RouteApi {
  /** `METHOD path` (query string included) of every request that no route handled. */
  readonly unhandled: string[];
  readonly requests: string[];
  setNoReferenceBot(value: boolean): void;
}

/** One shared fetch router covering every endpoint the routed pages call. Unknown requests are recorded and answered 404. */
export function installRouteFetch(role: TestRole): RouteApi {
  const unhandled: string[] = [];
  const requests: string[] = [];
  const testRuns: Record<string, unknown>[] = [];
  const snapshotBody = JSON.stringify(publicSnapshot());
  const snapshotSha = createHash('sha256').update(snapshotBody).digest('hex');
  const snapshotPointer = { schemaVersion: 1, file: `snapshot-${snapshotSha}.json`, sha256: snapshotSha, updatedAt: JSON.parse(snapshotBody).updatedAt };
  let uuidCounter = 0;
  let noReferenceBot = false;
  vi.stubGlobal('crypto', { randomUUID: () => `44444444-4444-4444-8444-${String(++uuidCounter).padStart(12, '0')}`, subtle: { digest: async (_algorithm: string, bytes: ArrayBuffer) => Uint8Array.from(createHash('sha256').update(new Uint8Array(bytes)).digest()).buffer } });

  function route(method: string, path: string, init?: RequestInit): Response | null {
    const [pathname = ''] = path.split('?');
    if (method === 'GET') {
      if (pathname === '/api/v1/auth/session') {
        if (role === 'ANONYMOUS') return json(401, { error: { code: 'UNAUTHENTICATED' } });
        return json(200, { data: role === 'BTC_ADMIN' ? { role } : { role, teamId: ids.team } });
      }
      if (pathname === '/api/v1/admin/teams') return json(200, { data: teams });
      if (pathname === '/api/v1/admin/round-rule-sets') return json(200, { data: { items: [] } });
      if (pathname === '/api/v1/admin/rounds') return json(200, { data: { items: [] } });
      if (pathname === '/api/v1/admin/rounds/catalog') return json(200, { data: { engineVersions: ['1.0.0'], maps: [], faultPolicyVersions: ['P2_BASELINE_V1'] } });
      if (pathname === '/api/v1/results/matches') return json(200, { data: { items: [matchResult], pagination: page([matchResult]) } });
      if (pathname === '/api/v1/results/series') return json(200, { data: { items: [seriesResult], pagination: page([seriesResult]) } });
      if (pathname === '/api/v1/admin/operations/audit') return json(200, { data: { items: [] }, pagination: page([]) });
      if (pathname === '/api/v1/admin/submissions/flagged') return json(200, { data: { items: [] }, pagination: page([]) });
      if (pathname === '/api/v1/admin/result-bundles/keys') return json(200, { data: [] });
      if (pathname === '/api/v1/public/queue-overrides') return json(200, { data: { items: [] } });
      if (pathname === '/api/v1/submissions') return json(200, { data: noReferenceBot ? [submission, { ...submission, id: '77777777-7777-4777-8777-777777777777' }] : [submission], pagination: { page: 1, pageSize: 20, totalItems: noReferenceBot ? 2 : 1, totalPages: 1 }, preflightQueueLength: 0 });
      if (pathname === '/api/v1/test-run-policy') {
        return json(200, { data: {
        roundId: 'round-current', quota: { limit: 2, consumed: 0, reserved: 0, remaining: 2, resetsAt: '2026-10-19T00:00:00.000Z' },
        admissionPaused: false, opponents: { referenceBots: noReferenceBot ? [] : [{ id: 'FIRST_LEGAL', displayName: 'Bot tham chiếu — đi hợp lệ đầu tiên' }], ownSubmissionAllowed: true },
        maps: [{ mapId: 'default', version: 1, checksum: 'a'.repeat(64), name: 'Bản đồ tiêu chuẩn' }],
      } });
      }
      if (pathname === '/api/v1/test-runs') return json(200, { data: testRuns, pagination: { page: 1, pageSize: 20, totalItems: testRuns.length, totalPages: testRuns.length === 0 ? 0 : 1 } });
      const testRunReplayMatch = pathname.match(/^\/api\/v1\/test-runs\/([^/]+)\/replay$/);
      if (testRunReplayMatch) return replayResponse();
      const testRunMatch = pathname.match(/^\/api\/v1\/test-runs\/([^/]+)$/);
      if (testRunMatch) return json(200, { data: testRuns.find((run) => run.id === testRunMatch[1]) ?? sampleTestRun });
      if (pathname === '/api/v1/admin/replays/catalog') return json(200, { data: { items: [replayEntry], pagination: page([replayEntry]) } });
      if (pathname === '/api/v1/leaderboard') return json(200, { data: { items: [leaderboardEntry], pagination: page([leaderboardEntry]) } });
      if (pathname === `/api/v1/replays/${ids.match}` || pathname === `/api/v1/public/replays/${ids.match}`) return replayResponse();
      if (pathname === '/snapshots/latest.json') return json(200, snapshotPointer);
      if (pathname === `/snapshots/${snapshotPointer.file}`) return new Response(snapshotBody);
    }
    if (method === 'POST' && pathname === '/api/v1/test-runs') {
      const input = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
      const created = { ...sampleTestRun, ...input, id: `66666666-6666-4666-8666-${String(testRuns.length + 1).padStart(12, '0')}`, status: 'QUEUED', result: null, quotaConsumed: false, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null };
      testRuns.unshift(created);
      return json(201, { data: created });
    }
    if (method === 'POST' && pathname === '/api/v1/auth/password/change') return json(204, {});
    if (method === 'POST' && pathname === '/api/v1/auth/logout') return json(204, {});
    return null;
  }

  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const path = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push(`${method} ${path}`);
    const handled = route(method, path, init);
    if (handled !== null) return handled;
    unhandled.push(`${method} ${path}`);
    return json(404, { error: { code: 'UNMOCKED' } });
  }));
  return { unhandled, requests, setNoReferenceBot(value: boolean) { noReferenceBot = value; } };
}
