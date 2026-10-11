/**
 * Process error classification for BotProcess lifecycle (P1-D06).
 *
 * Maps child process exit events, signals, and stream terminations to
 * deterministic ProcessFaultCode based on the current lifecycle phase.
 *
 * Exit classification table:
 *
 * | Phase      | Code / Signal / Trigger                         | Result              | Note                               |
 * | :--------- | :---------------------------------------------- | :------------------ | :--------------------------------- |
 * | `starting` | spawn error, early exit/close, startup timeout | `BOT_SPAWN_FAILED`  | Startup fault leads to forfeit     |
 * | `running`  | exit code !== 0 or killed by signal            | `BOT_CRASHED`       | Bot abnormal termination           |
 * | `running`  | exit code === 0, stdout end, stdin EPIPE/close  | `BOT_EOF`           | Bot exited cleanly or closed pipes |
 * | `stopping` | any exit code or signal                        | `null`              | Clean shutdown requested by runner |
 */

import type { ProcessFaultCode } from '@ott/game-core';

export type ProcessPhase = 'starting' | 'running' | 'stopping';

export interface ExitClassificationInput {
  readonly code?: number | null;
  readonly signal?: NodeJS.Signals | string | null;
  readonly phase: ProcessPhase;
}

/**
 * Classifies process exit events into a ProcessFaultCode or null.
 *
 * Returns `null` if the process was already in the `stopping` phase (not a fault).
 */
export function classifyExit(input: ExitClassificationInput): ProcessFaultCode | null {
  const { code, signal, phase } = input;

  if (phase === 'stopping') {
    return null;
  }

  if (phase === 'starting') {
    return 'BOT_SPAWN_FAILED';
  }

  // phase === 'running'
  if (signal !== null && signal !== undefined) {
    return 'BOT_CRASHED';
  }

  if (code !== null && code !== undefined && code !== 0) {
    return 'BOT_CRASHED';
  }

  return 'BOT_EOF';
}
