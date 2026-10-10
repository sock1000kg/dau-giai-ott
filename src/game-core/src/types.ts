/**
 * Locked Engine API v1 domain types — source of truth: `docs/contracts/engine-api-v1.md`
 * (sections 3 and 4). This file only declares types; behavior lives in `engine.ts`.
 *
 * Purity: type-only module. No runtime imports, no I/O, no framework.
 */

export type PlayerSide = 'X' | 'O';
export type PieceType = 'ROCK' | 'PAPER' | 'SCISSORS';
export type GameStatus = 'PLAYING' | 'FINISHED';

export interface Position {
  readonly col: number; // integer 0..8
  readonly row: number; // integer 0..8
}

export interface Piece {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly type: PieceType;
  readonly position: Position;
}

export interface MapRef {
  readonly mapId: string;
  readonly version: number;
  readonly checksum: string; // lowercase SHA-256 hex
}

export interface MapDefinition extends MapRef {
  readonly schemaVersion: 1;
  readonly width: 9;
  readonly height: 9;
  readonly obstacles: readonly Position[];
  readonly spawns: readonly Piece[];
  readonly goals: Readonly<Record<PlayerSide, Position>>;
}

export interface GameConfig {
  readonly gameId: string;
  readonly engineVersion: string;
  readonly map: MapDefinition;
  readonly maxTurns: number; // Phase 1 default: 200
}

export interface GameAction {
  readonly pieceId: string;
  readonly to: Position;
}

export type GameResultReason =
  | 'REACHED_GOAL'
  | 'ELIMINATED_ALL_PIECES'
  | 'FORFEIT'
  | 'TURN_LIMIT';

export interface GameOutcome {
  readonly winnerSide: PlayerSide | null;
  readonly reason: GameResultReason;
  readonly turnCount: number;
  readonly forfeitedSide: PlayerSide | null;
}

export interface GameResult extends GameOutcome {
  readonly finalStateHash: string;
}

export interface GameState {
  readonly schemaVersion: 1;
  readonly engineVersion: string;
  readonly gameId: string;
  readonly map: MapRef;
  readonly status: GameStatus;
  readonly turn: PlayerSide;
  readonly turnNumber: number;
  readonly turnCount: number;
  readonly revision: number;
  readonly maxTurns: number;
  readonly pieces: readonly Piece[];
  readonly outcome: GameOutcome | null;
}

/** First error returned by `applyAction` (Engine API v1 section 6). */
export type ActionErrorCode =
  | 'GAME_NOT_PLAYING'
  | 'NOT_YOUR_TURN'
  | 'PIECE_NOT_FOUND'
  | 'NOT_YOUR_PIECE'
  | 'ILLEGAL_MOVE';

/** Recoverable per-turn skip reasons (Bot Protocol v1 section 6). */
export type SkipReason =
  | 'NO_LEGAL_ACTION'
  | 'BOT_TIMEOUT'
  | 'MALFORMED_JSON'
  | 'SCHEMA_VIOLATION'
  | 'MATCH_ID_MISMATCH'
  | 'TURN_ID_MISMATCH'
  | 'MESSAGE_TOO_LARGE'
  | 'ILLEGAL_ACTION';

/** Immediate-forfeit process faults (Bot Protocol v1 section 6). */
export type ProcessFaultCode =
  | 'BOT_SPAWN_FAILED'
  | 'BOT_CRASHED'
  | 'BOT_EOF'
  | 'STDERR_LIMIT_EXCEEDED'
  | 'RESOURCE_LIMIT_EXCEEDED'
  | 'SANDBOX_VIOLATION';

export type GameEventType = 'ACTION_APPLIED' | 'TURN_SKIPPED' | 'MATCH_FINISHED';

export interface GameEvent {
  readonly sequence: number;
  readonly revision: number;
  readonly turnId: number;
  readonly type: GameEventType;
  readonly side: PlayerSide;
  readonly action: GameAction | null;
  readonly reason: SkipReason | GameResultReason | null;
}

export type TransitionResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly events: readonly GameEvent[];
      readonly result: GameResult | null;
    }
  | {
      readonly ok: false;
      readonly code: ActionErrorCode;
    };
