/**
 * Runner boundary for P1-D02 — the ports MatchRunner is written against.
 *
 * Sources of truth: `docs/contracts/engine-api-v1.md` (sections 4-6, 8) and
 * `docs/contracts/bot-protocol-v1.md` (sections 5-6). Domain and protocol types are
 * reused from `@ott/game-core` / `@ott/bot-protocol`; no type is copied or redefined
 * here, and nothing in this module is imported at runtime.
 *
 * Two deliberate deviations from the sketch in `docs/team-assignment-phase-1-2.md`
 * section 8.2: there is no `viewFor` (the bot projection `PublicGameState` is built by
 * the runner, not by the game), and `listLegalActions`/`forfeit`/`hash` are exposed
 * because Engine API v1 sections 5, 6 and 8 require them.
 */
import type {
  GameAction,
  GameConfig,
  GameResult,
  GameState,
  PlayerSide,
  ProcessFaultCode,
  SkipReason,
  TransitionResult,
} from '@ott/game-core';
import type {
  ActionMessage,
  InitMessage,
  MatchResultMessage,
  StateUpdateMessage,
  TurnResultMessage,
} from '@ott/bot-protocol';

/** Thin seam over Engine API v1 section 4; the real adapter (P1-D09) just forwards to game-core. */
export interface GamePort {
  create(config: GameConfig): GameState;
  listLegalActions(state: GameState, side: PlayerSide): readonly GameAction[];
  apply(state: GameState, side: PlayerSide, action: GameAction): TransitionResult;
  skip(state: GameState, side: PlayerSide, reason: SkipReason): TransitionResult;
  forfeit(state: GameState, forfeitedSide: PlayerSide, fault: ProcessFaultCode | SkipReason): TransitionResult;
  result(state: GameState): GameResult | null;
  hash(state: GameState): string;
}

/**
 * Failures a BotPort transport can report for one request (adapter-detectable only).
 * Derived from the protocol unions instead of re-listing them: the four recoverable
 * transport codes are the `SkipReason` members the adapter can detect, plus the
 * `ProcessFaultCode` set.
 *
 * `MATCH_ID_MISMATCH`, `TURN_ID_MISMATCH` and `ILLEGAL_ACTION` are deliberately absent:
 * only the runner knows the expected IDs and the legal action set, so it detects them.
 */
export type BotReplyErrorCode = Extract<
  SkipReason,
  'BOT_TIMEOUT' | 'MALFORMED_JSON' | 'SCHEMA_VIOLATION' | 'MESSAGE_TOO_LARGE'
> | ProcessFaultCode;
/** Bot failures are values, never exceptions, so P1-D04 can map them to skip/forfeit deterministically. */
export type BotReply =
  | { readonly ok: true; readonly message: ActionMessage }
  | { readonly ok: false; readonly code: BotReplyErrorCode };

/** Same rule for the one spawn attempt; a failed start is reported, not thrown. */
export type BotStartResult = { readonly ok: true } | { readonly ok: false; readonly code: ProcessFaultCode };

export interface BotPort {
  start(init: InitMessage): Promise<BotStartResult>;
  requestAction(update: StateUpdateMessage, timeoutMs: number): Promise<BotReply>;
  sendTurnResult(message: TurnResultMessage): Promise<void>;
  finish(message: MatchResultMessage): Promise<void>;
  /** Idempotent; must be safe to call in `finally` after any failure. */
  stop(): Promise<void>;
}
