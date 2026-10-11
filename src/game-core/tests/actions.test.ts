import { describe, expect, it } from 'vitest';

import {
  applyAction,
  createGame,
  DEFAULT_MAP,
  listLegalActions,
  type GameAction,
  type GameConfig,
  type GameState,
  type Piece,
  type PieceType,
  type PlayerSide,
} from '../src/index.ts';

const CONFIG: GameConfig = {
  gameId: 'g-l05',
  engineVersion: '1.0.0',
  map: DEFAULT_MAP,
  maxTurns: 200,
};

function makePiece(id: string, owner: PlayerSide, type: PieceType, col: number, row: number): Piece {
  return { id, owner, type, position: { col, row } };
}

function scenario(turn: PlayerSide, pieces: readonly Piece[], maxTurns = 200): GameState {
  return {
    schemaVersion: 1,
    engineVersion: '1.0.0',
    gameId: 'g-l05',
    map: { mapId: 'default', version: 1, checksum: 'a'.repeat(64) },
    status: 'PLAYING',
    turn,
    turnNumber: 1,
    turnCount: 0,
    revision: 0,
    maxTurns,
    pieces: [...pieces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    outcome: null,
  };
}

function findPiece(state: GameState, id: string): Piece | undefined {
  return state.pieces.find((candidate) => candidate.id === id);
}

function sortedActions(actions: readonly GameAction[]): GameAction[] {
  return [...actions].sort((a, b) => {
    if (a.pieceId !== b.pieceId) return a.pieceId < b.pieceId ? -1 : 1;
    if (a.to.row !== b.to.row) return a.to.row - b.to.row;
    return a.to.col - b.to.col;
  });
}
describe('P1-L05 listLegalActions', () => {
  it('returns every legal action for the side to move, in deterministic order', () => {
    const state = createGame(CONFIG);
    const actions = listLegalActions(state, 'X');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions).toEqual(sortedActions(actions));
    expect(actions.filter((action) => action.pieceId === 'X-ROCK-1')).toEqual([
      { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } },
      { pieceId: 'X-ROCK-1', to: { col: 1, row: 4 } },
    ]);
  });

  it('is empty for the side that is not to move, and once the game is finished', () => {
    const state = createGame(CONFIG);
    expect(listLegalActions(state, 'O')).toEqual([]);
    const finished: GameState = {
      ...state,
      status: 'FINISHED',
      outcome: { winnerSide: 'X', reason: 'REACHED_GOAL', turnCount: 1, forfeitedSide: null },
    };
    expect(listLegalActions(finished, 'X')).toEqual([]);
  });
});

