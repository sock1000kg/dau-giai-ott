/**
 * P1-D04 — MatchRunner turn loop, fault policy and cleanup.
 *
 * Sources of truth: `docs/contracts/bot-protocol-v1.md` §3–§6 and §8 (limits, message
 * sequence, error codes and policy) plus `docs/contracts/engine-api-v1.md` §4–§5 (skip and
 * forfeit semantics). The Engine is the only source of game truth: every rule decision goes
 * through `GamePort`, this module contains no game logic.
 *
 * Policy (Bot Protocol v1 §6), implemented here:
 * - Recoverable turn faults — `MATCH_ID_MISMATCH`, `TURN_ID_MISMATCH`, `ILLEGAL_ACTION`
 *   (detected in that order, mirroring §7 step 4) and a non-ok reply whose code is one of
 *   the four transport codes — skip the turn exactly once, count the fault, broadcast the
 *   skip's TURN_RESULT, and forfeit once a threshold is reached.
 * - A valid action resets only the consecutive counter.
 * - `NO_LEGAL_ACTION` (the engine has no move) is a skip but never a bot fault.
 * - Process faults forfeit immediately and mark the bot dead; it receives no further
 *   message, while the other living bot gets the single MATCH_RESULT.
 * - A failed start marks that side dead before any STATE_UPDATE; if any side failed, the
 *   first failed side in X, O order is forfeited.
 * - Unexpected exceptions from a port propagate unchanged; `finally` still stops both bots.
 *
 * Purity: no clock, no randomness, no timers, no child processes; the only runtime imports
 * are protocol constants.
 */
import { PROTOCOL_VERSION } from '@ott/bot-protocol';
import type {
  FaultSummary,
  InitMessage,
  MatchResultMessage,
  PublicGameState,
  StateUpdateMessage,
  TurnResultMessage,
} from '@ott/bot-protocol';
import type {
  GameAction,
  GameEvent,
  GameResult,
  GameState,
  PlayerSide,
  ProcessFaultCode,
  SkipReason,
  TransitionResult,
} from '@ott/game-core';

import {
  MatchRunnerError,
  isProcessFault,
  recordProcessFault,
  recordRecoverable,
  recordValidAction,
  zeroFaultSummary,
} from './errors.ts';
import { EVENT_LOG_FORMAT, EVENT_LOG_FORMAT_VERSION, cloneEvent } from './event-log.ts';
import type { EventLogEntry, EventLogFooter, EventLogHeader, EventLogV1, TransitionInput } from './event-log.ts';
import type { MatchConfig, MatchPorts, MatchReport } from './types.ts';

const SIDES = ['X', 'O'] as const;

function cloneAction(action: GameAction): GameAction {
  return { pieceId: action.pieceId, to: { col: action.to.col, row: action.to.row } };
}

function sameAction(a: GameAction, b: GameAction): boolean {
  return a.pieceId === b.pieceId && a.to.col === b.to.col && a.to.row === b.to.row;
}

/**
 * Locked `publicGameState` projection (Bot Protocol v1 §5.2): no `gameId`, `status` is
 * always PLAYING and `outcome` is always null. Only called inside the PLAYING loop.
 */
function toPublicState(state: GameState): PublicGameState {
  return {
    schemaVersion: 1,
    engineVersion: state.engineVersion,
    map: { ...state.map },
    status: 'PLAYING',
    turn: state.turn,
    turnNumber: state.turnNumber,
    turnCount: state.turnCount,
    revision: state.revision,
    maxTurns: state.maxTurns,
    pieces: state.pieces.map((piece) => ({
      id: piece.id,
      owner: piece.owner,
      type: piece.type,
      position: { col: piece.position.col, row: piece.position.row },
    })),
    outcome: null,
  };
}

/** Per-side runtime state the loop keeps outside the game state. */
interface SideRuntime {
  readonly alive: boolean;
  readonly summary: FaultSummary;
}

function toRuntime(): Readonly<Record<PlayerSide, SideRuntime>> {
  return { X: { alive: true, summary: zeroFaultSummary() }, O: { alive: true, summary: zeroFaultSummary() } };
}

/**
 * Run one match: INIT once per bot, one STATE_UPDATE per asked turn, a TURN_RESULT
 * broadcast to the living bots after every adjudicated turn, and exactly one MATCH_RESULT
 * to each living bot. Both bots are always stopped, X then O, even on failure.
 */
