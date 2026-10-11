/**
 * Deterministic in-memory doubles for P1-D02.
 *
 * `FakeGame` reproduces the Engine API v1 lifecycle (section 5), validation order
 * (section 6) and hash projection (section 8) from a script — it contains **no**
 * movement, combat or win rules, and it never copies the real engine's behavior.
 * `ScriptedBot` replays scripted replies in memory: no timers, no child processes.
 *
 * Both are pure with respect to time, randomness and the environment, so runner tests
 * can assert on states, events and hashes byte for byte.
 */
import { createHash } from 'node:crypto';

import type {
  GameAction,
  GameConfig,
  GameEvent,
  GameOutcome,
  GameResult,
  GameResultReason,
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
  ProtocolMessage,
  StateUpdateMessage,
  TurnResultMessage,
} from '@ott/bot-protocol';

import type { BotPort, BotReply, BotReplyErrorCode, BotStartResult, GamePort } from './ports.ts';

/** Scripted end condition, checked before the `maxTurns` draw (Engine API v1 section 5). */
export interface FinishScript {
  readonly turnCount: number;
  readonly winnerSide: PlayerSide | null;
  readonly reason: GameResultReason;
}

export interface FakeGameOptions {
  /**
   * Actions handed out for every turn, for both sides. The fake holds no rules, so it
   * does not filter by side — `listLegalActions(state, side)` returns this same script
   * and `apply` accepts only a deep-equal entry of it.
   */
  readonly legalActions?: readonly GameAction[];
  readonly finishAt?: FinishScript;
}

const DEFAULT_LEGAL_ACTIONS: readonly GameAction[] = [
  { pieceId: 'X1', to: { col: 0, row: 0 } },
  { pieceId: 'O1', to: { col: 0, row: 0 } },
];

