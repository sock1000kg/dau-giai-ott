export type SeriesMatchInput =
  | { readonly status: 'SCHEDULED' | 'RUNNING'; readonly teamASide: 'X' | 'O'; readonly winnerSide?: null }
  | { readonly status: 'FAILED' | 'CANCELLED'; readonly teamASide: 'X' | 'O'; readonly winnerSide?: null }
  | { readonly status: 'FINALIZED'; readonly teamASide: 'X' | 'O'; readonly winnerSide: 'X' | 'O' | null };

export type SeriesScore =
  | { readonly state: 'PENDING' }
  | { readonly state: 'CANCELLED'; readonly reason: 'MATCH_CANCELLED' | 'INFRASTRUCTURE_FAILURE' }
  | {
    readonly state: 'FINALIZED';
    readonly xScore: 0 | 0.5 | 1 | 1.5 | 2;
    readonly oScore: 0 | 0.5 | 1 | 1.5 | 2;
    readonly winnerSide: 'X' | 'O' | null;
  };

/** Qualification series are exactly two side-swapped games; infra failures never score. */
export function scoreQualificationSeries(matches: readonly SeriesMatchInput[]): SeriesScore {
  if (matches.length !== 2) throw new Error('SERIES_MATCH_COUNT_INVALID');
  if (matches.some(({ status }) => status === 'SCHEDULED' || status === 'RUNNING')) return { state: 'PENDING' };
  if (matches.some(({ status }) => status === 'FAILED')) return { state: 'CANCELLED', reason: 'INFRASTRUCTURE_FAILURE' };
  if (matches.some(({ status }) => status === 'CANCELLED')) return { state: 'CANCELLED', reason: 'MATCH_CANCELLED' };

  const scores = matches.map(({ winnerSide, teamASide }) => winnerSide === null ? 0.5 : winnerSide === teamASide ? 1 : 0);
  const xScore = scores[0]! + scores[1]!;
  const oScore = matches.length - xScore;
  return {
    state: 'FINALIZED',
    xScore: xScore as 0 | 0.5 | 1 | 1.5 | 2,
    oScore: oScore as 0 | 0.5 | 1 | 1.5 | 2,
    winnerSide: xScore === oScore ? null : xScore > oScore ? 'X' : 'O',
  };
}
