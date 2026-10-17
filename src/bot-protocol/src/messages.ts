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

/**
 * Bot Protocol v2 — additive only: every v1 type above stays frozen
 * (`PROTOCOL_VERSION`, `ProtocolMessage`, `Limits`, ...). Source of truth:
 * `docs/contracts/bot-protocol-v2.md` (design contract, ADR-0008) and the
 * matching machine schema `docs/contracts/bot-protocol-v2.schema.json`.
 *
 * P3-L01 delivers schema/types/fixtures; the chess-clock runtime that computes
 * `timeBudget` from a monotonic clock is P3-L02.
 */

/** v2 keeps the five-message lifecycle of v1; a match pins exactly one version. */
export const PROTOCOL_VERSION_V2 = 2;

/** Per-turn policy pinned by a rule set (`limits.timeControl.perTurn`). */
export type PerTurnPolicyV2 =
  | { readonly mode: 'FIXED'; readonly fixedMs: number }
  | {
      readonly mode: 'DYNAMIC';
      readonly baseMs: number;
      readonly stepMs: number;
      readonly everyTurns: number;
      readonly maxMs: number;
    }
  | { readonly mode: 'NONE' };

/**
 * v2 time budget. The Runner computes every duration from a monotonic server
 * clock and all caps stay finite: `perTurn: NONE` still carries a total per-bot
 * budget and a match wall-clock cap. Values are data from a locked
 * `RoundRuleSet`, never protocol constants — field names mirror the merged
 * `RoundRuleSetRulesV1.timeControl` shape.
 */
export interface TimeControlV2 {
  readonly startupMs: number;
  readonly totalBotBudgetMs: number;
  readonly matchWallClockMs: number;
  readonly perTurn: PerTurnPolicyV2;
}

/** v1 `Limits` minus `startupTimeoutMs`/`turnTimeoutMs`, which `timeControl` supersedes. */
export interface LimitsV2 {
  readonly maxTurns: number;
  readonly maxMessageBytes: number;
  readonly maxStderrBytes: number;
  readonly maxConsecutiveFaults: number;
  readonly maxTotalFaults: number;
  readonly timeControl: TimeControlV2;
}

/** Common v2 fields: `protocolVersion` pinned to 2, `matchId` stays opaque. */
export interface MessageBaseV2 {
  readonly type: ProtocolMessageType;
  readonly protocolVersion: 2;
  readonly matchId: string;
}

/** v2 INIT — Runner → Bot, exactly once after spawn. Carries `botSeed`, never the engine seed. */
export interface InitMessageV2 extends MessageBaseV2 {
  readonly type: 'INIT';
  readonly engineVersion: string;
  readonly side: PlayerSide;
  readonly botSeed: string;
  readonly map: MapDefinition;
  readonly limits: LimitsV2;
}

/** Budget the Runner reports with each turn (`STATE_UPDATE.timeBudget`). */
export interface TurnBudgetV2 {
  /** `null` means "no per-turn cap"; total budget and wall-clock cap stay finite. */
  readonly turnLimitMs: number | null;
  readonly remainingBotBudgetMs: number;
}

/** v2 STATE_UPDATE — Runner → the bot whose turn it is. */
export interface StateUpdateMessageV2 extends MessageBaseV2 {
  readonly type: 'STATE_UPDATE';
  readonly turnId: number;
  readonly state: PublicGameState;
  readonly legalActions: readonly GameAction[];
  readonly timeBudget: TurnBudgetV2;
}

/** v2 ACTION — Bot → Runner, at most once per STATE_UPDATE. */
export interface ActionMessageV2 extends MessageBaseV2 {
  readonly type: 'ACTION';
  readonly turnId: number;
  readonly action: GameAction;
}

/** v2 TURN_RESULT — same shape as v1 apart from `protocolVersion`. */
export interface TurnResultMessageV2 extends MessageBaseV2 {
  readonly type: 'TURN_RESULT';
  readonly turnId: number;
  readonly actorSide: PlayerSide;
  readonly outcome: 'APPLIED' | 'SKIPPED';
  readonly action: GameAction | null;
  readonly errorCode: TurnErrorCode | null;
  readonly revision: number;
  readonly nextSide: PlayerSide | null;
}

/** v2 MATCH_RESULT — same shape as v1 apart from `protocolVersion`. */
export interface MatchResultMessageV2 extends MessageBaseV2 {
  readonly type: 'MATCH_RESULT';
  readonly winnerSide: PlayerSide | null;
  readonly reason: GameResultReason;
  readonly turnCount: number;
  readonly finalStateHash: string;
  readonly faults: Readonly<Record<PlayerSide, FaultSummary>>;
}

export type ProtocolMessageV2 =
  | InitMessageV2
  | StateUpdateMessageV2
  | ActionMessageV2
  | TurnResultMessageV2
  | MatchResultMessageV2;

/**
 * Either protocol version. Additive alias: `ProtocolMessage` itself stays the
 * frozen v1 union, so existing v1 consumers (MatchRunner) keep compiling.
 */
export type AnyProtocolMessage = ProtocolMessage | ProtocolMessageV2;