describe('P1-L05 applyAction transitions', () => {
  it('applies a legal action, advances counters and never mutates the input', () => {
    const state = createGame(CONFIG);
    const snapshot = JSON.parse(JSON.stringify(state)) as GameState;
    const result = applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findPiece(result.state, 'X-ROCK-1')?.position).toEqual({ col: 0, row: 4 });
    expect(result.state.turn).toBe('O');
    expect(result.state.turnCount).toBe(1);
    expect(result.state.turnNumber).toBe(2);
    expect(result.state.revision).toBe(1);
    expect(result.state.status).toBe('PLAYING');
    expect(result.state.pieces).toHaveLength(18);
    expect(result.events).toEqual([]);
    expect(result.result).toBeNull();
    expect(state).toEqual(snapshot);
  });

  it('is deterministic for the same input', () => {
    const state = createGame(CONFIG);
    const action = { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } };
    expect(applyAction(state, 'X', action)).toEqual(applyAction(state, 'X', action));
  });

  it('rejects invalid actions with the fixed precedence and no state change', () => {
    const state = createGame(CONFIG);
    const finished: GameState = {
      ...state,
      status: 'FINISHED',
      outcome: { winnerSide: 'X', reason: 'REACHED_GOAL', turnCount: 1, forfeitedSide: null },
    };

    expect(applyAction(finished, 'X', { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } })).toEqual({
      ok: false,
      code: 'GAME_NOT_PLAYING',
    });
    expect(applyAction(state, 'O', { pieceId: 'O-ROCK-1', to: { col: 8, row: 4 } })).toEqual({
      ok: false,
      code: 'NOT_YOUR_TURN',
    });
    expect(applyAction(state, 'X', { pieceId: 'X-ROCK-9', to: { col: 0, row: 4 } })).toEqual({
      ok: false,
      code: 'PIECE_NOT_FOUND',
    });
    expect(applyAction(state, 'X', { pieceId: 'O-ROCK-1', to: { col: 8, row: 4 } })).toEqual({
      ok: false,
      code: 'NOT_YOUR_PIECE',
    });
    expect(applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 5, row: 5 } })).toEqual({
      ok: false,
      code: 'ILLEGAL_MOVE',
    });
  });
});
describe('P1-L05 applyAction combat and win', () => {
  it('captures a weaker defender', () => {
    const state = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 4, 4),
      makePiece('O-SCISSORS-1', 'O', 'SCISSORS', 5, 4),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    const result = applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 5, row: 4 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(findPiece(result.state, 'O-SCISSORS-1')).toBeUndefined();
    expect(findPiece(result.state, 'X-ROCK-1')?.position).toEqual({ col: 5, row: 4 });
    expect(result.state.pieces).toHaveLength(2);
  });

  it('blocks equal types and forbids attacking a stronger type', () => {
    const equal = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 4, 4),
      makePiece('O-ROCK-1', 'O', 'ROCK', 5, 4),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    expect(applyAction(equal, 'X', { pieceId: 'X-ROCK-1', to: { col: 5, row: 4 } })).toEqual({
      ok: false,
      code: 'ILLEGAL_MOVE',
    });

    const weaker = scenario('X', [
      makePiece('X-SCISSORS-1', 'X', 'SCISSORS', 4, 4),
      makePiece('O-ROCK-1', 'O', 'ROCK', 5, 4),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    expect(applyAction(weaker, 'X', { pieceId: 'X-SCISSORS-1', to: { col: 5, row: 4 } })).toEqual({
      ok: false,
      code: 'ILLEGAL_MOVE',
    });
  });

  it('wins with REACHED_GOAL and keeps the acting side on move', () => {
    const state = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    const result = applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('FINISHED');
    expect(result.state.outcome).toEqual({
      winnerSide: 'X',
      reason: 'REACHED_GOAL',
      turnCount: 1,
      forfeitedSide: null,
    });
    expect(result.state.turn).toBe('X');
    expect(result.state.turnNumber).toBe(1);
    expect(result.state.turnCount).toBe(1);
    expect(result.state.revision).toBe(1);
  });

  it('wins with ELIMINATED_ALL_PIECES and prefers REACHED_GOAL when both hold', () => {
    const eliminated = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 4, 4),
      makePiece('O-SCISSORS-1', 'O', 'SCISSORS', 5, 4),
    ]);
    const first = applyAction(eliminated, 'X', { pieceId: 'X-ROCK-1', to: { col: 5, row: 4 } });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.state.outcome?.reason).toBe('ELIMINATED_ALL_PIECES');

    const both = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8),
      makePiece('O-SCISSORS-1', 'O', 'SCISSORS', 8, 8),
    ]);
    const second = applyAction(both, 'X', { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.state.outcome?.reason).toBe('REACHED_GOAL');
  });

  it('ends in a TURN_LIMIT draw when the turn budget is exhausted', () => {
    const state = scenario('X', [makePiece('X-ROCK-1', 'X', 'ROCK', 0, 0), makePiece('O-ROCK-1', 'O', 'ROCK', 8, 8)], 1);
    const result = applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 0, row: 1 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('FINISHED');
    expect(result.state.outcome).toEqual({
      winnerSide: null,
      reason: 'TURN_LIMIT',
      turnCount: 1,
      forfeitedSide: null,
    });
  });
});
