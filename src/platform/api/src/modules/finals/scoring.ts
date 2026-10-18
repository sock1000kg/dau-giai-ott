import { FINALS_BEST_OF } from './scheduling.ts';

/**
 * P3-L06 finals game decision (Finals Format v1 §"Game decision adapter", requirement 12.1, D-05).
 *
 * The platform never recomputes game rules: the pinned adapter either names the winner or returns an
 * ordered `scoreBreakdown`, and the locked qualification seed is the final fallback. Because that
 * ordinal order is total, a finals game always has exactly one winner.
 */

export type FinalsCriterionDirection = 'HIGHER_WINS' | 'LOWER_WINS';

/** One ordered tie-break criterion produced by the pinned game adapter. */
export interface FinalsCriterionValue {
  readonly criterionId: string;
  readonly direction: FinalsCriterionDirection;
  readonly home: number;
  readonly away: number;
}

/** The adapter result for one game: a direct winner, or an ordered breakdown. */
export interface FinalsGameAdapterResult {
  readonly directWinner?: 'HOME' | 'AWAY' | null;
  readonly scoreBreakdown?: readonly FinalsCriterionValue[];
}

export interface FinalsScoringContext {
  readonly adapterId: string;
  readonly adapterVersion: string;
  /** Identity pinned by the locked `FinalsRuleSet`; a different version is refused. */
  readonly pinnedAdapterId: string;
  readonly pinnedAdapterVersion: string;
  /** Locked ordinals; the better (smaller) ordinal is the final fallback. */
  readonly homeSeed: number;
  readonly awaySeed: number;
}

export type FinalsDecisionBasis = 'DIRECT' | 'CRITERION' | 'QUALIFICATION_SEED';

export interface FinalsGameDecision {
  readonly winner: 'HOME' | 'AWAY';
  readonly basis: FinalsDecisionBasis;
  readonly criterionId: string | null;
  /** Carried through for display only; the platform stores it and never recomputes game rules. */
  readonly breakdown: readonly FinalsCriterionValue[];
}

function checkPinnedAdapter(context: FinalsScoringContext): void {
  if (context.adapterId !== context.pinnedAdapterId || context.adapterVersion !== context.pinnedAdapterVersion) {
    throw new Error('FINALS_ADAPTER_VERSION_MISMATCH');
  }
}

function checkSeeds(context: FinalsScoringContext): void {
  if (!Number.isSafeInteger(context.homeSeed) || !Number.isSafeInteger(context.awaySeed)) {
    throw new Error('FINALS_SEED_INVALID');
  }
  if (context.homeSeed === context.awaySeed) throw new Error('FINALS_SEED_INVALID');
}

/**
 * Resolves exactly one winner: direct winner → ordered adapter criteria → better qualification seed.
 * The returned `basis` records which step decided the game so the bracket UI can explain it.
 */
export function decideFinalsGame(
  result: FinalsGameAdapterResult,
  context: FinalsScoringContext,
): FinalsGameDecision {
  checkPinnedAdapter(context);
  checkSeeds(context);

  const breakdown = result.scoreBreakdown ?? [];
  const seen = new Set<string>();
  for (const criterion of breakdown) {
    if (typeof criterion.criterionId !== 'string' || criterion.criterionId.length === 0) {
      throw new Error('FINALS_CRITERION_INVALID');
    }
    if (seen.has(criterion.criterionId)) throw new Error('FINALS_CRITERION_DUPLICATE');
    seen.add(criterion.criterionId);
    if (!Number.isFinite(criterion.home) || !Number.isFinite(criterion.away)) {
      throw new Error('FINALS_CRITERION_INVALID');
    }
  }

  if (result.directWinner === 'HOME' || result.directWinner === 'AWAY') {
    return Object.freeze({
      winner: result.directWinner,
      basis: 'DIRECT' as const,
      criterionId: null,
      breakdown: Object.freeze([...breakdown]),
    });
  }

  for (const criterion of breakdown) {
    const higherHome = criterion.home > criterion.away;
    const higherAway = criterion.away > criterion.home;
    if (!higherHome && !higherAway) continue;
    const homeWins = criterion.direction === 'HIGHER_WINS' ? higherHome : higherAway;
    return Object.freeze({
      winner: homeWins ? ('HOME' as const) : ('AWAY' as const),
      basis: 'CRITERION' as const,
      criterionId: criterion.criterionId,
      breakdown: Object.freeze([...breakdown]),
    });
  }

  return Object.freeze({
    winner: context.homeSeed < context.awaySeed ? ('HOME' as const) : ('AWAY' as const),
    basis: 'QUALIFICATION_SEED' as const,
    criterionId: null,
    breakdown: Object.freeze([...breakdown]),
  });
}

export interface FinalsSeriesOutcome {
  readonly state: 'PENDING' | 'FINALIZED';
  readonly winner: 'HOME' | 'AWAY' | null;
  readonly homeGames: number;
  readonly awayGames: number;
}

/**
 * BO3 series: the first side to two game wins takes the pairing (requirement 12). A game reported
 * after the series is already decided is refused rather than silently counted.
 */
export function scoreFinalsSeries(
  games: readonly ('HOME' | 'AWAY')[],
  options: { readonly bestOf?: number } = {},
): FinalsSeriesOutcome {
  const bestOf = options.bestOf ?? FINALS_BEST_OF;
  if (bestOf !== FINALS_BEST_OF) throw new Error('FINALS_BEST_OF_INVALID');
  const required = Math.floor(bestOf / 2) + 1;
  const homeGames = games.filter((winner) => winner === 'HOME').length;
  const awayGames = games.filter((winner) => winner === 'AWAY').length;
  // A BO3 stops as soon as one side reaches two wins, so a third win or a fourth game is refused.
  if (games.length > bestOf || homeGames > required || awayGames > required) {
    throw new Error('FINALS_SERIES_EXTRA_GAME');
  }

  const decided = homeGames >= required ? 'HOME' : awayGames >= required ? 'AWAY' : null;
  return Object.freeze({
    state: decided === null ? ('PENDING' as const) : ('FINALIZED' as const),
    winner: decided,
    homeGames,
    awayGames,
  });
}
