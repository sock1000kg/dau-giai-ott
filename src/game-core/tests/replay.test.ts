import { describe, expect, it } from 'vitest';

import {
  applyAction,
  canonicalSerialize,
  createGame,
  DEFAULT_MAP,
  forfeitGame,
  hashGameState,
  isReplaySafeEvent,
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
  gameId: 'g-l07',
  engineVersion: '1.0.0',
  map: DEFAULT_MAP,
  maxTurns: 200,
};

const SCRIPT: readonly { readonly side: PlayerSide; readonly action: GameAction }[] = [
  { side: 'X', action: { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } } },
  { side: 'O', action: { pieceId: 'O-ROCK-1', to: { col: 8, row: 4 } } },
];

function makePiece(id: string, owner: PlayerSide, type: PieceType, col: number, row: number): Piece {
  return { id, owner, type, position: { col, row } };
}

function scenario(turn: PlayerSide, pieces: readonly Piece[], maxTurns = 200): GameState {
  return {
    schemaVersion: 1,
    engineVersion: '1.0.0',
    gameId: 'g-l07',
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

function play(start: GameState): { readonly state: GameState; readonly events: GameEvent[] } {
  let current = start;
  const events: GameEvent[] = [];
  for (const step of SCRIPT) {
    const result = applyAction(current, step.side, step.action);
    if (!result.ok) throw new Error(`unexpected rejection: ${result.code}`);
    events.push(...result.events);
    current = result.state;
  }
  return { state: current, events };
}

describe('P1-L07 canonical serialization', () => {
  it('sorts object keys and emits no insignificant whitespace', () => {
    expect(canonicalSerialize({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(canonicalSerialize(null)).toBe('null');
    expect(canonicalSerialize(true)).toBe('true');
    expect(canonicalSerialize('x')).toBe('"x"');
  });

  it('hashes equal rule-states equally, regardless of piece order or gameId', () => {
    const state = createGame(CONFIG);
    const reordered: GameState = { ...state, pieces: [...state.pieces].reverse() };
    expect(hashGameState(reordered)).toBe(hashGameState(state));

    const otherGameId = createGame({ ...CONFIG, gameId: 'g-l07-other' });
    expect(hashGameState(otherGameId)).toBe(hashGameState(state));
  });

  it('produces lowercase SHA-256 hex and changes when the rule-state changes', () => {
    const start = createGame(CONFIG);
    expect(hashGameState(start)).toMatch(/^[a-f0-9]{64}$/);

    const moved = applyAction(start, 'X', { pieceId: 'X-ROCK-1', to: { col: 0, row: 4 } });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(hashGameState(moved.state)).not.toBe(hashGameState(start));
  });
});
describe('P1-L07 transition events', () => {
  it('emits deterministic, replay-safe ACTION_APPLIED events', () => {
    const first = play(createGame(CONFIG));
    const second = play(createGame(CONFIG));
    expect(first.events).toEqual(second.events);
    expect(first.events.map((event) => event.type)).toEqual(['ACTION_APPLIED', 'ACTION_APPLIED']);
    expect(first.events.map((event) => event.sequence)).toEqual([0, 2]);
    for (const event of first.events) expect(isReplaySafeEvent(event)).toBe(true);
  });

  it('records TURN_SKIPPED with its reason and MATCH_FINISHED for a turn-limit draw', () => {
    const state = scenario(
      'X',
      [makePiece('X-ROCK-1', 'X', 'ROCK', 0, 0), makePiece('O-ROCK-1', 'O', 'ROCK', 8, 8)],
      1,
    );
    const result = skipTurn(state, 'X', 'NO_LEGAL_ACTION');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((event) => event.type)).toEqual(['TURN_SKIPPED', 'MATCH_FINISHED']);
    expect(result.events[0]).toMatchObject({
      type: 'TURN_SKIPPED',
      side: 'X',
      action: null,
      reason: 'NO_LEGAL_ACTION',
      revision: 1,
      turnId: 1,
    });
    expect(result.events[1]).toMatchObject({ type: 'MATCH_FINISHED', reason: 'TURN_LIMIT' });
    expect(result.result).toMatchObject({ winnerSide: null, reason: 'TURN_LIMIT' });
    for (const event of result.events) expect(isReplaySafeEvent(event)).toBe(true);
  });

  it('emits MATCH_FINISHED and a hashed result on a winning action', () => {
    const state = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    const result = applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map((event) => event.type)).toEqual(['ACTION_APPLIED', 'MATCH_FINISHED']);
    expect(result.result).toMatchObject({ winnerSide: 'X', reason: 'REACHED_GOAL' });
    expect(result.result?.finalStateHash).toBe(hashGameState(result.state));
  });

  it('emits a single MATCH_FINISHED (FORFEIT) event on forfeit', () => {
    const result = forfeitGame(createGame(CONFIG), 'X', 'BOT_CRASHED');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'MATCH_FINISHED',
      side: 'X',
      reason: 'FORFEIT',
      revision: 1,
      turnId: 1,
    });
    expect(result.result).toMatchObject({ winnerSide: 'O', reason: 'FORFEIT', forfeitedSide: 'X' });
  });
});

describe('P1-L07 replay determinism', () => {
  it('replaying the same script yields the same state, events and hash', () => {
    const first = play(createGame(CONFIG));
    const second = play(createGame(CONFIG));
    expect(second.state).toEqual(first.state);
    expect(second.events).toEqual(first.events);
    expect(hashGameState(second.state)).toBe(hashGameState(first.state));
  });

  it('never emits timestamps, randomness or process metadata', () => {
    const { events } = play(createGame(CONFIG));
    expect(JSON.stringify(events)).not.toMatch(/time|timestamp|date|random|nonce|pid/i);
  });
});
