/**
 * Runtime GamePort adapter for the public `@ott/game-core` API (P1-D09).
 *
 * This module intentionally contains no rule logic: every operation is forwarded to
 * the engine's public entrypoint, preserving its state, action, result and error
 * semantics for MatchRunner.
 */
import {
  applyAction,
  createGame,
  DEFAULT_MAP,
  forfeitGame,
  getGameResult,
  hashGameState,
  listLegalActions,
  skipTurn,
} from '@ott/game-core';
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

import type { GamePort } from './ports.ts';

/** The locked Phase 1 map exposed by game-core's public package API. */
export const DEFAULT_CORE_MAP = DEFAULT_MAP;

/** Thin adapter used by the CLI composition root and real-core integration tests. */
export class CoreGameAdapter implements GamePort {
  create(config: GameConfig): GameState {
    return createGame(config);
  }

  listLegalActions(state: GameState, side: PlayerSide): readonly GameAction[] {
    return listLegalActions(state, side);
  }

  apply(state: GameState, side: PlayerSide, action: GameAction): TransitionResult {
    return applyAction(state, side, action);
  }

  skip(state: GameState, side: PlayerSide, reason: SkipReason): TransitionResult {
    return skipTurn(state, side, reason);
  }

  forfeit(
    state: GameState,
    forfeitedSide: PlayerSide,
    fault: ProcessFaultCode | SkipReason,
  ): TransitionResult {
    return forfeitGame(state, forfeitedSide, fault);
  }

  result(state: GameState): GameResult | null {
    return getGameResult(state);
  }

  hash(state: GameState): string {
    return hashGameState(state);
  }
}