export async function runMatch(config: MatchConfig, ports: MatchPorts): Promise<MatchReport> {
  if (config.game.maxTurns !== config.limits.maxTurns) {
    throw new MatchRunnerError(
      'INVALID_CONFIG',
      `game.maxTurns (${config.game.maxTurns}) must equal limits.maxTurns (${config.limits.maxTurns})`,
    );
  }

  const { game, bots } = ports;
  const { matchId } = config;
  const events: GameEvent[] = [];
  const entries: EventLogEntry[] = [];
  let runtime = toRuntime();

  const recordTransition = (
    input: TransitionInput,
    transitionEvents: readonly GameEvent[],
    nextState: GameState,
  ): void => {
    entries.push({
      index: entries.length + 1,
      input,
      events: transitionEvents.map(cloneEvent),
      revision: nextState.revision,
      stateHash: game.hash(nextState),
    });
    events.push(...transitionEvents);
  };

  try {
    let state = game.create(config.game);

    const initFor = (side: PlayerSide): InitMessage => ({
      type: 'INIT',
      protocolVersion: PROTOCOL_VERSION,
      matchId,
      engineVersion: config.game.engineVersion,
      side,
      seed: config.seed,
      // Deep-copied per bot so a bot that mutates its INIT cannot reach `config` or the
      // other bot's message.
      map: structuredClone(config.game.map),
      limits: structuredClone(config.limits),
    });

    // Both sides are always started, X then O, so the order is deterministic even when the
    // first one fails.
    for (const side of SIDES) {
      const started = await bots[side].start(initFor(side));
      if (!started.ok) {
        // A failed start marks the bot dead; it is never asked for a turn and never gets a
        // MATCH_RESULT.
        runtime = {
          ...runtime,
          [side]: { alive: false, summary: recordProcessFault(runtime[side].summary, started.code) },
        };
      }
    }

    const firstFailed = SIDES.find((side) => !runtime[side].alive);
    if (firstFailed !== undefined) {
      // The contract has no "both failed" rule. Documented limitation: the first failed
      // side in X, O order is forfeited, so a double spawn failure still produces one
      // consistent result (a forfeit by X).
      state = forfeit(game, state, firstFailed, runtime[firstFailed].summary.lastErrorCode, recordTransition);
    }

    while (state.status === 'PLAYING') {
      const side = state.turn;
      // Protocol §4: turnId starts at 1 and grows by exactly 1 per action/skip, which is
      // the Engine's turnNumber.
      const turnId = state.turnNumber;
      const legal = game.listLegalActions(state, side);
      const live = SIDES.filter((candidate) => runtime[candidate].alive);

      // Set when a recoverable fault just crossed a forfeit threshold: the turn's
      // TURN_RESULT is still broadcast first, then the match is forfeited.
      let forfeitAfterTurn = false;
      let applied: GameAction | null = null;
      let outcome: 'APPLIED' | 'SKIPPED';
      let errorCode: TurnResultMessage['errorCode'] = null;

      if (legal.length === 0) {
        // Engine has no legal action. Bot Protocol v1 §5.2/§8: the active bot still gets
        // the STATE_UPDATE with an empty list and simply sends no ACTION; the runner skips
        // without waiting. Not a bot fault, so no counter moves (§6).
        await bots[side].notifyStateUpdate({
          type: 'STATE_UPDATE',
          protocolVersion: PROTOCOL_VERSION,
          matchId,
          turnId,
          state: toPublicState(state),
          legalActions: [],
        });
        state = adjudicateSkip(game, state, side, turnId, 'NO_LEGAL_ACTION', recordTransition);
        outcome = 'SKIPPED';
        errorCode = 'NO_LEGAL_ACTION';
      } else {
        const update: StateUpdateMessage = {
          type: 'STATE_UPDATE',
          protocolVersion: PROTOCOL_VERSION,
          matchId,
          turnId,
          state: toPublicState(state),
          // Deep-copied so a bot that mutates the message cannot corrupt the match.
          legalActions: legal.map(cloneAction),
        };
        const reply = await bots[side].requestAction(update, config.limits.turnTimeoutMs);

        if (!reply.ok) {
          if (isProcessFault(reply.code)) {
            // Process fault: no skip and no TURN_RESULT for this turn; the side dies and
            // the match is forfeited immediately.
            runtime = {
              ...runtime,
              [side]: { alive: false, summary: recordProcessFault(runtime[side].summary, reply.code) },
            };
            state = forfeit(game, state, side, reply.code, recordTransition);
            break;
          }
          const recorded = recordRecoverable(runtime[side].summary, reply.code, config.limits);
          runtime = { ...runtime, [side]: { ...runtime[side], summary: recorded.summary } };
          state = adjudicateSkip(game, state, side, turnId, reply.code, recordTransition);
          outcome = 'SKIPPED';
          errorCode = reply.code;
          if (recorded.mustForfeit && state.status === 'PLAYING') forfeitAfterTurn = true;
        } else {
          const message = reply.message;
          // Detection order mirrors Bot Protocol v1 §7 step 4: id checks before legality.
          const fault =
            message.matchId !== matchId
              ? ('MATCH_ID_MISMATCH' as const)
              : message.turnId !== turnId
                ? ('TURN_ID_MISMATCH' as const)
                : legal.some((candidate) => sameAction(candidate, message.action))
                  ? null
                  : ('ILLEGAL_ACTION' as const);

          if (fault !== null) {
            const recorded = recordRecoverable(runtime[side].summary, fault, config.limits);
            runtime = { ...runtime, [side]: { ...runtime[side], summary: recorded.summary } };
            state = adjudicateSkip(game, state, side, turnId, fault, recordTransition);
            outcome = 'SKIPPED';
            errorCode = fault;
            if (recorded.mustForfeit && state.status === 'PLAYING') forfeitAfterTurn = true;
          } else {
            const transition = game.apply(state, side, cloneAction(message.action));
            if (!transition.ok) {
              throw new MatchRunnerError(
                'ENGINE_REJECTED_ACTION',
                `engine rejected a legal action on turn ${turnId} (${transition.code})`,
              );
            }
            applied = cloneAction(message.action);
            outcome = 'APPLIED';
            state = transition.state;
            recordTransition({ kind: 'apply', side, action: cloneAction(applied) }, transition.events, state);
            runtime = { ...runtime, [side]: { ...runtime[side], summary: recordValidAction(runtime[side].summary) } };
          }
        }
      }

      const turnResult: TurnResultMessage = {
        type: 'TURN_RESULT',
        protocolVersion: PROTOCOL_VERSION,
        matchId,
        turnId,
        actorSide: side,
        outcome,
        action: applied,
        errorCode,
        revision: state.revision,
        nextSide: state.status === 'PLAYING' ? state.turn : null,
      };
      for (const target of live) {
        await bots[target].sendTurnResult(structuredClone(turnResult));
      }

      if (forfeitAfterTurn) {
        // Interpretation (the contract is silent): the threshold turn was adjudicated as a
        // skip, so its TURN_RESULT goes out first; only then is the match forfeited. The
        // bot stays alive and still receives the MATCH_RESULT.
        const code = runtime[side].summary.lastErrorCode;
        state = forfeit(game, state, side, code, recordTransition);
        break;
      }
    }

    const result: GameResult | null = game.result(state);
    if (result === null) {
      throw new MatchRunnerError('ENGINE_NO_RESULT', `finished state has no result for ${matchId}`);
    }

    // The report and the message get independent copies of the real counters.
    const faults: Readonly<Record<PlayerSide, FaultSummary>> = {
      X: { ...runtime.X.summary },
      O: { ...runtime.O.summary },
    };
    const matchResult: MatchResultMessage = {
      type: 'MATCH_RESULT',
      protocolVersion: PROTOCOL_VERSION,
      matchId,
      winnerSide: result.winnerSide,
      reason: result.reason,
      turnCount: result.turnCount,
      finalStateHash: result.finalStateHash,
      faults: {
        X: { ...faults.X },
        O: { ...faults.O },
      },
    };
    for (const side of SIDES) {
      if (runtime[side].alive) await bots[side].finish(structuredClone(matchResult));
    }

    const header: EventLogHeader = {
      format: EVENT_LOG_FORMAT,
      formatVersion: EVENT_LOG_FORMAT_VERSION,
      matchId,
      protocolVersion: PROTOCOL_VERSION,
      engineVersion: config.game.engineVersion,
      seed: config.seed,
      game: structuredClone(config.game),
      limits: structuredClone(config.limits),
    };

    const footer: EventLogFooter = {
      result: { ...result },
      faults: {
        X: { ...faults.X },
        O: { ...faults.O },
      },
      entryCount: entries.length,
    };

    const log: EventLogV1 = {
      header,
      entries,
      footer,
    };

    return { matchId, result, finalState: state, events, faults, log };
  } finally {
    // Cleanup always happens, X then O, and the second stop still runs if the first throws.
    try {
      await bots.X.stop();
    } finally {
      await bots.O.stop();
    }
  }
}

