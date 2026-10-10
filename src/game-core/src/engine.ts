/**
 * @ott/game-core — baseline game behavior (P1-L01).
 *
 * Rule source of truth: `docs/tai-lieu-yeu-cau.md` section 6 (`game-rules`).
 * Behavior reference: sock1000kg/rock-paper-scissor @
 *   2956f1601365274eb34d623a9c908900bf43baab
 * The reference commit has no verified LICENSE, so this module re-implements the
 * documented behavior only; no reference source is copied, vendored, submoduled
 * or packaged.
 *
 * Scope: the behavior baseline (spawn, move, combat, win). The locked Engine API
 * surface from `docs/contracts/engine-api-v1.md` (GameState, createGame,
 * listLegalActions, applyAction, skipTurn, forfeitGame, getGameResult,
 * hashGameState) is formalized in P1-L02 and later tasks.
 *
 * Purity: no process, timer, clock, environment, filesystem, network, random or
 * framework access; inputs are never mutated.
 */

import type {
  ActionErrorCode,
  GameConfig,
  GameState,
  MapDefinition,
  Piece,
  PieceType,
  PlayerSide,
  Position,
} from './types.ts';

export const BOARD_WIDTH = 9;
export const BOARD_HEIGHT = 9;
export const ENGINE_VERSION = '1.0.0';
export const DEFAULT_MAP_ID = 'default';
export const DEFAULT_MAP_VERSION = 1;
export const DEFAULT_MAP_CHECKSUM = 'a'.repeat(64);

/** Baseline win outcome (transitional; contract `GameOutcome` is used by `createGame`). */
export interface BaselineOutcome {
  readonly winnerSide: PlayerSide;
  readonly reason: 'REACHED_GOAL' | 'ELIMINATED_ALL_PIECES';
}

/**
 * Baseline rule-state from P1-L01. Kept so the baseline tests stay green while the
 * locked `GameState`/`createGame` land here (P1-L02) and `applyAction` plus the full
 * lifecycle land in P1-L05..P1-L07.
 */
export interface BaselineState {
  readonly status: 'PLAYING' | 'FINISHED';
  readonly turn: PlayerSide;
  readonly pieces: readonly Piece[];
  readonly outcome: BaselineOutcome | null;
}

export type MoveResult =
  | { readonly ok: true; readonly state: BaselineState }
  | { readonly ok: false; readonly state: BaselineState; readonly error: ActionErrorCode };

/** X races to i9; O races to a1. */
export const GOALS: Readonly<Record<PlayerSide, Position>> = {
  X: { col: 8, row: 8 },
  O: { col: 0, row: 0 },
};

/** Combat table: attacker type -> the type it defeats. */
export const BEATS: Readonly<Record<PieceType, PieceType>> = {
  ROCK: 'SCISSORS',
  PAPER: 'ROCK',
  SCISSORS: 'PAPER',
};

const DIRECTIONS: readonly { readonly dCol: number; readonly dRow: number }[] = [
  { dCol: -1, dRow: -1 },
  { dCol: 0, dRow: -1 },
  { dCol: 1, dRow: -1 },
  { dCol: -1, dRow: 0 },
  { dCol: 1, dRow: 0 },
  { dCol: -1, dRow: 1 },
  { dCol: 0, dRow: 1 },
  { dCol: 1, dRow: 1 },
];

interface SpawnEntry {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly type: PieceType;
  readonly position: Position;
}

