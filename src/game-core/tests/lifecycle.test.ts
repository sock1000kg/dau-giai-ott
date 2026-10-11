import { describe, expect, it } from 'vitest';

import {
  applyAction,
  createGame,
  DEFAULT_MAP,
  forfeitGame,
  getGameResult,
  hashGameState,
  skipTurn,
  type GameConfig,
  type GameState,
  type Piece,
  type PieceType,
  type PlayerSide,
} from '../src/index.ts';

const CONFIG: GameConfig = {
  gameId: 'g-l06',
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
    gameId: 'g-l06',
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

function finished(state: GameState): GameState {
  return {
    ...state,
    status: 'FINISHED',
    outcome: { winnerSide: 'X', reason: 'REACHED_GOAL', turnCount: 1, forfeitedSide: null },
  };
}

describe('P1-L06 skipTurn', () => {
  it('advances turnCount/revision, switches side and leaves the board unchanged', () => {
    const state = createGame(CONFIG);
    const board = state.pieces;
    const result = skipTurn(state, 'X', 'BOT_TIMEOUT');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.turn).toBe('O');
    expect(result.state.turnCount).toBe(1);
    expect(result.state.turnNumber).toBe(2);
    expect(result.state.revision).toBe(1);
    expect(result.state.status).toBe('PLAYING');
    expect(result.state.outcome).toBeNull();
    expect(result.state.pieces).toBe(board);
  });

  it('rejects a skip from the wrong side or once the match is over', () => {
    const state = createGame(CONFIG);
    expect(skipTurn(state, 'O', 'BOT_TIMEOUT')).toEqual({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(skipTurn(finished(state), 'X', 'BOT_TIMEOUT')).toEqual({ ok: false, code: 'GAME_NOT_PLAYING' });
  });

  it('ends in a TURN_LIMIT draw once maxTurns is reached', () => {
    const state = scenario(
      'X',
      [makePiece('X-ROCK-1', 'X', 'ROCK', 0, 0), makePiece('O-ROCK-1', 'O', 'ROCK', 8, 8)],
      1,
    );
    const result = skipTurn(state, 'X', 'NO_LEGAL_ACTION');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('FINISHED');
    expect(result.state.outcome).toEqual({
      winnerSide: null,
      reason: 'TURN_LIMIT',
      turnCount: 1,
      forfeitedSide: null,
    });
    expect(skipTurn(result.state, 'X', 'BOT_TIMEOUT')).toEqual({ ok: false, code: 'GAME_NOT_PLAYING' });
  });
});

describe('P1-L06 forfeitGame', () => {
  it('awards the opponent the win and does not complete the turn', () => {
    const state = createGame(CONFIG);
    const result = forfeitGame(state, 'X', 'BOT_CRASHED');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe('FINISHED');
    expect(result.state.turnCount).toBe(0);
    expect(result.state.turnNumber).toBe(1);
    expect(result.state.revision).toBe(1);
    expect(result.state.outcome).toEqual({
      winnerSide: 'O',
      reason: 'FORFEIT',
      turnCount: 0,
      forfeitedSide: 'X',
    });
  });

  it('rejects a forfeit once the match is over', () => {
    const state = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    const won = applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } });
    expect(won.ok).toBe(true);
    if (!won.ok) return;
    expect(forfeitGame(won.state, 'O', 'BOT_EOF')).toEqual({ ok: false, code: 'GAME_NOT_PLAYING' });
  });
});

describe('P1-L06 getGameResult', () => {
  it('is null while playing and carries winner/reason/hash when finished', () => {
    expect(getGameResult(createGame(CONFIG))).toBeNull();

    const state = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    const result = applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const gameResult = getGameResult(result.state);
    expect(gameResult).toMatchObject({
      winnerSide: 'X',
      reason: 'REACHED_GOAL',
      turnCount: 1,
      forfeitedSide: null,
    });
    expect(gameResult?.finalStateHash).toBe(hashGameState(result.state));
    expect(gameResult?.finalStateHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reports a draw with a stable reason', () => {
    const state = scenario(
      'X',
      [makePiece('X-ROCK-1', 'X', 'ROCK', 0, 0), makePiece('O-ROCK-1', 'O', 'ROCK', 8, 8)],
      1,
    );
    const skipped = skipTurn(state, 'X', 'NO_LEGAL_ACTION');
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(getGameResult(skipped.state)).toMatchObject({ winnerSide: null, reason: 'TURN_LIMIT' });
  });

  it('rejects any further action once the match has ended', () => {
    const state = scenario('X', [
      makePiece('X-ROCK-1', 'X', 'ROCK', 7, 8),
      makePiece('O-PAPER-1', 'O', 'PAPER', 0, 8),
    ]);
    const won = applyAction(state, 'X', { pieceId: 'X-ROCK-1', to: { col: 8, row: 8 } });
    expect(won.ok).toBe(true);
    if (!won.ok) return;
    expect(applyAction(won.state, 'X', { pieceId: 'X-ROCK-1', to: { col: 7, row: 8 } })).toEqual({
      ok: false,
      code: 'GAME_NOT_PLAYING',
    });
  });
});
