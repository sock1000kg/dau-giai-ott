import { describe, expect, it } from 'vitest';

import {
  createFinalsBracket,
  planSeriesGames,
  resolveBracket,
  applySeriesOverride,
  QUARTERFINAL_SEED_PAIRS,
  type SeriesOutcomeInput,
} from '../src/modules/finals/scheduling.ts';
import {
  decideFinalsGame,
  scoreFinalsSeries,
  type FinalsCriterionValue,
  type FinalsScoringContext,
} from '../src/modules/finals/scoring.ts';
import {
  seedFinals,
  seedingHashOf,
  verifyLockedSeeding,
  type FinalsSeedCandidate,
  type HeadToHeadResult,
  type LockedSeeding,
} from '../src/modules/finals/seeding.ts';

/**
 * P3-L06 finals domain tests. Source of truth: docs/contracts/finals-format-v1.md, requirement 12
 * and AC-09. Everything here is pure domain, so no database is required.
 */

const DRAW_SEED = 'finals-draw-2026-10-18';

function candidate(
  teamId: string,
  elo: number,
  seriesWins: number,
  gamePointDifferential: number,
  ratedSeries = 5,
): FinalsSeedCandidate {
  return { teamId, submissionId: `sub-${teamId}`, elo, seriesWins, gamePointDifferential, ratedSeries };
}

/** AC-09 fixture: eight eligible teams with a strict Elo order, so the seed order is unambiguous. */
const AC09_CANDIDATES: readonly FinalsSeedCandidate[] = [
  candidate('a', 1800, 7, 12),
  candidate('b', 1700, 6, 9),
  candidate('c', 1600, 6, 8),
  candidate('d', 1500, 5, 6),
  candidate('e', 1400, 5, 5),
  candidate('f', 1300, 4, 3),
  candidate('g', 1200, 3, 1),
  candidate('h', 1100, 2, -4),
];