// Spawn layout from `docs/tai-lieu-yeu-cau.md` 6.2 and the locked fixtures
// (`docs/contracts/fixtures/bot-protocol-v1-valid.ndjson`).
const SPAWN_LAYOUT: readonly SpawnEntry[] = [
  // X (Red): rock a4/b3/c2, paper b4/c3/d2, scissors a3/b2/c1
  { id: 'X-ROCK-1', owner: 'X', type: 'ROCK', position: { col: 0, row: 3 } },
  { id: 'X-ROCK-2', owner: 'X', type: 'ROCK', position: { col: 1, row: 2 } },
  { id: 'X-ROCK-3', owner: 'X', type: 'ROCK', position: { col: 2, row: 1 } },
  { id: 'X-PAPER-1', owner: 'X', type: 'PAPER', position: { col: 1, row: 3 } },
  { id: 'X-PAPER-2', owner: 'X', type: 'PAPER', position: { col: 2, row: 2 } },
  { id: 'X-PAPER-3', owner: 'X', type: 'PAPER', position: { col: 3, row: 1 } },
  { id: 'X-SCISSORS-1', owner: 'X', type: 'SCISSORS', position: { col: 0, row: 2 } },
  { id: 'X-SCISSORS-2', owner: 'X', type: 'SCISSORS', position: { col: 1, row: 1 } },
  { id: 'X-SCISSORS-3', owner: 'X', type: 'SCISSORS', position: { col: 2, row: 0 } },
  // O (Blue): rock i6/h7/g8, paper h6/g7/f8, scissors i7/h8/g9
  { id: 'O-ROCK-1', owner: 'O', type: 'ROCK', position: { col: 8, row: 5 } },
  { id: 'O-ROCK-2', owner: 'O', type: 'ROCK', position: { col: 7, row: 6 } },
  { id: 'O-ROCK-3', owner: 'O', type: 'ROCK', position: { col: 6, row: 7 } },
  { id: 'O-PAPER-1', owner: 'O', type: 'PAPER', position: { col: 7, row: 5 } },
  { id: 'O-PAPER-2', owner: 'O', type: 'PAPER', position: { col: 6, row: 6 } },
  { id: 'O-PAPER-3', owner: 'O', type: 'PAPER', position: { col: 5, row: 7 } },
  { id: 'O-SCISSORS-1', owner: 'O', type: 'SCISSORS', position: { col: 8, row: 6 } },
  { id: 'O-SCISSORS-2', owner: 'O', type: 'SCISSORS', position: { col: 7, row: 7 } },
  { id: 'O-SCISSORS-3', owner: 'O', type: 'SCISSORS', position: { col: 6, row: 8 } },
];

function clonePosition(position: Position): Position {
  return { col: position.col, row: position.row };
}

function clonePiece(piece: Piece): Piece {
  return { id: piece.id, owner: piece.owner, type: piece.type, position: clonePosition(piece.position) };
}

function opponent(side: PlayerSide): PlayerSide {
  return side === 'X' ? 'O' : 'X';
}

function inBounds(position: Position): boolean {
  return position.col >= 0 && position.col < BOARD_WIDTH && position.row >= 0 && position.row < BOARD_HEIGHT;
}

export function samePosition(a: Position, b: Position): boolean {
  return a.col === b.col && a.row === b.row;
}

function occupantAt(pieces: readonly Piece[], position: Position): Piece | undefined {
  return pieces.find((piece) => samePosition(piece.position, position));
}

function byId(a: Piece, b: Piece): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byRowThenCol(a: Position, b: Position): number {
  return a.row !== b.row ? a.row - b.row : a.col - b.col;
}

/** True when `attacker` defeats `defender` (Rock > Scissors > Paper > Rock). */
export function beats(attacker: PieceType, defender: PieceType): boolean {
  return BEATS[attacker] === defender;
}

/**
 * Locked default map for Phase 1: 9x9, no obstacles, 18 spawns, goals X->i9 / O->a1.
 * `createGame` deep-copies `spawns`, so callers may pass this object directly.
 */
export const DEFAULT_MAP: MapDefinition = {
  schemaVersion: 1,
  mapId: DEFAULT_MAP_ID,
  version: DEFAULT_MAP_VERSION,
  checksum: DEFAULT_MAP_CHECKSUM,
  width: 9,
  height: 9,
  obstacles: [],
  spawns: SPAWN_LAYOUT.map((entry) => clonePiece(entry)),
  goals: GOALS,
};

