const DEFAULT_K_FACTOR = 32;

export function expectedScore(rating: number, opponentRating: number): number {
  if (!Number.isSafeInteger(rating) || !Number.isSafeInteger(opponentRating)) throw new Error('RATING_INVALID');
  return 1 / (1 + (10 ** ((opponentRating - rating) / 400)));
}

export function calculateEloDelta(rating: number, opponentRating: number, score: number, kFactor = DEFAULT_K_FACTOR): number {
  if (score !== 0 && score !== 0.5 && score !== 1) throw new Error('SCORE_INVALID');
  if (!Number.isSafeInteger(kFactor) || kFactor <= 0) throw new Error('K_FACTOR_INVALID');
  return Math.round(kFactor * (score - expectedScore(rating, opponentRating)));
}

/**
 * Rating policies are pinned per round (`rounds.rating_policy_version`) so ledgers written under an
 * older policy keep rebuilding byte-identically. `elo-k32-v1` is the Phase 2 behaviour: K=32 and a
 * zero-sum series. `elo-adaptive-k-v1` uses K=64 for a team's first five rated series, then 32; with
 * different K per team the two deltas of a series are no longer exact negatives, so total rating is
 * not conserved under that policy.
 */
export const RATING_POLICIES = {
  'elo-k32-v1': { initialK: 32, settledK: 32, provisionalSeries: 0 },
  'elo-adaptive-k-v1': { initialK: 64, settledK: 32, provisionalSeries: 5 },
} as const;

export type RatingPolicyVersion = keyof typeof RATING_POLICIES;

export const LEGACY_RATING_POLICY: RatingPolicyVersion = 'elo-k32-v1';
export const CURRENT_RATING_POLICY: RatingPolicyVersion = 'elo-adaptive-k-v1';

export function isRatingPolicyVersion(value: unknown): value is RatingPolicyVersion {
  return typeof value === 'string' && Object.hasOwn(RATING_POLICIES, value);
}

export function kFactorFor(policy: string, priorRatedSeries: number): number {
  if (!isRatingPolicyVersion(policy)) throw new Error('RATING_POLICY_UNKNOWN');
  if (!Number.isSafeInteger(priorRatedSeries) || priorRatedSeries < 0) throw new Error('PRIOR_SERIES_INVALID');
  const rule = RATING_POLICIES[policy];
  return priorRatedSeries < rule.provisionalSeries ? rule.initialK : rule.settledK;
}

export interface SeriesDeltas {
  readonly deltaA: number;
  readonly deltaB: number;
}

/** Each team's delta under the pinned policy; equal K keeps the legacy zero-sum rounding. */
export function seriesDeltas(
  policy: string,
  ratingA: number,
  ratingB: number,
  scoreA: 0 | 0.5 | 1,
  priorRatedA: number,
  priorRatedB: number,
): SeriesDeltas {
  const kA = kFactorFor(policy, priorRatedA);
  const kB = kFactorFor(policy, priorRatedB);
  const deltaA = calculateEloDelta(ratingA, ratingB, scoreA, kA);
  const deltaB = kA === kB ? -deltaA : calculateEloDelta(ratingB, ratingA, (1 - scoreA) as 0 | 0.5 | 1, kB);
  return { deltaA, deltaB };
}
