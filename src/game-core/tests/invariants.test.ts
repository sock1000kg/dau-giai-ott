import { describe, expect, it } from 'vitest';

import {
  applyAction,
  canonicalSerialize,
  createGame,
  DEFAULT_MAP,
  forfeitGame,
  getGameResult,
  hashGameState,
  listLegalActions,
  skipTurn,
  type GameConfig,
  type GameState,
} from '../src/index.ts';

const CONFIG: GameConfig = {
  gameId: 'g-l08-inv',
  engineVersion: '1.0.0',
  map: DEFAULT_MAP,
  maxTurns: 200,
};

function snapshot(state: GameState): string {
  return JSON.stringify(state);
}

function sortedActions(state: GameState, side: 'X' | 'O'): readonly { pieceId: string; to: { col: number; row: number } }[] {
  return [...listLegalActions(state, side)].sort((a, b) => {
    if (a.pieceId !== b.pieceId) return a.pieceId < b.pieceId ? -1 : 1;
    if (a.to.row !== b.to.row) return a.to.row - b.to.row;
    return a.to.col - b.to.col;
  });
}

describe('P1-L08 invariants: purity and ordering', () => {
  it('never mutates its input for any public API', () => {
    const state = createGame(CONFIG);
    const before = snapshot(state);

    const legal = listLegalActions(state, 'X');
    expect(legal.length).toBeGreaterThan(0);
    expect(legal).toEqual(sortedActions(state, 'X'));

    const [first] = legal;
    if (first !== undefined) applyAction(state, 'X', first);
    applyAction(state, 'X', { pieceId: 'does-not-exist', to: { col: 0, row: 0 } });
    skipTurn(state, 'X', 'BOT_TIMEOUT');
    forfeitGame(state, 'X', 'BOT_CRASHED');
    getGameResult(state);
    hashGameState(state);

    expect(snapshot(state)).toBe(before);
  });

  it('keeps pieces sorted by id and counters monotonic after each transition', () => {
    let state = createGame(CONFIG);
    for (let ply = 0; ply < 4; ply += 1) {
      const [action] = listLegalActions(state, state.turn);
      expect(action).toBeDefined();
      if (action === undefined) return;

      const result = applyAction(state, state.turn, action);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const ids = result.state.pieces.map((piece) => piece.id);
      expect(ids).toEqual([...ids].sort());
      expect(result.state.revision).toBe(state.revision + 1);
      expect(result.state.turnCount).toBe(state.turnCount + 1);
      state = result.state;
    }
  });

  it('is deterministic and returns no actions for the side not to move', () => {
    const state = createGame(CONFIG);
    const [action] = listLegalActions(state, 'X');
    expect(action).toBeDefined();
    if (action === undefined) return;
    expect(applyAction(state, 'X', action)).toEqual(applyAction(state, 'X', action));
    expect(hashGameState(state)).toBe(hashGameState(createGame(CONFIG)));
    expect(listLegalActions(state, 'O')).toEqual([]);
  });
});

describe('P1-L08 invariants: canonical serialization', () => {
  it('handles every supported value shape', () => {
    expect(canonicalSerialize({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalSerialize([1, 'two', false, null])).toBe('[1,"two",false,null]');
    expect(canonicalSerialize({ nested: { z: 1, a: 2 } })).toBe('{"nested":{"a":2,"z":1}}');
    expect(canonicalSerialize(0)).toBe('0');
    expect(canonicalSerialize(-1.5)).toBe('-1.5');
  });

  it('rejects values it cannot canonicalize', () => {
    expect(() => canonicalSerialize(() => 1)).toThrow();
    expect(() => canonicalSerialize(Symbol('x'))).toThrow();
  });

  it('hashes independently of piece order and match id', () => {
    const state = createGame(CONFIG);
    const reordered: GameState = { ...state, pieces: [...state.pieces].reverse() };
    expect(hashGameState(reordered)).toBe(hashGameState(state));
    expect(hashGameState(createGame({ ...CONFIG, gameId: 'other' }))).toBe(hashGameState(state));
  });
});