/**
 * Locked Engine API v1 constructor: deterministic initial `GameState` with deep-copied
 * spawns and `map` reduced to its `MapRef` projection. Never mutates `config`.
 * Counters start at turnNumber 1, turnCount 0, revision 0 (Engine API v1 section 5).
 */
export function createGame(config: GameConfig): GameState {
  const map = config.map;
  return {
    schemaVersion: 1,
    engineVersion: config.engineVersion,
    gameId: config.gameId,
    map: { mapId: map.mapId, version: map.version, checksum: map.checksum },
    status: 'PLAYING',
    turn: 'X',
    turnNumber: 1,
    turnCount: 0,
    revision: 0,
    maxTurns: config.maxTurns,
    pieces: map.spawns.map((entry) => clonePiece(entry)).sort(byId),
    outcome: null,
  };
}

/** Deterministic initial state: X to move, 18 deep-copied pieces, no outcome. */
export function createInitialGame(): BaselineState {
  return {
    status: 'PLAYING',
    turn: 'X',
    pieces: SPAWN_LAYOUT.map((entry) => clonePiece(entry)).sort(byId),
    outcome: null,
  };
}

/** Legal destination squares for one piece: 8 king moves, ordered by row then col. */
export function getLegalMoves(state: BaselineState, pieceId: string): readonly Position[] {
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (piece === undefined) return [];

  const destinations: Position[] = [];
  for (const direction of DIRECTIONS) {
    const to: Position = { col: piece.position.col + direction.dCol, row: piece.position.row + direction.dRow };
    if (!inBounds(to)) continue;
    const occupant = occupantAt(state.pieces, to);
    if (occupant !== undefined) {
      if (occupant.owner === piece.owner) continue; // own piece blocks
      if (!beats(piece.type, occupant.type)) continue; // equal or weaker -> blocked
    }
    destinations.push(to);
  }
  return destinations.sort(byRowThenCol);
}

function validateMove(state: BaselineState, side: PlayerSide, pieceId: string, to: Position): ActionErrorCode | null {
  if (state.status !== 'PLAYING') return 'GAME_NOT_PLAYING';
  if (state.turn !== side) return 'NOT_YOUR_TURN';
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (piece === undefined) return 'PIECE_NOT_FOUND';
  if (piece.owner !== side) return 'NOT_YOUR_PIECE';
  const isLegal = getLegalMoves(state, pieceId).some((candidate) => samePosition(candidate, to));
  return isLegal ? null : 'ILLEGAL_MOVE';
}

function resolveOutcome(pieces: readonly Piece[], side: PlayerSide): BaselineOutcome | null {
  const goal = GOALS[side];
  if (pieces.some((piece) => piece.owner === side && samePosition(piece.position, goal))) {
    return { winnerSide: side, reason: 'REACHED_GOAL' };
  }
  if (!pieces.some((piece) => piece.owner === opponent(side))) {
    return { winnerSide: side, reason: 'ELIMINATED_ALL_PIECES' };
  }
  return null;
}

/**
 * Apply one side's move. Never mutates `state`; a rejected move returns the same
 * state reference plus a stable error code (validation order per Engine API v1 §6).
 */
export function applyMove(state: BaselineState, side: PlayerSide, pieceId: string, to: Position): MoveResult {
  const error = validateMove(state, side, pieceId, to);
  if (error !== null) return { ok: false, state, error };

  const moving = state.pieces.find((candidate) => candidate.id === pieceId);
  if (moving === undefined) return { ok: false, state, error: 'PIECE_NOT_FOUND' };

  const survivors = state.pieces.filter(
    (candidate) => candidate.id !== pieceId && !samePosition(candidate.position, to),
  );
  const moved: Piece = { id: moving.id, owner: moving.owner, type: moving.type, position: clonePosition(to) };
  const pieces = [...survivors, moved].sort(byId);

  const outcome = resolveOutcome(pieces, side);
  if (outcome !== null) {
    return { ok: true, state: { status: 'FINISHED', turn: side, pieces, outcome } };
  }
  return { ok: true, state: { status: 'PLAYING', turn: opponent(side), pieces, outcome: null } };
}
