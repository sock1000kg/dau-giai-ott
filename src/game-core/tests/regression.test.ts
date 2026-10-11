import { describe, expect, it } from 'vitest';

import {
  applyAction,
  createGame,
  DEFAULT_MAP,
  getGameResult,
  hashGameState,
  listLegalActions,
  skipTurn,
  type GameAction,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Piece,
  type PieceType,
  type PlayerSide,
} from '../src/index.ts';

const CONFIG: GameConfig = {
  gameId: 'g-l08',
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
    gameId: 'g-l08',
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

describe('P1-L08 regression: spawn', () => {
  it('places 18 pieces, leaves both goals empty and puts X to move', () => {
    const state = createGame(CONFIG);
    expect(state.status).toBe('PLAYING');
    expect(state.turn).toBe('X');
    expect(state.pieces).toHaveLength(18);
    expect(state.pieces.filter((piece) => piece.owner === 'X')).toHaveLength(9);
    expect(state.pieces.filter((piece) => piece.owner === 'O')).toHaveLength(9);
    for (const type of ['ROCK', 'PAPER', 'SCISSORS'] as const) {
      expect(state.pieces.filter((piece) => piece.owner === 'X' && piece.type === type)).toHaveLength(3);
      expect(state.pieces.filter((piece) => piece.owner === 'O' && piece.type === type)).toHaveLength(3);
    }
    expect(state.pieces.some((piece) => piece.position.col === 8 && piece.position.row === 8)).toBe(false);
    expect(state.pieces.some((piece) => piece.position.col === 0 && piece.position.row === 0)).toBe(false);
    expect(createGame(CONFIG)).toEqual(state);
  });
});

describe('P1-L08 regression: movement, combat and win', () => {
  it('computes the initial legal actions deterministically', () => {
    const actions = listLegalActions(createGame(CONFIG), 'X');
    expect(actions.filter((action) => action.pieceId === 'X-ROCK-1')).toEqual([
      { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } },
      { pieceId: 'X-ROCK-1', to: { col: 1, row: 4 } },
    ]);
  });

  it('moves, then captures a weaker defender to eliminate a lone opponent', () => {
    const moved = applyAction(createGame(CONFIG), 'X', { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.state.turn).toBe('O');

    const capture = applyAction(
      scenario('X', [makePiece('X-ROCK-1', 'X', 'ROCK', 4, 4), makePiece('O-SCISSORS-1', 'O', 'SCISSORS', 5, 4)]),
      'X',
      { pieceId: 'X-ROCK-1', to: { col: 5, row: 4 } },
    );
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    expect(capture.state.pieces).toHaveLength(1);
    expect(capture.state.outcome?.reason).toBe('ELIMINATED_ALL_PIECES');
  });

  it('wins by reaching the opposite goal and exposes a hashed result', () => {
    const result = applyAction(
      scenario('X', [makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8), makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8)]),
      'X',
      { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.outcome).toMatchObject({ winnerSide: 'X', reason: 'REACHED_GOAL' });
    expect(getGameResult(result.state)?.finalStateHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('P1-L08 regression: skip and turn limit', () => {
  it('skips a turn and ends in a draw at the turn limit', () => {
    const skipped = skipTurn(createGame(CONFIG), 'X', 'NO_LEGAL_ACTION');
    expect(skipped.ok).toBe(true);
    if (skipped.ok) expect(skipped.state.turn).toBe('O');

    const limit = skipTurn(
      scenario('X', [makePiece('X-ROCK-1', 'X', 'ROCK', 0, 0), makePiece('O-ROCK-1', 'O', 'ROCK', 8, 8)], 1),
      'X',
      'BOT_TIMEOUT',
    );
    expect(limit.ok).toBe(true);
    if (!limit.ok) return;
    expect(limit.state.outcome).toEqual({
      winnerSide: null,
      reason: 'TURN_LIMIT',
      turnCount: 1,
      forfeitedSide: null,
    });
  });
});

describe('P1-L08 regression: replay', () => {
  it('replays the same script to the same state, events and hash', () => {
    const steps: readonly GameAction[] = [
      { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } },
      { pieceId: 'O-ROCK-1', to: { col: 8, row: 4 } },
      { pieceId: 'X-ROCK-2', to: { col: 0, row: 3 } },
    ];
    const run = (): { readonly state: GameState; readonly events: GameEvent[] } => {
      let current = createGame(CONFIG);
      const events: GameEvent[] = [];
      for (const step of steps) {
        const result = applyAction(current, current.turn, step);
        if (!result.ok) throw new Error(`unexpected rejection: ${result.code}`);
        events.push(...result.events);
        current = result.state;
      }
      return { state: current, events };
    };

    const first = run();
    const second = run();
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    expect(hashGameState(second.state)).toBe(hashGameState(first.state));
  });
});
