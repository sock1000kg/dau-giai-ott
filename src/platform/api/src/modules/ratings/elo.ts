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
