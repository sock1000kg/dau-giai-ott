/**
 * P1-D03 — MatchRunner turn loop (happy path).
 *
 * Sources of truth: `docs/contracts/bot-protocol-v1.md` sections 3–5 and 8 (message
 * sequence) plus `docs/contracts/engine-api-v1.md` section 5 (turn lifecycle and the
 * `NO_LEGAL_ACTION` skip). The Engine is the only source of game truth: every rule
 * decision goes through `GamePort`, this module contains no game logic.
 *
 * Scope: the loop when everything goes right. Bot failures, fault counting, forfeit and
 * `start` handling are P1-D04 — until then each of those cases throws
 * `MatchRunnerError('UNHANDLED_BOT_FAILURE')` rather than being silently accepted.
 *
 * Purity: no clock, no randomness, no timers, no child processes; the only runtime import
 * is the protocol constant `PROTOCOL_VERSION`.
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
} from '@ott/game-core';

import type { MatchConfig, MatchPorts, MatchReport, MatchRunnerErrorCode } from './types.ts';

/** Every failure the runner refuses to continue with; carries a stable `code`. */
export class MatchRunnerError extends Error {
  readonly code: MatchRunnerErrorCode;

  constructor(code: MatchRunnerErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MatchRunnerError';
    this.code = code;
  }
}

function cloneAction(action: GameAction): GameAction {
  return { pieceId: action.pieceId, to: { col: action.to.col, row: action.to.row } };
}

function sameAction(a: GameAction, b: GameAction): boolean {
  return a.pieceId === b.pieceId && a.to.col === b.to.col && a.to.row === b.to.row;
}

/**
 * Fresh zero summaries for both sides. Every call builds separate objects so no two
 * outbound messages, nor the report, ever share a mutable reference.
 * Happy path only: P1-D04 owns the counters.
 */
function zeroFaults(): Readonly<Record<PlayerSide, FaultSummary>> {
  const zero = (): FaultSummary => ({
    recoverableTotal: 0,
    recoverableConsecutive: 0,
    lastErrorCode: null,
  });
  return { X: zero(), O: zero() };
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

/**
 * Run one match to completion: INIT once per bot, then one STATE_UPDATE per asked turn,
 * a TURN_RESULT broadcast to both bots after every adjudicated turn, and finally one
 * MATCH_RESULT to both. Both bots are always stopped, X then O, even on failure.
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

    for (const side of ['X', 'O'] as const) {
      const started = await bots[side].start(initFor(side));
      if (!started.ok) {
        // P1-D04 turns a failed start into an immediate forfeit.
        throw new MatchRunnerError('UNHANDLED_BOT_FAILURE', `bot ${side} failed to start (${started.code})`);
      }
    }

    const events: GameEvent[] = [];

    while (state.status === 'PLAYING') {
      const side = state.turn;
      // Protocol §4: turnId starts at 1 and grows by exactly 1 per action/skip, which is
      // the Engine's turnNumber.
      const turnId = state.turnNumber;
      const legal = game.listLegalActions(state, side);
      let applied: GameAction | null = null;
      let outcome: 'APPLIED' | 'SKIPPED';
      let errorCode: TurnResultMessage['errorCode'] = null;

      if (legal.length === 0) {
        // Engine has no legal action. Bot Protocol v1 §5.2/§8: the active bot still gets
        // the STATE_UPDATE with an empty list and simply sends no ACTION; the runner skips
        // without waiting. This is not a bot fault.
        await bots[side].notifyStateUpdate({
          type: 'STATE_UPDATE',
          protocolVersion: PROTOCOL_VERSION,
          matchId,
          turnId,
          state: toPublicState(state),
          legalActions: [],
        });
        const transition = game.skip(state, side, 'NO_LEGAL_ACTION');
        if (!transition.ok) {
          throw new MatchRunnerError(
            'ENGINE_REJECTED_ACTION',
            `skip rejected on turn ${turnId} (${transition.code})`,
          );
        }
        outcome = 'SKIPPED';
        errorCode = 'NO_LEGAL_ACTION';
        state = transition.state;
        events.push(...transition.events);
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

        // All of the following become D04 policy; D03 refuses to continue instead.
        if (!reply.ok) {
          throw new MatchRunnerError('UNHANDLED_BOT_FAILURE', `bot ${side} replied ${reply.code}`);
        }
        const message = reply.message;
        if (message.matchId !== matchId) {
          throw new MatchRunnerError(
            'UNHANDLED_BOT_FAILURE',
            `bot ${side} replied with matchId ${message.matchId}`,
          );
        }
        if (message.turnId !== turnId) {
          throw new MatchRunnerError(
            'UNHANDLED_BOT_FAILURE',
            `bot ${side} replied with turnId ${message.turnId}, expected ${turnId}`,
          );
        }
        if (!legal.some((candidate) => sameAction(candidate, message.action))) {
          throw new MatchRunnerError(
            'UNHANDLED_BOT_FAILURE',
            `bot ${side} replied with an action that is not legal on turn ${turnId}`,
          );
        }

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
        events.push(...transition.events);
      }

      // Same message value to both living bots (Bot Protocol v1 §5.4), but each bot gets
      // its own deep copy so one mutating it cannot affect the other.
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
      await broadcast(bots, turnResult);
    }

    const result: GameResult | null = game.result(state);
    if (result === null) {
      throw new MatchRunnerError('ENGINE_NO_RESULT', `finished state has no result for ${matchId}`);
    }

    // Two independent object graphs: one inside MATCH_RESULT, one on the report.
    const matchResult: MatchResultMessage = {
      type: 'MATCH_RESULT',
      protocolVersion: PROTOCOL_VERSION,
      matchId,
      winnerSide: result.winnerSide,
      reason: result.reason,
      turnCount: result.turnCount,
      finalStateHash: result.finalStateHash,
      faults: zeroFaults(),
    };
    await bots.X.finish(structuredClone(matchResult));
    await bots.O.finish(structuredClone(matchResult));

    return { matchId, result, finalState: state, events, faults: zeroFaults() };
  } finally {
    // Cleanup always happens, X then O, and the second stop still runs if the first throws.
    try {
      await bots.X.stop();
    } finally {
      await bots.O.stop();
    }
  }
}

/**
 * Send the same message value to both bots, X then O, so ordering is deterministic. Each
 * bot gets its own deep copy so neither can affect the other through a shared reference.
 */
async function broadcast(bots: MatchPorts['bots'], message: TurnResultMessage): Promise<void> {
  await bots.X.sendTurnResult(structuredClone(message));
  await bots.O.sendTurnResult(structuredClone(message));
}