function opponent(side: PlayerSide): PlayerSide {
  return side === 'X' ? 'O' : 'X';
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function cloneAction(action: GameAction): GameAction {
  return { pieceId: action.pieceId, to: { col: action.to.col, row: action.to.row } };
}

function sameAction(a: GameAction, b: GameAction): boolean {
  return a.pieceId === b.pieceId && a.to.col === b.to.col && a.to.row === b.to.row;
}

/**
 * Scripted `GamePort`. Lifecycle bookkeeping follows Engine API v1 section 5 exactly
 * (that is contract, not rules); end conditions come from the script, never from
 * board analysis. The input state is never mutated.
 */
export class FakeGame implements GamePort {
  readonly #legalActions: readonly GameAction[];
  readonly #finishAt: FinishScript | undefined;
  readonly #calls: string[] = [];

  constructor(options: FakeGameOptions = {}) {
    this.#legalActions = (options.legalActions ?? DEFAULT_LEGAL_ACTIONS).map(cloneAction);
    this.#finishAt = options.finishAt;
  }

  /**
   * Ordered log of **every** port-method call, so runner tests can assert interaction order.
   * It includes `result` and `hash` when `apply`/`skip`/`forfeit` invoke them internally:
   * a single plain `apply` logs `apply` then `result`, and one that finishes the match logs
   * `apply`, `result`, `hash`. D03 tests must expect these internal entries.
   */
  get calls(): readonly string[] {
    return [...this.#calls];
  }

  create(config: GameConfig): GameState {
    this.#calls.push('create');
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
      pieces: map.spawns
        .map((piece) => ({
          id: piece.id,
          owner: piece.owner,
          type: piece.type,
          position: { col: piece.position.col, row: piece.position.row },
        }))
        .sort(byId),
      outcome: null,
    };
  }

  listLegalActions(_state: GameState, _side: PlayerSide): readonly GameAction[] {
    this.#calls.push('listLegalActions');
    return this.#legalActions.map(cloneAction);
  }

  /**
   * Validation order per Engine API v1 section 6, minus `PIECE_NOT_FOUND` and
   * `NOT_YOUR_PIECE`: with no rules there is no piece lookup to fail, and an action
   * outside the script is reported as `ILLEGAL_MOVE` regardless of which piece it names.
   */
  apply(state: GameState, side: PlayerSide, action: GameAction): TransitionResult {
    this.#calls.push('apply');
    if (state.status !== 'PLAYING') return { ok: false, code: 'GAME_NOT_PLAYING' };
    if (state.turn !== side) return { ok: false, code: 'NOT_YOUR_TURN' };
    if (!this.#legalActions.some((candidate) => sameAction(candidate, action))) {
      return { ok: false, code: 'ILLEGAL_MOVE' };
    }
    return this.#completeTurn(state, {
      type: 'ACTION_APPLIED',
      side,
      action: cloneAction(action),
      reason: null,
    });
  }

  skip(state: GameState, side: PlayerSide, reason: SkipReason): TransitionResult {
    this.#calls.push('skip');
    if (state.status !== 'PLAYING') return { ok: false, code: 'GAME_NOT_PLAYING' };
    if (state.turn !== side) return { ok: false, code: 'NOT_YOUR_TURN' };
    return this.#completeTurn(state, { type: 'TURN_SKIPPED', side, action: null, reason });
  }

  /**
   * `forfeit` does not complete the current turn: `turnCount` and `turn` are held and
   * only `revision` advances to record the terminal transition (Engine API v1 section 5).
   */
  forfeit(
    state: GameState,
    forfeitedSide: PlayerSide,
    _fault: ProcessFaultCode | SkipReason,
  ): TransitionResult {
    this.#calls.push('forfeit');
    if (state.status !== 'PLAYING') return { ok: false, code: 'GAME_NOT_PLAYING' };

    const outcome: GameOutcome = {
      winnerSide: opponent(forfeitedSide),
      reason: 'FORFEIT',
      turnCount: state.turnCount,
      forfeitedSide,
    };
    const next: GameState = {
      ...state,
      status: 'FINISHED',
      revision: state.revision + 1,
      outcome,
    };
    const events: readonly GameEvent[] = [
      {
        sequence: next.revision,
        revision: next.revision,
        turnId: state.turnNumber,
        type: 'MATCH_FINISHED',
        side: forfeitedSide,
        action: null,
        reason: 'FORFEIT',
      },
    ];
    return { ok: true, state: next, events, result: this.result(next) };
  }

  result(state: GameState): GameResult | null {
    this.#calls.push('result');
    return state.outcome === null ? null : { ...state.outcome, finalStateHash: this.hash(state) };
  }

  /**
   * Lowercase SHA-256 hex of the Engine API v1 section 8 projection (`gameId` excluded,
   * pieces sorted by id). This is plain `JSON.stringify`, **not** RFC 8785 — the fake only
   * needs a stable, comparable digest; the canonical hash ships with game-core.
   */
  hash(state: GameState): string {
    this.#calls.push('hash');
    const projection = {
      schemaVersion: state.schemaVersion,
      engineVersion: state.engineVersion,
      map: state.map,
      status: state.status,
      turn: state.turn,
      turnNumber: state.turnNumber,
      turnCount: state.turnCount,
      revision: state.revision,
      maxTurns: state.maxTurns,
      pieces: [...state.pieces].sort(byId),
      outcome: state.outcome,
    };
    return createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  }

  /** One adjudicated turn: counters, then the scripted end check, then the swap. */
  #completeTurn(
    state: GameState,
    turn: { type: 'ACTION_APPLIED' | 'TURN_SKIPPED'; side: PlayerSide; action: GameAction | null; reason: SkipReason | null },
  ): TransitionResult {
    const turnCount = state.turnCount + 1;
    const revision = state.revision + 1;
    const outcome = this.#scriptedOutcome(state, turnCount);
    const continues = outcome === null;

    const next: GameState = {
      ...state,
      status: continues ? 'PLAYING' : 'FINISHED',
      turn: continues ? opponent(turn.side) : turn.side,
      turnNumber: continues ? state.turnNumber + 1 : state.turnNumber,
      turnCount,
      revision,
      outcome,
    };

    // Event contract: `revision` on an event is the revision of the state this transition
    // produced, so both events of a finishing transition carry `revision` and never a
    // revision no state has. `sequence` is the ordering key and is strictly increasing;
    // it cannot collide across transitions because no transition follows a FINISHED state
    // (every port method then returns `GAME_NOT_PLAYING`).
    const events: GameEvent[] = [
      {
        sequence: revision,
        revision,
        turnId: state.turnNumber,
        type: turn.type,
        side: turn.side,
        action: turn.action,
        reason: turn.reason,
      },
    ];
    if (outcome !== null) {
      events.push({
        sequence: revision + 1,
        revision,
        turnId: state.turnNumber,
        type: 'MATCH_FINISHED',
        side: turn.side,
        action: null,
        reason: outcome.reason,
      });
    }
    return { ok: true, state: next, events, result: this.result(next) };
  }

  /** Scripted `finishAt` first, then the `maxTurns` draw — so a last-turn win is a win. */
  #scriptedOutcome(state: GameState, turnCount: number): GameOutcome | null {
    const finished =
      this.#finishAt !== undefined && turnCount >= this.#finishAt.turnCount
        ? this.#finishAt
        : undefined;
    if (finished !== undefined) {
      return {
        winnerSide: finished.winnerSide,
        reason: finished.reason,
        turnCount,
        forfeitedSide: null,
      };
    }
    if (turnCount >= state.maxTurns) {
      return { winnerSide: null, reason: 'TURN_LIMIT', turnCount, forfeitedSide: null };
    }
    return null;
  }
}