describe('P3-L06 seeding: qualification seed order', () => {
  it('AC-09 fixture produces the unique ordinal 1..8 by Elo', () => {
    const { locked, excluded } = seedFinals(AC09_CANDIDATES, { drawSeed: DRAW_SEED });
    expect(excluded).toEqual([]);
    expect(locked.seeds.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(locked.seeds.map(({ teamId }) => teamId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('breaks an Elo tie by series wins and then by game-point differential', () => {
    const { locked } = seedFinals(
      [
        candidate('low-wins', 1500, 4, 20),
        candidate('high-wins', 1500, 6, 1),
        candidate('high-diff', 1500, 6, 9),
        candidate('d', 1400, 1, 0),
        candidate('e', 1300, 1, 0),
        candidate('f', 1200, 1, 0),
        candidate('g', 1100, 1, 0),
        candidate('h', 1000, 1, 0),
      ],
      { drawSeed: DRAW_SEED },
    );
    expect(locked.seeds.slice(0, 3).map(({ teamId }) => teamId)).toEqual(['high-diff', 'high-wins', 'low-wins']);
  });

  it('uses head-to-head only when a bucket holds exactly two teams', () => {
    const headToHead: readonly HeadToHeadResult[] = [{ teamA: 'loser', teamB: 'winner', pointsA: 0, pointsB: 2 }];
    const tied = [
      candidate('loser', 1500, 5, 5),
      candidate('winner', 1500, 5, 5),
      candidate('c', 1400, 1, 0),
      candidate('d', 1300, 1, 0),
      candidate('e', 1200, 1, 0),
      candidate('f', 1100, 1, 0),
      candidate('g', 1000, 1, 0),
      candidate('h', 900, 1, 0),
    ];
    const { locked } = seedFinals(tied, { drawSeed: DRAW_SEED, headToHead });
    expect(locked.seeds[0]!.teamId).toBe('winner');
    expect(locked.seeds[1]!.teamId).toBe('loser');
  });
});

describe('P3-L06 seeding: deterministic draw and locking', () => {
  const threeWayTie: readonly FinalsSeedCandidate[] = [
    candidate('x', 1500, 5, 5),
    candidate('y', 1500, 5, 5),
    candidate('z', 1500, 5, 5),
    candidate('d', 1400, 1, 0),
    candidate('e', 1300, 1, 0),
    candidate('f', 1200, 1, 0),
    candidate('g', 1100, 1, 0),
    candidate('h', 1000, 1, 0),
  ];

  it('resolves a bucket larger than two with the committed draw seed only', () => {
    const first = seedFinals(threeWayTie, { drawSeed: DRAW_SEED }).locked;
    const second = seedFinals([...threeWayTie].reverse(), { drawSeed: DRAW_SEED }).locked;
    expect(second.seedingHash).toBe(first.seedingHash);
    expect(first.seeds.slice(0, 3).map(({ teamId }) => teamId).sort()).toEqual(['x', 'y', 'z']);

    const otherDraw = seedFinals(threeWayTie, { drawSeed: 'finals-draw-published-later' }).locked;
    expect(otherDraw.seedingHash).not.toBe(first.seedingHash);
  });

  it('is order-independent and stable for the same committed draw seed', () => {
    const forward = seedFinals(AC09_CANDIDATES, { drawSeed: DRAW_SEED }).locked;
    const reversed = seedFinals([...AC09_CANDIDATES].reverse(), { drawSeed: DRAW_SEED }).locked;
    expect(reversed.seedingHash).toBe(forward.seedingHash);
    expect(seedingHashOf(forward.seeds)).toBe(forward.seedingHash);
  });

  it('locks the seeding so a later stage can prove it did not change (AC-09)', () => {
    const { locked } = seedFinals(AC09_CANDIDATES, { drawSeed: DRAW_SEED });
    expect(Object.isFrozen(locked)).toBe(true);
    expect(Object.isFrozen(locked.seeds)).toBe(true);
    expect(verifyLockedSeeding(locked)).toBe(true);
    expect(verifyLockedSeeding({ ...locked, seeds: [...locked.seeds].reverse() })).toBe(false);
  });

  it('reports teams below the D-22 minimum-series rule instead of ranking them', () => {
    const withIneligible = [
      ...AC09_CANDIDATES.slice(0, 7),
      candidate('rookie', 2000, 9, 40, 3),
      candidate('late', 1050, 1, -8, 5),
    ];
    const { locked, excluded } = seedFinals(withIneligible, { drawSeed: DRAW_SEED });
    expect(excluded).toEqual([{ teamId: 'rookie', ratedSeries: 3, shortfall: 2 }]);
    expect(locked.seeds).toHaveLength(8);
    expect(locked.seeds.map(({ teamId }) => teamId)).not.toContain('rookie');
    expect(locked.seeds[7]!.teamId).toBe('late');
  });

  it('lowers the threshold only when the caller publishes it', () => {
    const withIneligible = [...AC09_CANDIDATES.slice(0, 7), candidate('rookie', 2000, 9, 40, 3)];
    expect(() => seedFinals(withIneligible, { drawSeed: DRAW_SEED })).toThrow('FINALS_SEED_COUNT_INVALID');
    const { locked, excluded } = seedFinals(withIneligible, { drawSeed: DRAW_SEED, minimumSeries: 3 });
    expect(excluded).toEqual([]);
    expect(locked.seeds[0]!.teamId).toBe('rookie');
  });

  it('rejects duplicate teams, invalid seeds and malformed metrics', () => {
    expect(() => seedFinals([...AC09_CANDIDATES, candidate('a', 1000, 1, 0)], { drawSeed: DRAW_SEED })).toThrow(
      'FINALS_CANDIDATE_DUPLICATE',
    );
    expect(() =>
      seedFinals([...AC09_CANDIDATES.slice(0, 7), { ...candidate('h', 1100, 2, -4), submissionId: 'sub-a' }], {
        drawSeed: DRAW_SEED,
      }),
    ).toThrow('FINALS_CANDIDATE_DUPLICATE');
    expect(() => seedFinals(AC09_CANDIDATES, { drawSeed: '' })).toThrow('FINALS_DRAW_SEED_INVALID');
    expect(() =>
      seedFinals([...AC09_CANDIDATES.slice(0, 7), candidate('nan', Number.NaN, 1, 0)], { drawSeed: DRAW_SEED }),
    ).toThrow('FINALS_CANDIDATE_INVALID');
    expect(() => seedFinals(AC09_CANDIDATES.slice(0, 7), { drawSeed: DRAW_SEED })).toThrow('FINALS_SEED_COUNT_INVALID');
  });
});

const AC09_LOCKED: LockedSeeding = seedFinals(AC09_CANDIDATES, { drawSeed: DRAW_SEED }).locked;

function seedOf(slot: { readonly kind: string; readonly seed?: number }): number | null {
  return slot.kind === 'SEED' ? (slot.seed ?? null) : null;
}

describe('P3-L06 bracket: fixed single elimination', () => {
  it('uses the locked ordinals for the fixed quarterfinal pairs 1–8 / 4–5 / 2–7 / 3–6', () => {
    expect(QUARTERFINAL_SEED_PAIRS).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
    const bracket = createFinalsBracket(AC09_LOCKED);
    const quarterfinals = bracket.pairings.filter(({ round }) => round === 'QUARTERFINAL');
    expect(quarterfinals.map(({ id }) => id)).toEqual(['QF1', 'QF2', 'QF3', 'QF4']);
    expect(quarterfinals.map(({ home, away }) => [seedOf(home), seedOf(away)])).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
    expect(bracket.seeds.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('wires semifinals, final and the optional bronze match from earlier results', () => {
    const withBronze = createFinalsBracket(AC09_LOCKED);
    expect(withBronze.bronzeMatchEnabled).toBe(true);
    expect(withBronze.pairings.map(({ id }) => id)).toEqual(['QF1', 'QF2', 'QF3', 'QF4', 'SF1', 'SF2', 'F1', 'B1']);
    expect(withBronze.pairings.find(({ id }) => id === 'SF1')).toMatchObject({
      home: { kind: 'WINNER', pairingId: 'QF1' },
      away: { kind: 'WINNER', pairingId: 'QF2' },
    });
    expect(withBronze.pairings.find(({ id }) => id === 'F1')).toMatchObject({
      home: { kind: 'WINNER', pairingId: 'SF1' },
      away: { kind: 'WINNER', pairingId: 'SF2' },
    });
    expect(withBronze.pairings.find(({ id }) => id === 'B1')).toMatchObject({
      home: { kind: 'LOSER', pairingId: 'SF1' },
      away: { kind: 'LOSER', pairingId: 'SF2' },
    });

    const withoutBronze = createFinalsBracket(AC09_LOCKED, { bronzeMatchEnabled: false });
    expect(withoutBronze.bronzeMatchEnabled).toBe(false);
    expect(withoutBronze.pairings.some(({ round }) => round === 'BRONZE')).toBe(false);
  });

  it('refuses a seeding that is not the unique ordinal 1..8', () => {
    expect(() => createFinalsBracket({ ...AC09_LOCKED, seeds: AC09_LOCKED.seeds.slice(0, 7) })).toThrow(
      'FINALS_SEED_COUNT_INVALID',
    );
    const duplicated = AC09_LOCKED.seeds.map((seed) => ({ ...seed, ordinal: 1 }));
    expect(() => createFinalsBracket({ ...AC09_LOCKED, seeds: duplicated })).toThrow('FINALS_SEED_INVALID');
  });
});

describe('P3-L06 series plan: side swap and map policy', () => {
  const pool = ['default', 'arena', 'cross', 'fortress'];

  it('swaps sides in games 1 and 2 and takes game 3 from the committed series seed', () => {
    const games = planSeriesGames({ seriesSeed: 'series-seed-alpha', mapPool: pool });
    expect(games.map(({ game }) => game)).toEqual([1, 2, 3]);
    expect(games[0]).toMatchObject({ homeSide: 'X', awaySide: 'O' });
    expect(games[1]).toMatchObject({ homeSide: 'O', awaySide: 'X' });

    const repeat = planSeriesGames({ seriesSeed: 'series-seed-alpha', mapPool: pool });
    expect(repeat[2]!.homeSide).toBe(games[2]!.homeSide);

    const sides = new Set(
      Array.from({ length: 24 }, (_, index) => planSeriesGames({ seriesSeed: `seed-${index}`, mapPool: pool })[2]!.homeSide),
    );
    expect([...sides].sort()).toEqual(['O', 'X']);
  });

  it('does not repeat a map inside a series until the locked pool is exhausted', () => {
    const games = planSeriesGames({ seriesSeed: 'series-seed-alpha', mapPool: pool });
    expect(new Set(games.map(({ mapId }) => mapId)).size).toBe(3);

    const smallPool = planSeriesGames({ seriesSeed: 'series-seed-alpha', mapPool: ['default', 'arena'] });
    expect(smallPool[0]!.mapId).not.toBe(smallPool[1]!.mapId);
    expect(smallPool[2]!.mapId).toBe(smallPool[0]!.mapId);
  });

  it('rejects an unusable map pool, an empty seed and a non-BO3 format', () => {
    expect(() => planSeriesGames({ seriesSeed: 'seed', mapPool: [] })).toThrow('FINALS_MAP_POOL_EMPTY');
    expect(() => planSeriesGames({ seriesSeed: 'seed', mapPool: ['a', 'a'] })).toThrow('FINALS_MAP_POOL_DUPLICATE');
    expect(() => planSeriesGames({ seriesSeed: 'seed', mapPool: [''] })).toThrow('FINALS_MAP_POOL_INVALID');
    expect(() => planSeriesGames({ seriesSeed: '', mapPool: pool })).toThrow('FINALS_SERIES_SEED_INVALID');
    expect(() => planSeriesGames({ seriesSeed: 'seed', mapPool: pool, bestOf: 5 })).toThrow('FINALS_BEST_OF_INVALID');
  });
});

const AC09_BRACKET = createFinalsBracket(AC09_LOCKED);

describe('P3-L06 advancement: the bracket only moves on a FINALIZED series', () => {
  it('keeps later rounds pending until their feeding series is finalized', () => {
    const resolved = resolveBracket(AC09_BRACKET, []);
    expect(resolved.find(({ id }) => id === 'SF1')).toMatchObject({ homeSeed: null, awaySeed: null, state: 'PENDING' });

    const afterQuarterfinal = resolveBracket(AC09_BRACKET, [
      { pairingId: 'QF1', state: 'FINALIZED', winnerSeed: 1 },
    ]);
    expect(afterQuarterfinal.find(({ id }) => id === 'SF1')).toMatchObject({
      homeSeed: 1,
      awaySeed: null,
      winnerSeed: null,
      state: 'PENDING',
    });
  });

  it('resolves quarterfinals to the final and the bronze match from finalized results only', () => {
    const resolved = resolveBracket(AC09_BRACKET, [
      { pairingId: 'QF1', state: 'FINALIZED', winnerSeed: 1 },
      { pairingId: 'QF2', state: 'FINALIZED', winnerSeed: 4 },
      { pairingId: 'QF3', state: 'FINALIZED', winnerSeed: 2 },
      { pairingId: 'QF4', state: 'FINALIZED', winnerSeed: 3 },
      { pairingId: 'SF1', state: 'FINALIZED', winnerSeed: 1 },
      { pairingId: 'SF2', state: 'FINALIZED', winnerSeed: 2 },
      { pairingId: 'F1', state: 'FINALIZED', winnerSeed: 1 },
    ]);
    expect(resolved.find(({ id }) => id === 'SF1')).toMatchObject({ homeSeed: 1, awaySeed: 4, winnerSeed: 1 });
    expect(resolved.find(({ id }) => id === 'F1')).toMatchObject({ homeSeed: 1, awaySeed: 2, winnerSeed: 1 });
    expect(resolved.find(({ id }) => id === 'B1')).toMatchObject({ homeSeed: 4, awaySeed: 3, state: 'PENDING' });
  });

  it('refuses a winner reported by a series that is not FINALIZED', () => {
    const outcomes: readonly SeriesOutcomeInput[] = [{ pairingId: 'QF1', state: 'RUNNING', winnerSeed: 1 }];
    expect(() => resolveBracket(AC09_BRACKET, outcomes)).toThrow('FINALS_SERIES_NOT_FINALIZED');
  });

  it('refuses a winner that is not one of the two seeds in the pairing', () => {
    expect(() => resolveBracket(AC09_BRACKET, [{ pairingId: 'QF1', state: 'FINALIZED', winnerSeed: 5 }])).toThrow(
      'FINALS_WINNER_INVALID',
    );
    expect(() => resolveBracket(AC09_BRACKET, [{ pairingId: 'QF1', state: 'FINALIZED' }])).toThrow(
      'FINALS_WINNER_INVALID',
    );
  });

  it('refuses unknown or duplicated pairings', () => {
    expect(() => resolveBracket(AC09_BRACKET, [{ pairingId: 'QF9', state: 'SCHEDULED' }])).toThrow(
      'FINALS_PAIRING_UNKNOWN',
    );
    expect(() =>
      resolveBracket(AC09_BRACKET, [
        { pairingId: 'QF1', state: 'SCHEDULED' },
        { pairingId: 'QF1', state: 'SCHEDULED' },
      ]),
    ).toThrow('FINALS_PAIRING_DUPLICATE');
  });
});

describe('P3-L06 override: audit evidence is mandatory', () => {
  const audit = {
    reason: 'server crash after the final turn',
    actor: 'btc-referee-1',
    at: '2026-10-20T10:00:00Z',
    evidenceRef: 'https://btc.example/evidence/42',
  };

  it('accepts a complete override and freezes the audit record', () => {
    const override = applySeriesOverride({ pairingId: 'QF1', winnerSeed: 8, loserSeed: 1, audit });
    expect(override).toMatchObject({ pairingId: 'QF1', winnerSeed: 8, loserSeed: 1 });
    expect(Object.isFrozen(override.audit)).toBe(true);
    expect(override.audit.evidenceRef).toBe(audit.evidenceRef);
  });

  it('refuses an override missing reason, actor, time or evidence link', () => {
    expect(() =>
      applySeriesOverride({ pairingId: 'QF1', winnerSeed: 8, loserSeed: 1, audit: { ...audit, reason: '   ' } }),
    ).toThrow('FINALS_OVERRIDE_AUDIT_REQUIRED');
    expect(() =>
      applySeriesOverride({ pairingId: 'QF1', winnerSeed: 8, loserSeed: 1, audit: { ...audit, actor: '' } }),
    ).toThrow('FINALS_OVERRIDE_AUDIT_REQUIRED');
    expect(() =>
      applySeriesOverride({ pairingId: 'QF1', winnerSeed: 8, loserSeed: 1, audit: { ...audit, at: '' } }),
    ).toThrow('FINALS_OVERRIDE_AUDIT_REQUIRED');
    expect(() =>
      applySeriesOverride({ pairingId: 'QF1', winnerSeed: 8, loserSeed: 1, audit: { ...audit, evidenceRef: '' } }),
    ).toThrow('FINALS_OVERRIDE_AUDIT_REQUIRED');
    expect(() => applySeriesOverride({ pairingId: '  ', winnerSeed: 8, loserSeed: 1, audit })).toThrow(
      'FINALS_OVERRIDE_AUDIT_REQUIRED',
    );
    expect(() => applySeriesOverride({ pairingId: 'QF1', winnerSeed: 1, loserSeed: 1, audit })).toThrow(
      'FINALS_WINNER_INVALID',
    );
  });
});

const SCORING_CONTEXT: FinalsScoringContext = {
  adapterId: 'ott-game-adapter',
  adapterVersion: '1.0.0',
  pinnedAdapterId: 'ott-game-adapter',
  pinnedAdapterVersion: '1.0.0',
  homeSeed: 3,
  awaySeed: 6,
};

function criterion(
  criterionId: string,
  direction: 'HIGHER_WINS' | 'LOWER_WINS',
  home: number,
  away: number,
): FinalsCriterionValue {
  return { criterionId, direction, home, away };
}

describe('P3-L06 scoring: adapter decision order (D-05)', () => {
  it('takes a direct adapter winner before any criterion', () => {
    const decision = decideFinalsGame(
      { directWinner: 'AWAY', scoreBreakdown: [criterion('captures', 'HIGHER_WINS', 9, 1)] },
      SCORING_CONTEXT,
    );
    expect(decision).toMatchObject({ winner: 'AWAY', basis: 'DIRECT', criterionId: null });
    expect(decision.breakdown).toHaveLength(1);
  });

  it('walks the ordered breakdown and honours the declared comparison direction', () => {
    const decidedByPosition = decideFinalsGame(
      {
        scoreBreakdown: [
          criterion('captures', 'HIGHER_WINS', 2, 2),
          criterion('position', 'LOWER_WINS', 10, 4),
        ],
      },
      SCORING_CONTEXT,
    );
    expect(decidedByPosition).toMatchObject({ winner: 'AWAY', basis: 'CRITERION', criterionId: 'position' });

    const decidedByCaptures = decideFinalsGame(
      { scoreBreakdown: [criterion('captures', 'HIGHER_WINS', 3, 1), criterion('position', 'LOWER_WINS', 10, 4)] },
      SCORING_CONTEXT,
    );
    expect(decidedByCaptures).toMatchObject({ winner: 'HOME', basis: 'CRITERION', criterionId: 'captures' });
  });

  it('falls back to the better qualification seed so a finals game never draws', () => {
    const tied = decideFinalsGame(
      { scoreBreakdown: [criterion('captures', 'HIGHER_WINS', 3, 3), criterion('position', 'LOWER_WINS', 2, 2)] },
      SCORING_CONTEXT,
    );
    expect(tied).toMatchObject({ winner: 'HOME', basis: 'QUALIFICATION_SEED', criterionId: null });
    expect(decideFinalsGame({}, { ...SCORING_CONTEXT, homeSeed: 6, awaySeed: 3 }).winner).toBe('AWAY');
  });

  it('always produces exactly one winner across every criterion combination', () => {
    const outcomes = new Set<string>();
    for (const home of [0, 1, 2]) {
      for (const away of [0, 1, 2]) {
        const decision = decideFinalsGame(
          {
            scoreBreakdown: [
              criterion('captures', 'HIGHER_WINS', home, away),
              criterion('position', 'LOWER_WINS', away, home),
            ],
          },
          SCORING_CONTEXT,
        );
        expect(['HOME', 'AWAY']).toContain(decision.winner);
        expect(decision.basis === 'QUALIFICATION_SEED' || decision.criterionId !== null).toBe(true);
        outcomes.add(`${home}-${away}:${decision.winner}:${decision.basis}`);
      }
    }
    expect(outcomes.size).toBeGreaterThan(3);
  });

  it('refuses an unpinned adapter, duplicate criteria, malformed values and equal seeds', () => {
    expect(() => decideFinalsGame({ directWinner: 'HOME' }, { ...SCORING_CONTEXT, adapterVersion: '2.0.0' })).toThrow(
      'FINALS_ADAPTER_VERSION_MISMATCH',
    );
    expect(() => decideFinalsGame({ directWinner: 'HOME' }, { ...SCORING_CONTEXT, adapterId: 'other' })).toThrow(
      'FINALS_ADAPTER_VERSION_MISMATCH',
    );
    expect(() =>
      decideFinalsGame(
        { scoreBreakdown: [criterion('c', 'HIGHER_WINS', 1, 2), criterion('c', 'LOWER_WINS', 1, 2)] },
        SCORING_CONTEXT,
      ),
    ).toThrow('FINALS_CRITERION_DUPLICATE');
    expect(() =>
      decideFinalsGame({ scoreBreakdown: [criterion('c', 'HIGHER_WINS', Number.NaN, 2)] }, SCORING_CONTEXT),
    ).toThrow('FINALS_CRITERION_INVALID');
    expect(() => decideFinalsGame({ scoreBreakdown: [criterion('', 'HIGHER_WINS', 1, 2)] }, SCORING_CONTEXT)).toThrow(
      'FINALS_CRITERION_INVALID',
    );
    expect(() => decideFinalsGame({}, { ...SCORING_CONTEXT, awaySeed: 3 })).toThrow('FINALS_SEED_INVALID');
  });

  it('scores a BO3 series to the first side with two game wins', () => {
    expect(scoreFinalsSeries([])).toEqual({ state: 'PENDING', winner: null, homeGames: 0, awayGames: 0 });
    expect(scoreFinalsSeries(['HOME', 'AWAY'])).toEqual({ state: 'PENDING', winner: null, homeGames: 1, awayGames: 1 });
    expect(scoreFinalsSeries(['HOME', 'HOME'])).toEqual({
      state: 'FINALIZED',
      winner: 'HOME',
      homeGames: 2,
      awayGames: 0,
    });
    expect(scoreFinalsSeries(['AWAY', 'HOME', 'HOME'])).toEqual({
      state: 'FINALIZED',
      winner: 'HOME',
      homeGames: 2,
      awayGames: 1,
    });
    expect(() => scoreFinalsSeries(['HOME', 'HOME', 'HOME'])).toThrow('FINALS_SERIES_EXTRA_GAME');
    expect(() => scoreFinalsSeries(['HOME', 'AWAY', 'HOME', 'AWAY'])).toThrow('FINALS_SERIES_EXTRA_GAME');
    expect(() => scoreFinalsSeries(['HOME'], { bestOf: 5 })).toThrow('FINALS_BEST_OF_INVALID');
  });
});

describe('P3-L06 mutation evidence: each pinned rule is observable', () => {
  it('mutation: swapping the first two tie-break keys would change the AC-09 order', () => {
    const candidates = [
      candidate('elo-first', 1700, 1, 0),
      candidate('wins-first', 1600, 9, 30),
      ...AC09_CANDIDATES.slice(2),
    ];
    const { locked } = seedFinals(candidates, { drawSeed: DRAW_SEED });
    const mutatedFirst = [...candidates].sort((a, b) => b.seriesWins - a.seriesWins)[0]!.teamId;
    expect(locked.seeds[0]!.teamId).toBe('elo-first');
    expect(mutatedFirst).toBe('wins-first');
  });

  it('mutation: ignoring the committed draw seed would change a three-way tie', () => {
    const tied = [
      candidate('x', 1500, 5, 5),
      candidate('y', 1500, 5, 5),
      candidate('z', 1500, 5, 5),
      ...AC09_CANDIDATES.slice(3),
    ];
    const first = seedFinals(tied, { drawSeed: DRAW_SEED }).locked.seedingHash;
    const second = seedFinals(tied, { drawSeed: 'another-published-draw' }).locked.seedingHash;
    expect(first).not.toBe(second);
  });

  it('mutation: dropping the game-1/game-2 side swap would be visible', () => {
    const games = planSeriesGames({ seriesSeed: 'series-seed-alpha', mapPool: ['default', 'arena', 'cross'] });
    expect(games[0]!.homeSide).not.toBe(games[1]!.homeSide);
    expect(games[0]!.awaySide).toBe(games[1]!.homeSide);
  });

  it('mutation: allowing a repeated map would be visible', () => {
    const games = planSeriesGames({ seriesSeed: 'series-seed-alpha', mapPool: ['default', 'arena', 'cross'] });
    expect(new Set(games.map(({ mapId }) => mapId)).size).toBe(3);
  });

  it('mutation: reversing the breakdown order would pick another winner', () => {
    const capturesFirst = decideFinalsGame(
      { scoreBreakdown: [criterion('captures', 'HIGHER_WINS', 1, 2), criterion('position', 'HIGHER_WINS', 5, 0)] },
      SCORING_CONTEXT,
    );
    const positionFirst = decideFinalsGame(
      { scoreBreakdown: [criterion('position', 'HIGHER_WINS', 5, 0), criterion('captures', 'HIGHER_WINS', 1, 2)] },
      SCORING_CONTEXT,
    );
    expect(capturesFirst.winner).toBe('AWAY');
    expect(positionFirst.winner).toBe('HOME');
  });

  it('mutation: ignoring the pinned adapter version is rejected', () => {
    expect(() =>
      decideFinalsGame({ directWinner: 'HOME' }, { ...SCORING_CONTEXT, pinnedAdapterVersion: '9.9.9' }),
    ).toThrow('FINALS_ADAPTER_VERSION_MISMATCH');
  });

  it('mutation: removing the qualification-seed fallback would leave a draw', () => {
    const decision = decideFinalsGame({ scoreBreakdown: [criterion('captures', 'HIGHER_WINS', 1, 1)] }, SCORING_CONTEXT);
    expect(['HOME', 'AWAY']).toContain(decision.winner);
    expect(decision.basis).toBe('QUALIFICATION_SEED');
  });
});
