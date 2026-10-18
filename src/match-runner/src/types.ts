/**
 * P1-D03 — MatchRunner configuration, port bundle and report types.
 *
 * Sources of truth: `docs/contracts/bot-protocol-v1.md` sections 3–5 (INIT payload and
 * limits) and `docs/contracts/engine-api-v1.md` sections 4–5. Domain, protocol and port
 * types are reused from `@ott/game-core`, `@ott/bot-protocol` and `./ports.ts`; nothing is
 * copied and this module has no runtime imports.
 */
import type { GameConfig, GameEvent, GameResult, GameState, PlayerSide } from '@ott/game-core';
import type { FaultSummary, Limits, TimeControlV2 } from '@ott/bot-protocol';

import type { EventLogV1, EventLogV2 } from './event-log.ts';
import type { BotPort, GamePort, MonotonicClock } from './ports.ts';

/** Everything one match needs; `matchId` is copied verbatim into every protocol message. */
export interface MatchConfig {
  readonly matchId: string;
  /** Passed through to INIT; the runner itself never uses it (Engine API v1 stays deterministic). */
  readonly seed: string;
  /** Handed to `GamePort.create`. */
  readonly game: GameConfig;
  /** Sent in INIT; `turnTimeoutMs` is the deadline handed to `BotPort.requestAction`. */
  readonly limits: Limits;
  /**
   * P3-L02: pin Bot Protocol v2. When set the runner sends v2 messages, enforces the chess
   * clock from `timeControl` (instead of `limits.turnTimeoutMs`) and writes a v2 event log.
   * `ports.clock` is then required. Absent ⇒ behaviour is unchanged v1.
   */
  readonly protocolV2?: {
    readonly timeControl: TimeControlV2;
    /** INIT `botSeed` per side; never the engine seed (`seed`). */
    readonly botSeeds: Readonly<Record<PlayerSide, string>>;
  };
}

/** A config that pins Bot Protocol v2 (P3-L02): `runMatch` then returns an `EventLogV2` report. */
export type MatchConfigV2 = MatchConfig & { readonly protocolV2: NonNullable<MatchConfig['protocolV2']> };

/** The seam the runner drives: one game port plus one bot port per side. */
export interface MatchPorts {
  readonly game: GamePort;
  readonly bots: Readonly<Record<PlayerSide, BotPort>>;
  /** Monotonic clock for the v2 chess clock; the core never reads a system clock itself. */
  readonly clock?: MonotonicClock;
}

/** What `runMatch` returns after the match ends: the result, the final state and the full event trail. */
export interface MatchReport<Log extends EventLogV1 | EventLogV2 = EventLogV1> {
  readonly matchId: string;
  readonly result: GameResult;
  readonly finalState: GameState;
  /** Every transition event, in emission order; `sequence` is strictly increasing. */
  readonly events: readonly GameEvent[];
  readonly faults: Readonly<Record<PlayerSide, FaultSummary>>;
  /** `EventLogV1` for a v1 match, `EventLogV2` (with `timing`) when `config.protocolV2` is set. */
  readonly log: Log;
}

export type MatchRunnerErrorCode =
  /** `game.maxTurns` disagrees with `limits.maxTurns`. */
  | 'INVALID_CONFIG'
  /** The GamePort rejected an action or skip it had just listed as legal — engine invariant broken. */
  | 'ENGINE_REJECTED_ACTION'
  /** The state is FINISHED but `GamePort.result` returned null — engine invariant broken. */
  | 'ENGINE_NO_RESULT';
