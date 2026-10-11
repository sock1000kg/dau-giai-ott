/**
 * P1-D03 — MatchRunner configuration, port bundle and report types.
 *
 * Sources of truth: `docs/contracts/bot-protocol-v1.md` sections 3–5 (INIT payload and
 * limits) and `docs/contracts/engine-api-v1.md` sections 4–5. Domain, protocol and port
 * types are reused from `@ott/game-core`, `@ott/bot-protocol` and `./ports.ts`; nothing is
 * copied and this module has no runtime imports.
 */
import type { GameConfig, GameEvent, GameResult, GameState, PlayerSide } from '@ott/game-core';
import type { FaultSummary, Limits } from '@ott/bot-protocol';

import type { EventLogV1 } from './event-log.ts';
import type { BotPort, GamePort } from './ports.ts';

/** Everything one match needs; `matchId` is copied verbatim into every protocol message. */
export interface MatchConfig {
  readonly matchId: string;
  /** Passed through to INIT; the runner itself never uses it (Engine API v1 stays deterministic). */
  readonly seed: string;
  /** Handed to `GamePort.create`. */
  readonly game: GameConfig;
  /** Sent in INIT; `turnTimeoutMs` is the deadline handed to `BotPort.requestAction`. */
  readonly limits: Limits;
}

/** The seam the runner drives: one game port plus one bot port per side. */
export interface MatchPorts {
  readonly game: GamePort;
  readonly bots: Readonly<Record<PlayerSide, BotPort>>;
}

/** What `runMatch` returns after the match ends: the result, the final state and the full event trail. */
export interface MatchReport {
  readonly matchId: string;
  readonly result: GameResult;
  readonly finalState: GameState;
  /** Every transition event, in emission order; `sequence` is strictly increasing. */
  readonly events: readonly GameEvent[];
  readonly faults: Readonly<Record<PlayerSide, FaultSummary>>;
  readonly log: EventLogV1;
}

export type MatchRunnerErrorCode =
  /** `game.maxTurns` disagrees with `limits.maxTurns`. */
  | 'INVALID_CONFIG'
  /** The GamePort rejected an action or skip it had just listed as legal — engine invariant broken. */
  | 'ENGINE_REJECTED_ACTION'
  /** The state is FINISHED but `GamePort.result` returned null — engine invariant broken. */
  | 'ENGINE_NO_RESULT';
