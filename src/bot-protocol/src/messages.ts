/**
 * Bot Protocol v1 message types — source of truth:
 * `docs/contracts/bot-protocol-v1.md` section 5 and the matching JSON Schema.
 *
 * Types only; runtime parsing/validation lands in P1-L04. Domain types are reused
 * from `@ott/game-core` (no copy).
 */
import type {
  GameAction,
  GameResultReason,
  MapDefinition,
  MapRef,
  Piece,
  PlayerSide,
} from '@ott/game-core';

import type { FaultCode, TurnErrorCode } from './errors.ts';

/** Bot Protocol v1 is frozen; a new field/message requires protocol v2. */
export const PROTOCOL_VERSION = 1;

export type ProtocolMessageType =
  | 'INIT'
  | 'STATE_UPDATE'
  | 'ACTION'
  | 'TURN_RESULT'
  | 'MATCH_RESULT';

/** Phase 1 runtime baseline (Bot Protocol v1 section 3). */
export const DEFAULT_LIMITS: Limits = {
  startupTimeoutMs: 5000,
  turnTimeoutMs: 3000,
  maxTurns: 200,
  maxMessageBytes: 65536,
  maxStderrBytes: 1048576,
  maxConsecutiveFaults: 3,
  maxTotalFaults: 5,
};

export interface Limits {
  readonly startupTimeoutMs: number;
  readonly turnTimeoutMs: number;
  readonly maxTurns: number;
  readonly maxMessageBytes: number;
  readonly maxStderrBytes: number;
  readonly maxConsecutiveFaults: number;
  readonly maxTotalFaults: number;
}

export interface FaultSummary {
  readonly recoverableTotal: number;
  readonly recoverableConsecutive: number;
  readonly lastErrorCode: FaultCode | null;
}

/**
 * Locked `GameState` projection sent to bots: no `gameId`; `status` is always
 * `PLAYING` and `outcome` is always `null` while a bot is alive (schema `publicGameState`).
 */
export interface PublicGameState {
  readonly schemaVersion: 1;
  readonly engineVersion: string;
  readonly map: MapRef;
  readonly status: 'PLAYING';
  readonly turn: PlayerSide;
  readonly turnNumber: number;
  readonly turnCount: number;
  readonly revision: number;
  readonly maxTurns: number;
  readonly pieces: readonly Piece[];
  readonly outcome: null;
}

/** Common fields per Bot Protocol v1 section 4. */
export interface MessageBase {
  readonly type: ProtocolMessageType;
  readonly protocolVersion: 1;
  readonly matchId: string;
}

/** 5.1 INIT — Runner → Bot, exactly once after spawn. */
export interface InitMessage extends MessageBase {
  readonly type: 'INIT';
  readonly engineVersion: string;
  readonly side: PlayerSide;
  readonly seed: string;
  readonly map: MapDefinition;
  readonly limits: Limits;
}

/** 5.2 STATE_UPDATE — Runner → the bot whose turn it is. */
export interface StateUpdateMessage extends MessageBase {
  readonly type: 'STATE_UPDATE';
  readonly turnId: number;
  readonly state: PublicGameState;
  readonly legalActions: readonly GameAction[];
}

/** 5.3 ACTION — Bot → Runner, at most once per STATE_UPDATE. */
export interface ActionMessage extends MessageBase {
  readonly type: 'ACTION';
  readonly turnId: number;
  readonly action: GameAction;
}

/** 5.4 TURN_RESULT — Runner → both living bots after each adjudicated turn. */
export interface TurnResultMessage extends MessageBase {
  readonly type: 'TURN_RESULT';
  readonly turnId: number;
  readonly actorSide: PlayerSide;
  readonly outcome: 'APPLIED' | 'SKIPPED';
  readonly action: GameAction | null;
  readonly errorCode: TurnErrorCode | null;
  readonly revision: number;
  readonly nextSide: PlayerSide | null;
}

/** 5.5 MATCH_RESULT — Runner → both living bots when the match ends. */
export interface MatchResultMessage extends MessageBase {
  readonly type: 'MATCH_RESULT';
  readonly winnerSide: PlayerSide | null;
  readonly reason: GameResultReason;
  readonly turnCount: number;
  readonly finalStateHash: string;
  readonly faults: Readonly<Record<PlayerSide, FaultSummary>>;
}

export type ProtocolMessage =
  | InitMessage
  | StateUpdateMessage
  | ActionMessage
  | TurnResultMessage
  | MatchResultMessage;
