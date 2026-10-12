import { describe, expect, it } from 'vitest';

import { createPairingPlan, pairKey, type PairingParticipant } from '../src/modules/scheduling/pairing.ts';
import { scoreQualificationSeries, type SeriesMatchInput } from '../src/modules/series/scoring.ts';

const teams: PairingParticipant[] = [
  { teamId: 'a', submissionId: 'sa', rating: 1400 },
  { teamId: 'b', submissionId: 'sb', rating: 1300 },
  { teamId: 'c', submissionId: 'sc', rating: 1100 },
  { teamId: 'd', submissionId: 'sd', rating: 1000 },
  { teamId: 'e', submissionId: 'se', rating: 900 },
];

describe('P2-T12 deterministic scheduling rules', () => {
  it('creates stable, non-self pairings and a stable odd-team bye', () => {
    const first = createPairingPlan(teams);
    const second = createPairingPlan([...teams].reverse());

    expect(first).toEqual(second);
    expect(first.pairings).toHaveLength(2);
    expect(first.bye?.teamId).toBe('e');
    expect(first.pairings.every(({ x, o }) => x.teamId !== o.teamId)).toBe(true);
    expect(new Set(first.pairings.flatMap(({ x, o }) => [x.teamId, o.teamId])).size).toBe(4);
  });

  it('expands Elo band deterministically and avoids a recent rematch when possible', () => {
    const participants = teams.slice(0, 4);
    const plan = createPairingPlan(participants, {
      previousPairs: new Set([pairKey('a', 'b')]),
    });

    expect(plan.pairings[0]).toMatchObject({ x: { teamId: 'a' }, o: { teamId: 'c' }, ratingBand: 300, rematch: false });
    expect(plan.pairings[1]).toMatchObject({ x: { teamId: 'b' }, o: { teamId: 'd' }, ratingBand: 300, rematch: false });
  });

  it('gives a bye to a team without a recent bye before reusing one', () => {
    const plan = createPairingPlan(teams, { previousByes: new Set(['e']) });
    expect(plan.bye?.teamId).toBe('d');
  });

  it('uses the smallest band when a rematch is unavoidable', () => {
    const [a, b] = teams;
    const plan = createPairingPlan([a!, b!], { previousPairs: new Set([pairKey(a!.teamId, b!.teamId)]) });
    expect(plan.pairings).toMatchObject([{ ratingBand: 200, rematch: true }]);
  });

  it('rejects duplicate teams and invalid ratings', () => {
    expect(() => createPairingPlan([teams[0]!, teams[0]!])).toThrow('TEAM_DUPLICATE');
    expect(() => createPairingPlan([{ ...teams[0]!, rating: Number.NaN }])).toThrow('RATING_INVALID');
  });
});

describe('P2-T12 qualification series scoring', () => {
  it('waits until both swapped-side matches are terminal', () => {
    const result = scoreQualificationSeries([
      { status: 'FINALIZED', teamASide: 'X', winnerSide: 'X' },
      { status: 'RUNNING', teamASide: 'O' },
    ]);
    expect(result).toEqual({ state: 'PENDING' });
  });

  it('scores wins, draws and mixed outcomes without depending on result arrival order', () => {
    const matchSets: readonly SeriesMatchInput[][] = [
      [{ status: 'FINALIZED', teamASide: 'X', winnerSide: 'X' }, { status: 'FINALIZED', teamASide: 'O', winnerSide: 'X' }],
      [{ status: 'FINALIZED', teamASide: 'X', winnerSide: 'X' }, { status: 'FINALIZED', teamASide: 'O', winnerSide: null }],
      [{ status: 'FINALIZED', teamASide: 'X', winnerSide: 'X' }, { status: 'FINALIZED', teamASide: 'O', winnerSide: 'O' }],
    ];
    expect(scoreQualificationSeries(matchSets[0]!)).toMatchObject({ state: 'FINALIZED', xScore: 1, oScore: 1, winnerSide: null });
    expect(scoreQualificationSeries(matchSets[1]!)).toMatchObject({ state: 'FINALIZED', xScore: 1.5, oScore: 0.5, winnerSide: 'X' });
    expect(scoreQualificationSeries(matchSets[2]!)).toMatchObject({ state: 'FINALIZED', xScore: 2, oScore: 0, winnerSide: 'X' });
  });

  it('does not score infrastructure failure or cancellation', () => {
    expect(scoreQualificationSeries([
      { status: 'FINALIZED', teamASide: 'X', winnerSide: 'X' }, { status: 'FAILED', teamASide: 'O' },
    ])).toEqual({ state: 'CANCELLED', reason: 'INFRASTRUCTURE_FAILURE' });
    expect(scoreQualificationSeries([
      { status: 'FINALIZED', teamASide: 'X', winnerSide: 'X' }, { status: 'CANCELLED', teamASide: 'O' },
    ])).toEqual({ state: 'CANCELLED', reason: 'MATCH_CANCELLED' });
  });

  it('rejects any format other than exactly two qualification games', () => {
    expect(() => scoreQualificationSeries([{ status: 'FINALIZED', teamASide: 'X', winnerSide: 'X' }])).toThrow('SERIES_MATCH_COUNT_INVALID');
  });
});
