export const DEFAULT_GATE_BOT_ID = 'capture_first_bot';
export const GATE_PASS_POINTS = 1;

export type GateSide = 'X' | 'O';

/** One of the two gate games as seen from the submission under test. */
export type GateGameInput =
  | { readonly state: 'FINALIZED'; readonly submissionSide: GateSide; readonly winnerSide: GateSide | null }
  | { readonly state: 'PENDING' | 'INFRA_FAILED' | 'CANCELLED'; readonly submissionSide: GateSide };

export type GateEvaluation =
  | { readonly state: 'PENDING'; readonly reason: 'GATE_PENDING' }
  | {
    readonly state: 'DECIDED';
    readonly game1Points: number;
    readonly game2Points: number;
    readonly points: number;
    readonly outcome: 'PASS' | 'FAIL';
  };

export class GateError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'GateError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function gamePoints(game: Extract<GateGameInput, { state: 'FINALIZED' }>): number {
  if (game.winnerSide === null) return 0.5;
  return game.winnerSide === game.submissionSide ? 1 : 0;
}

/**
 * Pure decision: win 1 / draw 0.5 / loss 0 per game, PASS iff total >= 1. The games must be side-swapped.
 * A game that is not finalized (infra failure, cancellation, still queued) yields no result — never a FAIL.
 */
export function evaluateGate(game1: GateGameInput, game2: GateGameInput): GateEvaluation {
  if (game1.submissionSide === game2.submissionSide) {
    throw new GateError(422, 'GATE_SIDES_NOT_SWAPPED', 'Gate games must be played once as X and once as O');
  }
  if (game1.state !== 'FINALIZED' || game2.state !== 'FINALIZED') return { state: 'PENDING', reason: 'GATE_PENDING' };
  const game1Points = gamePoints(game1);
  const game2Points = gamePoints(game2);
  const points = game1Points + game2Points;
  return { state: 'DECIDED', game1Points, game2Points, points, outcome: points >= GATE_PASS_POINTS ? 'PASS' : 'FAIL' };
}