export type ScriptedReply =
  | { readonly kind: 'action'; readonly action: GameAction }
  | { readonly kind: 'raw'; readonly message: ActionMessage }
  | { readonly kind: 'error'; readonly code: BotReplyErrorCode }
  | { readonly kind: 'throw'; readonly error: Error };

export interface ScriptedBotOptions {
  readonly replies: readonly ScriptedReply[];
  readonly startResult?: BotStartResult;
}

/**
 * Scripted `BotPort`: replies in order, everything received recorded. No timers
 * (`timeoutMs` is recorded only) and no child processes.
 *
 * After `stop()`, `start` and `requestAction` return `{ ok: false, code: 'BOT_EOF' }` and
 * `notifyStateUpdate`/`sendTurnResult`/`finish` resolve as no-ops without recording; the bot is
 * already gone and the runner's `finally` may call them in any order.
 */
export class ScriptedBot implements BotPort {
  readonly #queue: ScriptedReply[];
  readonly #startResult: BotStartResult;
  readonly #received: ProtocolMessage[] = [];
  readonly #timeouts: number[] = [];
  #stopCalls = 0;

  constructor(options: ScriptedBotOptions) {
    this.#queue = [...options.replies];
    this.#startResult = options.startResult ?? { ok: true };
  }

  /** Every message handed to the bot, in call order. */
  get received(): readonly ProtocolMessage[] {
    return [...this.#received];
  }

  /** How many times `stop()` was called, including idempotent repeats. */
  get stopCalls(): number {
    return this.#stopCalls;
  }

  /** `timeoutMs` values passed to `requestAction`; never waited on. */
  get requestedTimeouts(): readonly number[] {
    return [...this.#timeouts];
  }

  async start(init: InitMessage): Promise<BotStartResult> {
    if (this.#stopCalls > 0) return { ok: false, code: 'BOT_EOF' };
    if (!this.#startResult.ok) return this.#startResult;
    this.#received.push(init);
    return this.#startResult;
  }

  async requestAction(update: StateUpdateMessage, timeoutMs: number): Promise<BotReply> {
    this.#timeouts.push(timeoutMs);
    if (this.#stopCalls > 0) return { ok: false, code: 'BOT_EOF' };

    this.#received.push(update);
    const reply = this.#queue.shift();
    if (reply === undefined) return { ok: false, code: 'BOT_EOF' };
    if (reply.kind === 'throw') throw reply.error;
    if (reply.kind === 'error') return { ok: false, code: reply.code };
    if (reply.kind === 'raw') return { ok: true, message: reply.message };
    return {
      ok: true,
      message: {
        type: 'ACTION',
        protocolVersion: 1,
        matchId: update.matchId,
        turnId: update.turnId,
        action: cloneAction(reply.action),
      },
    };
  }

  /**
   * Send-only STATE_UPDATE (Bot Protocol v1 §5.2/§8): records the update, consumes no
   * scripted reply and records no timeout.
   */
  async notifyStateUpdate(update: StateUpdateMessage): Promise<void> {
    if (this.#stopCalls > 0) return;
    this.#received.push(update);
  }

  async sendTurnResult(message: TurnResultMessage): Promise<void> {
    if (this.#stopCalls > 0) return;
    this.#received.push(message);
  }

  async finish(message: MatchResultMessage): Promise<void> {
    if (this.#stopCalls > 0) return;
    this.#received.push(message);
  }

  async stop(): Promise<void> {
    this.#stopCalls += 1;
  }
}
