import { describe, expect, it } from 'vitest';

import {
  applyMove,
  createInitialGame,
  getLegalMoves,
  type BaselineState,
  type Piece,
  type PieceType,
  type PlayerSide,
  type Position,
} from '../src/index.ts';

function makePiece(id: string, owner: PlayerSide, type: PieceType, col: number, row: number): Piece {
  return { id, owner, type, position: { col, row } };
}

function findPiece(state: BaselineState, id: string): Piece | undefined {
  return state.pieces.find((candidate) => candidate.id === id);
}

function scenario(turn: PlayerSide, pieces: readonly Piece[]): BaselineState {
  const sorted = [...pieces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { status: 'PLAYING', turn, pieces: sorted, outcome: null };
}

describe('P1-L01 baseline: spawn', () => {
  it('creates the documented initial state: X to move, 18 pieces, no outcome', () => {
    const game = createInitialGame();
    expect(game.status).toBe('PLAYING');
    expect(game.turn).toBe('X');
    expect(game.outcome).toBeNull();
    expect(game.pieces).toHaveLength(18);
    expect(game.pieces.filter((piece) => piece.owner === 'X')).toHaveLength(9);
    expect(game.pieces.filter((piece) => piece.owner === 'O')).toHaveLength(9);
    for (const type of ['ROCK', 'PAPER', 'SCISSORS'] as const) {
      expect(game.pieces.filter((piece) => piece.owner === 'X' && piece.type === type)).toHaveLength(3);
      expect(game.pieces.filter((piece) => piece.owner === 'O' && piece.type === type)).toHaveLength(3);
    }
  });

  it('places every piece at the documented coordinate (spec 6.2 / locked fixture)', () => {
    const game = createInitialGame();
    const expected: ReadonlyArray<readonly [string, Position]> = [
      ['X-ROCK-1', { col: 0, row: 3 }],
      ['X-ROCK-2', { col: 1, row: 2 }],
      ['X-ROCK-3', { col: 2, row: 1 }],
      ['X-PAPER-1', { col: 1, row: 3 }],
      ['X-PAPER-2', { col: 2, row: 2 }],
      ['X-PAPER-3', { col: 3, row: 1 }],
      ['X-SCISSORS-1', { col: 0, row: 2 }],
      ['X-SCISSORS-2', { col: 1, row: 1 }],
      ['X-SCISSORS-3', { col: 2, row: 0 }],
      ['O-ROCK-1', { col: 8, row: 5 }],
      ['O-ROCK-2', { col: 7, row: 6 }],
      ['O-ROCK-3', { col: 6, row: 7 }],
      ['O-PAPER-1', { col: 7, row: 5 }],
      ['O-PAPER-2', { col: 6, row: 6 }],
      ['O-PAPER-3', { col: 5, row: 7 }],
      ['O-SCISSORS-1', { col: 8, row: 6 }],
      ['O-SCISSORS-2', { col: 7, row: 7 }],
      ['O-SCISSORS-3', { col: 6, row: 8 }],
    ];
    for (const [id, position] of expected) {
      expect(findPiece(game, id)?.position, id).toEqual(position);
    }
    // Both goal squares are empty at the start.
    expect(game.pieces.some((piece) => piece.position.col === 8 && piece.position.row === 8)).toBe(false);
    expect(game.pieces.some((piece) => piece.position.col === 0 && piece.position.row === 0)).toBe(false);
  });

  it('keeps pieces sorted by id and deep-copies spawns between games', () => {
    const first = createInitialGame();
    const second = createInitialGame();
    const ids = first.pieces.map((piece) => piece.id);
    expect(ids).toEqual([...ids].sort());
    expect(first.pieces).not.toBe(second.pieces);
    expect(first.pieces[0]).not.toBe(second.pieces[0]);
    expect(first).toEqual(second);
  });
});
describe('P1-L01 baseline: movement', () => {
  it('lists legal moves deterministically ordered by row then col', () => {
    const game = createInitialGame();
    expect(getLegalMoves(game, 'X-ROCK-1')).toEqual([
      { col: 0, row: 4 },
      { col: 1, row: 4 },
    ]);
    // X-SCISSORS-3 sits at c1; own pieces at b2/c2/d2 block three of its moves.
    expect(getLegalMoves(game, 'X-SCISSORS-3')).toEqual([
      { col: 1, row: 0 },
      { col: 3, row: 0 },
    ]);
  });

  it('applies a legal move, advances the turn and never mutates the input', () => {
    const game = createInitialGame();
    const snapshot = JSON.parse(JSON.stringify(game)) as BaselineState;
    const result = applyMove(game, 'X', 'X-ROCK-1', { col: 0, row: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findPiece(result.state, 'X-ROCK-1')?.position).toEqual({ col: 0, row: 4 });
    expect(result.state.turn).toBe('O');
    expect(result.state.pieces).toHaveLength(18);
    expect(result.state).not.toBe(game);
    expect(game).toEqual(snapshot);
  });

  it('rejects invalid moves with stable codes and returns the same state', () => {
    const game = createInitialGame();

    const notYourTurn = applyMove(game, 'O', 'O-ROCK-1', { col: 7, row: 5 });
    expect(notYourTurn).toMatchObject({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(notYourTurn.state).toBe(game);

    const notYourPiece = applyMove(game, 'X', 'O-ROCK-1', { col: 7, row: 5 });
    expect(notYourPiece).toMatchObject({ ok: false, error: 'NOT_YOUR_PIECE' });

    const notFound = applyMove(game, 'X', 'X-ROCK-9', { col: 0, row: 4 });
    expect(notFound).toMatchObject({ ok: false, error: 'PIECE_NOT_FOUND' });

    const illegal = applyMove(game, 'X', 'X-ROCK-1', { col: 5, row: 5 });
    expect(illegal).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(illegal.state).toBe(game);
  });
});

describe('P1-L01 baseline: combat', () => {
  it('captures a weaker defender and removes it from the board', () => {
    const game = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 4, 4),
      makePiece('O-SCISSORS-1', 'O', 'SCISSORS', 5, 4),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    expect(getLegalMoves(game, 'X-ROCK-1')).toContainEqual({ col: 5, row: 4 });

    const result = applyMove(game, 'X', 'X-ROCK-1', { col: 5, row: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findPiece(result.state, 'O-SCISSORS-1')).toBeUndefined();
    expect(findPiece(result.state, 'X-ROCK-1')?.position).toEqual({ col: 5, row: 4 });
    expect(result.state.pieces).toHaveLength(2);
    expect(result.state.turn).toBe('O');
  });

  it('blocks equal types and forbids attacking a stronger type', () => {
    const equal = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 4, 4),
      makePiece('O-ROCK-1', 'O', 'ROCK', 5, 4),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    expect(getLegalMoves(equal, 'X-ROCK-1')).not.toContainEqual({ col: 5, row: 4 });

    const weaker = scenario('X', [
      makePiece('X-SCISSORS-1', 'X', 'SCISSORS', 4, 4),
      makePiece('O-ROCK-1', 'O', 'ROCK', 5, 4),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    const attack = applyMove(weaker, 'X', 'X-SCISSORS-1', { col: 5, row: 4 });
    expect(attack).toMatchObject({ ok: false, error: 'ILLEGAL_MOVE' });
    expect(attack.state).toBe(weaker);
  });
});

describe('P1-L01 baseline: win conditions', () => {
  it('wins with REACHED_GOAL when a piece reaches the opposite goal', () => {
    const game = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    const result = applyMove(game, 'X', 'X-ROCK-1', { col: 8, row: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('FINISHED');
    expect(result.state.outcome).toEqual({ winnerSide: 'X', reason: 'REACHED_GOAL' });
    expect(result.state.turn).toBe('X');
  });

  it('wins with ELIMINATED_ALL_PIECES when the opponent has no pieces left', () => {
    const game = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 4, 4),
      makePiece('O-SCISSORS-1', 'O', 'SCISSORS', 5, 4),
    ]);
    const result = applyMove(game, 'X', 'X-ROCK-1', { col: 5, row: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('FINISHED');
    expect(result.state.outcome).toEqual({ winnerSide: 'X', reason: 'ELIMINATED_ALL_PIECES' });
  });

  it('prefers REACHED_GOAL when one move both reaches the goal and clears the board', () => {
    const game = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8),
      makePiece('O-SCISSORS-1', 'O', 'SCISSORS', 8, 8),
    ]);
    const result = applyMove(game, 'X', 'X-ROCK-1', { col: 8, row: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.outcome).toEqual({ winnerSide: 'X', reason: 'REACHED_GOAL' });
  });

  it('rejects moves after the game has finished', () => {
    const finished: BaselineState = {
      status: 'FINISHED',
      turn: 'X',
      pieces: [makePiece('X-ROCK-1', 'X', 'ROCK', 8, 8), makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8)],
      outcome: { winnerSide: 'X', reason: 'REACHED_GOAL' },
    };
    const result = applyMove(finished, 'X', 'X-ROCK-1', { col: 7, row: 8 });
    expect(result).toMatchObject({ ok: false, error: 'GAME_NOT_PLAYING' });
    expect(result.state).toBe(finished);
  });
});