/** One adjudicated skip: the Engine advances the turn and emits `TURN_SKIPPED`. */
function adjudicateSkip(
  game: MatchPorts['game'],
  state: GameState,
  side: PlayerSide,
  turnId: number,
  reason: SkipReason,
  record: (input: TransitionInput, events: readonly GameEvent[], next: GameState) => void,
): GameState {
  const transition: TransitionResult = game.skip(state, side, reason);
  if (!transition.ok) {
    throw new MatchRunnerError('ENGINE_REJECTED_ACTION', `skip rejected on turn ${turnId} (${transition.code})`);
  }
  record({ kind: 'skip', side, reason }, transition.events, transition.state);
  return transition.state;
}

/** Forfeit (Bot Protocol v1 §6): revision +1, `turnCount` unchanged (Engine API v1 §5). */
function forfeit(
  game: MatchPorts['game'],
  state: GameState,
  side: PlayerSide,
  code: ProcessFaultCode | SkipReason | null,
  record: (input: TransitionInput, events: readonly GameEvent[], next: GameState) => void,
): GameState {
  const fault = code ?? 'SANDBOX_VIOLATION';
  const transition = game.forfeit(state, side, fault);
  if (!transition.ok) {
    throw new MatchRunnerError('ENGINE_REJECTED_ACTION', `forfeit rejected (${transition.code})`);
  }
  record({ kind: 'forfeit', side, fault }, transition.events, transition.state);
  return transition.state;
}
