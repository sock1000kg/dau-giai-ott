import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { calculateEloDelta, CURRENT_RATING_POLICY, kFactorFor, LEGACY_RATING_POLICY, RATING_POLICIES, seriesDeltas } from '../src/modules/ratings/elo.ts';
import { registerLeaderboardRoutes } from '../src/modules/ratings/routes.ts';
import { applyRoundRatings, countPriorRatedSeries, rebuildRatingLedger } from '../src/modules/ratings/service.ts';
import {
  DEFAULT_MINIMUM_FINALS_SERIES,
  finalsEligibility,
  isQualificationGateEnforced,
  isSubmissionRankable,
  ratedSeriesCount,
  ratingStatusFor,
} from '../src/modules/scheduling/eligibility.ts';

// Captured from the pre-P3-L03 calculateEloDelta (K=32): [ratingA, ratingB, scoreA, deltaA, deltaB].
const legacyGolden: readonly (readonly [number, number, 0 | 0.5 | 1, number, number])[] = [
  [1000, 1000, 0, -16, 16], [1000, 1000, 0.5, 0, 0], [1000, 1000, 1, 16, -16],
  [1400, 1000, 0, -29, 29], [1400, 1000, 0.5, -13, 13], [1400, 1000, 1, 3, -3],
  [1000, 1400, 0, -3, 3], [1000, 1400, 0.5, 13, -13], [1000, 1400, 1, 29, -29],
  [1234, 1111, 0, -21, 21], [1234, 1111, 0.5, -5, 5], [1234, 1111, 1, 11, -11],
  [900, 1517, 0, -1, 1], [900, 1517, 0.5, 15, -15], [900, 1517, 1, 31, -31],
  [1650, 1650, 0, -16, 16], [1650, 1650, 0.5, 0, 0], [1650, 1650, 1, 16, -16],
  [1001, 1000, 0, -16, 16], [1001, 1000, 0.5, 0, 0], [1001, 1000, 1, 16, -16],
  [1099, 1000, 0, -20, 20], [1099, 1000, 0.5, -4, 4], [1099, 1000, 1, 12, -12],
];

describe('rating policy K factor', () => {
  it('pins the policy table', () => {
    expect(RATING_POLICIES['elo-k32-v1']).toEqual({ initialK: 32, settledK: 32, provisionalSeries: 0 });
    expect(RATING_POLICIES['elo-adaptive-k-v1']).toEqual({ initialK: 64, settledK: 32, provisionalSeries: 5 });
    expect(LEGACY_RATING_POLICY).toBe('elo-k32-v1');
    expect(CURRENT_RATING_POLICY).toBe('elo-adaptive-k-v1');
  });

  it('uses K=64 for the first five rated series and K=32 from the sixth (boundary)', () => {
    expect([0, 1, 2, 3, 4].map((prior) => kFactorFor('elo-adaptive-k-v1', prior))).toEqual([64, 64, 64, 64, 64]);
    expect(kFactorFor('elo-adaptive-k-v1', 5)).toBe(32); // 5 prior => this is the 6th series
    expect(kFactorFor('elo-adaptive-k-v1', 40)).toBe(32);
  });

  it('keeps K=32 for the legacy policy whatever the history', () => {
    for (const prior of [0, 1, 4, 5, 100]) expect(kFactorFor('elo-k32-v1', prior)).toBe(32);
  });

  it('rejects unknown policies and non-integer prior counts', () => {
    expect(() => kFactorFor('elo-k99-v9', 0)).toThrow('RATING_POLICY_UNKNOWN');
    expect(() => kFactorFor('toString', 0)).toThrow('RATING_POLICY_UNKNOWN');
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => kFactorFor('elo-adaptive-k-v1', bad)).toThrow('PRIOR_SERIES_INVALID');
  });

  it('keeps calculateEloDelta defaults and applies the supplied K', () => {
    expect(calculateEloDelta(1000, 1000, 1)).toBe(16);
    expect(calculateEloDelta(1000, 1000, 1, 64)).toBe(32);
  });
});

describe('legacy backward compatibility', () => {
  it.each(legacyGolden)('elo-k32-v1 reproduces the legacy delta for %i vs %i score %f', (ratingA, ratingB, score, deltaA, deltaB) => {
    for (const [priorA, priorB] of [[0, 0], [3, 9], [20, 0]] as const) {
      const result = seriesDeltas('elo-k32-v1', ratingA, ratingB, score, priorA, priorB);
      expect(result.deltaA + 0).toBe(deltaA);
      expect(result.deltaB + 0).toBe(deltaB);
    }
  });

  it('adaptive policy with equal K matches the legacy zero-sum rounding', () => {
    for (const [ratingA, ratingB, score, deltaA, deltaB] of legacyGolden) {
      const settled = seriesDeltas('elo-adaptive-k-v1', ratingA, ratingB, score, 7, 8);
      expect(settled.deltaA + 0).toBe(deltaA);
      expect(settled.deltaB + 0).toBe(deltaB);
    }
  });

  it('uses each team\'s own K when the K values differ (rating is not conserved)', () => {
    const result = seriesDeltas('elo-adaptive-k-v1', 1000, 1000, 1, 0, 5);
    expect(result).toEqual({ deltaA: 32, deltaB: -16 });
  });
});

describe('countPriorRatedSeries', () => {
  it('counts both teams of every prior series', () => {
    const counts = countPriorRatedSeries([{ teamAId: 'a', teamBId: 'b' }, { teamAId: 'a', teamBId: 'c' }]);
    expect([...counts]).toEqual([['a', 2], ['b', 1], ['c', 1]]);
    expect(countPriorRatedSeries([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------- in-memory database for service-level properties
interface FakeSeries { id: string; status: 'FINALIZED' | 'CANCELLED'; a: string; b: string; scoreA: number | null; scoreB: number | null }
interface FakeRound {
  id: string; stage: string; policy: string; snapshot: { teamId: string; rating: number }[];
  finalizedAt: number; createdAt: number; applied: boolean; series: FakeSeries[];
}
interface LedgerEntry { team_id: string; series_id: string; rating_before: number; rating_after: number; delta: number }

function fakeDatabase(rounds: FakeRound[], ledger: LedgerEntry[], orderBy: 'finalized' | 'created' = 'finalized'): Database {
  const ordered = () => [...rounds].sort((x, y) => {
    const kx = orderBy === 'finalized' ? x.finalizedAt : x.createdAt;
    const ky = orderBy === 'finalized' ? y.finalizedAt : y.createdAt;
    return kx - ky || x.id.localeCompare(y.id);
  });
  const query = async (text: string, values: readonly unknown[] = []): Promise<{ rows: unknown[]; rowCount: number }> => {
    const sql = text.replace(/\s+/g, ' ').trim();
    const round = rounds.find(({ id }) => id === values[0]);
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT id, tournament_stage, status, rating_snapshot')) {
      return round === undefined ? { rows: [], rowCount: 0 } : {
        rows: [{ id: round.id, tournament_stage: round.stage, status: 'FINALIZED', rating_snapshot: round.snapshot,
          rating_applied_at: round.applied ? new Date() : null, rating_policy_version: round.policy }], rowCount: 1,
      };
    }
    if (sql.startsWith('SELECT id, status, team_a_id')) {
      const rows = [...round!.series].sort((x, y) => x.id.localeCompare(y.id)).map((s) => ({
        id: s.id, status: s.status, team_a_id: s.a, team_b_id: s.b,
        team_a_score: s.scoreA === null ? null : String(s.scoreA), team_b_score: s.scoreB === null ? null : String(s.scoreB),
      }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT s.team_a_id, s.team_b_id FROM series s')) {
      const order = ordered();
      const index = order.findIndex(({ id }) => id === values[0]);
      const rows = order.slice(0, index).filter(({ stage }) => stage === round!.stage)
        .flatMap(({ series }) => series.filter(({ status }) => status === 'FINALIZED'))
        .map((s) => ({ team_a_id: s.a, team_b_id: s.b }));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('SELECT team_id, series_id, rating_before')) {
      const ids = values[0] as string[];
      const rows = ledger.filter(({ series_id }) => ids.includes(series_id));
      return { rows, rowCount: rows.length };
    }
    if (sql.startsWith('INSERT INTO rating_ledger')) {
      const [team_id, series_id, rating_before, rating_after, delta] = values as [string, string, number, number, number];
      if (ledger.some((entry) => entry.team_id === team_id && entry.series_id === series_id)) return { rows: [], rowCount: 0 };
      ledger.push({ team_id, series_id, rating_before, rating_after, delta });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE rounds SET rating_applied_at')) { round!.applied = true; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('SELECT id FROM rounds WHERE tournament_stage')) {
      const rows = ordered().filter(({ stage }) => stage === values[0]).map(({ id }) => ({ id }));
      return { rows, rowCount: rows.length };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const database: Database = {
    query,
    transaction: async <T,>(work: (tx: Database) => Promise<T>) => work(database),
    close: async () => undefined,
  } as unknown as Database;
  return database;
}

function prng(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
}

async function applyAll(seed: number, policyFor: (index: number) => string): Promise<{ rounds: FakeRound[]; ledger: LedgerEntry[] }> {
  const random = prng(seed);
  const teams = Array.from({ length: 6 }, (_, i) => `team-${i}`);
  const ratings = new Map(teams.map((id) => [id, 1000]));
  const ledger: LedgerEntry[] = [];
  const rounds: FakeRound[] = [];
  const incremental = fakeDatabase(rounds, ledger);
  for (let index = 0; index < 9; index += 1) {
    const shuffled = [...teams].sort(() => random() - 0.5);
    const series: FakeSeries[] = [];
    for (let pair = 0; pair < 3; pair += 1) {
      const a = shuffled[pair * 2]!; const b = shuffled[pair * 2 + 1]!;
      if (random() < 0.15) { series.push({ id: `s-${index}-${pair}`, status: 'CANCELLED', a, b, scoreA: null, scoreB: null }); continue; }
      const outcome = Math.floor(random() * 3);
      const [scoreA, scoreB] = outcome === 0 ? [2, 0] : outcome === 1 ? [1, 1] : [0, 2];
      series.push({ id: `s-${index}-${pair}`, status: 'FINALIZED', a, b, scoreA, scoreB });
    }
    const round: FakeRound = {
      id: `round-${String(index).padStart(2, '0')}`, stage: 'QUALIFICATION', policy: policyFor(index),
      snapshot: teams.map((teamId) => ({ teamId, rating: ratings.get(teamId)! })),
      // created order is the reverse of finalized order: only (finalized_at, id) is a valid history order
      finalizedAt: 1000 + index, createdAt: 5000 - index, applied: false, series,
    };
    rounds.push(round);
    await applyRoundRatings(incremental, round.id);
    for (const entry of ledger) ratings.set(entry.team_id, entry.rating_after);
  }
  return { rounds, ledger };
}

const canonical = (entries: readonly LedgerEntry[]) => JSON.stringify(
  [...entries].sort((x, y) => x.series_id.localeCompare(y.series_id) || x.team_id.localeCompare(y.team_id)),
);

describe('adaptive K service properties (in-memory database)', () => {
  it.each([1, 7, 42, 99, 2026])('rebuild from scratch equals incremental application (seed %i)', async (seed) => {
    const { rounds, ledger } = await applyAll(seed, () => 'elo-adaptive-k-v1');
    expect(ledger.length).toBeGreaterThan(20);
    const rebuiltLedger: LedgerEntry[] = [];
    const rebuilt = rounds.map((round) => ({ ...round, applied: false }));
    const result = await rebuildRatingLedger(fakeDatabase(rebuilt, rebuiltLedger), 'QUALIFICATION');
    expect(result.inserted).toBe(ledger.length);
    expect(canonical(rebuiltLedger)).toBe(canonical(ledger));
    // rebuilding over an already complete ledger finds no mismatch and inserts nothing
    expect((await rebuildRatingLedger(fakeDatabase(rounds, ledger), 'QUALIFICATION')).inserted).toBe(0);
  });

  it('a rebuild that orders rounds by creation time disagrees with the incremental ledger', async () => {
    const { rounds, ledger } = await applyAll(42, () => 'elo-adaptive-k-v1');
    const wrongOrder = rounds.map((round) => ({ ...round, applied: false }));
    const second: LedgerEntry[] = [];
    await rebuildRatingLedger(fakeDatabase(wrongOrder, second, 'created'), 'QUALIFICATION');
    expect(canonical(second)).not.toBe(canonical(ledger));
  });

  it('legacy rounds keep K=32 for every series while later rounds switch to adaptive K', async () => {
    const { rounds, ledger } = await applyAll(7, (index) => (index < 5 ? 'elo-k32-v1' : 'elo-adaptive-k-v1'));
    const legacyIds = new Set(rounds.filter(({ policy }) => policy === 'elo-k32-v1').flatMap(({ series }) => series.map(({ id }) => id)));
    const legacyEntries = ledger.filter(({ series_id }) => legacyIds.has(series_id));
    expect(legacyEntries.length).toBeGreaterThan(0);
    for (const entry of legacyEntries) expect(Math.abs(entry.delta)).toBeLessThanOrEqual(32);
    const firstAdaptive = rounds.find(({ policy }) => policy === 'elo-adaptive-k-v1')!;
    const priorCounts = countPriorRatedSeries(rounds.filter(({ finalizedAt }) => finalizedAt < firstAdaptive.finalizedAt)
      .flatMap(({ series }) => series.filter(({ status }) => status === 'FINALIZED').map(({ a, b }) => ({ teamAId: a, teamBId: b }))));
    const first = firstAdaptive.series.find(({ status }) => status === 'FINALIZED')!;
    const entry = ledger.find(({ series_id, team_id }) => series_id === first.id && team_id === first.a)!;
    const ratingB = firstAdaptive.snapshot.find(({ teamId }) => teamId === first.b)!.rating;
    const expected = seriesDeltas('elo-adaptive-k-v1', entry.rating_before, ratingB, first.scoreA! > first.scoreB! ? 1 : first.scoreA! < first.scoreB! ? 0 : 0.5,
      priorCounts.get(first.a) ?? 0, priorCounts.get(first.b) ?? 0);
    expect(entry.delta).toBe(expected.deltaA);
    // legacy rows also rebuild unchanged
    const rebuilt: LedgerEntry[] = [];
    await rebuildRatingLedger(fakeDatabase(rounds.map((round) => ({ ...round, applied: false })), rebuilt), 'QUALIFICATION');
    expect(canonical(rebuilt)).toBe(canonical(ledger));
  });

  it('applies K=64 to the fifth series and K=32 to the sixth for the same pair', async () => {
    const rounds: FakeRound[] = [];
    const ledger: LedgerEntry[] = [];
    const database = fakeDatabase(rounds, ledger);
    let ratingA = 1000; let ratingB = 1000;
    const deltas: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const round: FakeRound = {
        id: `r${index}`, stage: 'QUALIFICATION', policy: 'elo-adaptive-k-v1',
        snapshot: [{ teamId: 'a', rating: ratingA }, { teamId: 'b', rating: ratingB }], finalizedAt: index, createdAt: index, applied: false,
        series: [{ id: `s${index}`, status: 'FINALIZED', a: 'a', b: 'b', scoreA: 2, scoreB: 0 }],
      };
      rounds.push(round);
      await applyRoundRatings(database, round.id);
      const entry = ledger.find(({ series_id, team_id }) => series_id === `s${index}` && team_id === 'a')!;
      deltas.push(entry.delta);
      ratingA = entry.rating_after;
      ratingB = ledger.find(({ series_id, team_id }) => series_id === `s${index}` && team_id === 'b')!.rating_after;
    }
    expect(deltas).toHaveLength(6);
    const fifth = ledger.find(({ series_id, team_id }) => series_id === 's4' && team_id === 'a')!;
    const sixth = ledger.find(({ series_id, team_id }) => series_id === 's5' && team_id === 'a')!;
    expect(fifth.delta).toBe(calculateEloDelta(fifth.rating_before, ledger.find(({ series_id, team_id }) => series_id === 's4' && team_id === 'b')!.rating_before, 1, 64));
    expect(sixth.delta).toBe(calculateEloDelta(sixth.rating_before, ledger.find(({ series_id, team_id }) => series_id === 's5' && team_id === 'b')!.rating_before, 1, 32));
  });

  it('detects a ledger row that disagrees with the pinned policy', async () => {
    const { rounds, ledger } = await applyAll(3, () => 'elo-adaptive-k-v1');
    ledger[0]!.delta += 1;
    ledger[0]!.rating_after += 1;
    await expect(rebuildRatingLedger(fakeDatabase(rounds, ledger), 'QUALIFICATION')).rejects.toThrow('RATING_LEDGER_MISMATCH');
  });
});

describe('finals eligibility', () => {
  it('requires the minimum finalized series (boundary minimum-1 / minimum)', () => {
    expect(DEFAULT_MINIMUM_FINALS_SERIES).toBe(5);
    expect(finalsEligibility({ ratedSeries: 4, minimumSeries: 5 })).toEqual({ eligible: false, ratedSeries: 4, minimumSeries: 5, shortfall: 1 });
    expect(finalsEligibility({ ratedSeries: 5, minimumSeries: 5 })).toEqual({ eligible: true, ratedSeries: 5, minimumSeries: 5, shortfall: 0 });
    expect(finalsEligibility({ ratedSeries: 9, minimumSeries: 5 }).shortfall).toBe(0);
    expect(finalsEligibility({ ratedSeries: 2, minimumSeries: 3 }).eligible).toBe(false);
    expect(finalsEligibility({ ratedSeries: 3, minimumSeries: 3 }).eligible).toBe(true);
    expect(finalsEligibility({ ratedSeries: 0, minimumSeries: 1 }).eligible).toBe(false);
  });

  it('validates parameters and maps the label', () => {
    for (const minimumSeries of [0, -1, 1.5, Number.NaN]) expect(() => finalsEligibility({ ratedSeries: 1, minimumSeries })).toThrow('MINIMUM_SERIES_INVALID');
    for (const ratedSeries of [-1, 0.5, Number.NaN]) expect(() => finalsEligibility({ ratedSeries, minimumSeries: 5 })).toThrow('RATED_SERIES_INVALID');
    expect(ratingStatusFor(finalsEligibility({ ratedSeries: 4, minimumSeries: 5 }))).toBe('UNRANKED_MIN_SERIES');
    expect(ratingStatusFor(finalsEligibility({ ratedSeries: 5, minimumSeries: 5 }))).toBe('RANKED');
  });

  it('counts only finalized series as rated', () => {
    expect(ratedSeriesCount([{ status: 'FINALIZED' }, { status: 'CANCELLED' }, { status: 'SCHEDULED' }, { status: 'FINALIZED' }])).toBe(2);
  });

  it('reads the enforcement flag strictly', () => {
    expect(isQualificationGateEnforced({})).toBe(false);
    expect(isQualificationGateEnforced({ OTT_QUALIFICATION_GATE_ENFORCED: 'false' })).toBe(false);
    expect(isQualificationGateEnforced({ OTT_QUALIFICATION_GATE_ENFORCED: '1' })).toBe(false);
    expect(isQualificationGateEnforced({ OTT_QUALIFICATION_GATE_ENFORCED: 'true' })).toBe(true);
  });

  it('isSubmissionRankable requires a PASS row', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }).mockResolvedValueOnce({ rows: [] });
    const database = { query } as unknown as Database;
    expect(await isSubmissionRankable(database, 'sub')).toBe(true);
    expect(await isSubmissionRankable(database, 'sub')).toBe(false);
    expect(query.mock.calls[0]?.[0]).toContain("outcome = 'PASS'");
  });
});

describe('leaderboard labels', () => {
  const row = (name: string, wins: number, draws: number, losses: number) => ({
    rank: '1', tie_count: '1', total_count: '2', team_id: name, team_name: name, rating: 1000, head_to_head_points: '0',
    series_wins: wins, series_draws: draws, series_losses: losses, win_rate: '0', technical_fault_count: 0, forfeit_count: 0, updated_at: new Date(0),
  });
  async function get(url: string, rows = [row('four', 2, 1, 1), row('five', 3, 1, 1)]) {
    const query = vi.fn().mockResolvedValue({ rows });
    const app = Fastify({ logger: false });
    registerLeaderboardRoutes(app, { database: { query } as unknown as Database });
    const response = await app.inject({ method: 'GET', url });
    await app.close();
    return { response, query };
  }

  it('labels 4 series as unranked and 5 as ranked without reordering', async () => {
    const { response } = await get('/api/v1/leaderboard');
    expect(response.statusCode).toBe(200);
    const items = response.json().data.items;
    expect(items.map((item: { team: { name: string } }) => item.team.name)).toEqual(['four', 'five']);
    expect(items[0]).toMatchObject({ ratedSeries: 4, finalsEligible: false, ratingStatus: 'UNRANKED_MIN_SERIES', rank: 1, rating: 1000 });
    expect(items[1]).toMatchObject({ ratedSeries: 5, finalsEligible: true, ratingStatus: 'RANKED' });
  });

  it('honours a lowered minimumSeries and rejects invalid values', async () => {
    const lowered = await get('/api/v1/leaderboard?minimumSeries=4');
    expect(lowered.response.json().data.items[0]).toMatchObject({ finalsEligible: true, ratingStatus: 'RANKED' });
    for (const bad of ['0', '51', '-1', 'x', '1.5', '']) {
      const { response, query } = await get(`/api/v1/leaderboard?minimumSeries=${bad}`);
      expect(response.statusCode, bad).toBe(400);
      expect(response.json().error.code).toBe('INVALID_QUERY');
      expect(query).not.toHaveBeenCalled();
    }
  });
});
