/**
 * P3-L02 — Bot Protocol v2 chess-clock timing policy.
 *
 * Source of truth: `docs/contracts/bot-protocol-v2.md` ("INIT changes", "STATE_UPDATE changes",
 * "Failure and compatibility rules"). Everything here is a pure function of
 * (rules, turn index, recorded elapsed values): there is no clock, timer or randomness, so the
 * runner can measure elapsed time with an injected monotonic clock and the replay verifier can
 * recompute every decision from the log alone.
 *
 * Semantics (decisions the contract leaves open are marked):
 * - Turn index is the Engine `turnNumber - 1` (0-based, counts both sides' turns). *Decision:*
 *   `DYNAMIC` grows with this global index: `min(maxMs, baseMs + stepMs * floor(index / everyTurns))`.
 * - Each bot owns an independent budget `totalBotBudgetMs`; a turn's answer time is deducted.
 * - The enforced deadline is the strictest of the per-turn limit, the bot's remaining budget and
 *   the remaining match wall-clock. The `turnLimitMs` sent to the bot is `min(perTurn, remaining
 *   budget)`, or `null` for `perTurn: NONE`. *Decision:* wall-clock is not folded into it.
 * - An answer is on time when `elapsed <= deadline`. A late answer (or a transport timeout) is
 *   charged `max(elapsed, deadline)`. A deadline of 0 or less means the bot is not asked at all.
 * - `exhaustion` names the strictest limiter that was exceeded. Ties go to the weaker limiter in
 *   the order TURN_LIMIT < BOT_BUDGET < WALL_CLOCK, so an exactly-equal limit is a plain turn
 *   timeout and the next turn (deadline 0) detects the empty budget.
 */
import { validateTimeControlV2 } from '@ott/bot-protocol';
import type { TimeControlErrorCode, TimeControlV2 } from '@ott/bot-protocol';
import type { PlayerSide } from '@ott/game-core';

export type TimingExhaustion = 'TURN_LIMIT' | 'BOT_BUDGET' | 'WALL_CLOCK';

/** What the policy decides before a bot is asked. */
export interface TurnGrant {
  readonly turnIndex: number;
  /** Value for `timeBudget.turnLimitMs`: `null` means no per-turn cap. */
  readonly turnLimitMs: number | null;
  /** Enforced timeout: the strictest of per-turn limit, remaining budget and remaining wall-clock. */
  readonly deadlineMs: number;
  /** `timeBudget.remainingBotBudgetMs`. */
  readonly remainingBotBudgetMs: number;
  readonly wallElapsedBeforeMs: number;
  /** The limiter `deadlineMs` came from; the exhaustion reported if the bot overruns it. */
  readonly binding: TimingExhaustion;
}

export interface TurnSettlement {
  readonly chargedMs: number;
  readonly remainingAfterMs: number;
  readonly wallElapsedAfterMs: number;
  readonly exhaustion: TimingExhaustion | null;
}

/** One recorded timing decision (one per bot-asked turn, in turn order). */
export interface TimingDecision {
  readonly turnId: number;
  readonly side: PlayerSide;
  readonly turnLimitMs: number | null;
  readonly deadlineMs: number;
  readonly remainingBeforeMs: number;
  readonly wallElapsedBeforeMs: number;
  /** Measured by the monotonic clock (0 when the bot was not asked). */
  readonly elapsedMs: number;
  /** The transport reported `BOT_TIMEOUT`. */
  readonly timedOut: boolean;
  readonly chargedMs: number;
  readonly remainingAfterMs: number;
  readonly exhaustion: TimingExhaustion | null;
}

export type TimingPolicyValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: TimeControlErrorCode | 'INVALID_TIME_CONTROL'; readonly detail: string };

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Contract numeric relations come from `@ott/bot-protocol` (`validateTimeControlV2`); the extra
 * checks only reject values the policy cannot compute with (non-integers, zero totals).
 */
export function validateTimingRules(timeControl: TimeControlV2): TimingPolicyValidation {
  const contract = validateTimeControlV2(timeControl);
  if (!contract.ok) return { ok: false, code: contract.code, detail: `timeControl rejected: ${contract.code}` };

  const bad = (detail: string): TimingPolicyValidation => ({ ok: false, code: 'INVALID_TIME_CONTROL', detail });
  if (!isNonNegativeInteger(timeControl.startupMs)) return bad('startupMs must be a non-negative integer');
  if (!isNonNegativeInteger(timeControl.totalBotBudgetMs) || timeControl.totalBotBudgetMs < 1) {
    return bad('totalBotBudgetMs must be an integer >= 1');
  }
  if (!isNonNegativeInteger(timeControl.matchWallClockMs) || timeControl.matchWallClockMs < 1) {
    return bad('matchWallClockMs must be an integer >= 1');
  }
  const perTurn = timeControl.perTurn;
  if (perTurn.mode === 'FIXED') {
    if (!isNonNegativeInteger(perTurn.fixedMs) || perTurn.fixedMs < 1) return bad('perTurn.fixedMs must be an integer >= 1');
  } else if (perTurn.mode === 'DYNAMIC') {
    if (!isNonNegativeInteger(perTurn.baseMs) || perTurn.baseMs < 1) return bad('perTurn.baseMs must be an integer >= 1');
    if (!isNonNegativeInteger(perTurn.stepMs)) return bad('perTurn.stepMs must be a non-negative integer');
    if (!isNonNegativeInteger(perTurn.everyTurns) || perTurn.everyTurns < 1) {
      return bad('perTurn.everyTurns must be an integer >= 1');
    }
    if (!isNonNegativeInteger(perTurn.maxMs)) return bad('perTurn.maxMs must be a non-negative integer');
  }
  return { ok: true };
}

/** Per-turn cap for `turnIndex` (0-based), or `null` when `perTurn` is `NONE`. */
export function perTurnLimitMs(perTurn: TimeControlV2['perTurn'], turnIndex: number): number | null {
  switch (perTurn.mode) {
    case 'NONE':
      return null;
    case 'FIXED':
      return perTurn.fixedMs;
    case 'DYNAMIC':
      return Math.min(perTurn.maxMs, perTurn.baseMs + perTurn.stepMs * Math.floor(turnIndex / perTurn.everyTurns));
  }
}

/** Decide the limits for one turn. `remainingBotBudgetMs` is the asked bot's own clock. */
export function grantTurn(
  timeControl: TimeControlV2,
  input: { readonly turnIndex: number; readonly remainingBotBudgetMs: number; readonly wallElapsedMs: number },
): TurnGrant {
  const perTurn = perTurnLimitMs(timeControl.perTurn, input.turnIndex);
  const remaining = input.remainingBotBudgetMs;
  const wallRemaining = timeControl.matchWallClockMs - input.wallElapsedMs;

  // Strictest wins; a tie keeps the weaker limiter (see header).
  let deadline = perTurn ?? Number.POSITIVE_INFINITY;
  let binding: TimingExhaustion = 'TURN_LIMIT';
  if (remaining < deadline) {
    deadline = remaining;
    binding = 'BOT_BUDGET';
  }
  if (wallRemaining < deadline) {
    deadline = wallRemaining;
    binding = 'WALL_CLOCK';
  }

  return {
    turnIndex: input.turnIndex,
    turnLimitMs: perTurn === null ? null : Math.min(perTurn, remaining),
    deadlineMs: Math.max(0, deadline),
    remainingBotBudgetMs: remaining,
    wallElapsedBeforeMs: input.wallElapsedMs,
    binding,
  };
}

/** True when the bot must not be asked at all (empty budget or wall-clock). */
export function isGrantEmpty(grant: TurnGrant): boolean {
  return grant.deadlineMs <= 0;
}

/** Charge the measured elapsed time and decide exhaustion. */
export function settleTurn(grant: TurnGrant, observed: { readonly elapsedMs: number; readonly timedOut: boolean }): TurnSettlement {
  const overrun = isGrantEmpty(grant) || observed.timedOut || observed.elapsedMs > grant.deadlineMs;
  const chargedMs = isGrantEmpty(grant) ? 0 : overrun ? Math.max(observed.elapsedMs, grant.deadlineMs) : observed.elapsedMs;
  return {
    chargedMs,
    remainingAfterMs: Math.max(0, grant.remainingBotBudgetMs - chargedMs),
    wallElapsedAfterMs: grant.wallElapsedBeforeMs + chargedMs,
    exhaustion: overrun ? grant.binding : null,
  };
}

export function toDecision(
  grant: TurnGrant,
  settlement: TurnSettlement,
  observed: { readonly turnId: number; readonly side: PlayerSide; readonly elapsedMs: number; readonly timedOut: boolean },
): TimingDecision {
  return {
    turnId: observed.turnId,
    side: observed.side,
    turnLimitMs: grant.turnLimitMs,
    deadlineMs: grant.deadlineMs,
    remainingBeforeMs: grant.remainingBotBudgetMs,
    wallElapsedBeforeMs: grant.wallElapsedBeforeMs,
    elapsedMs: observed.elapsedMs,
    timedOut: observed.timedOut,
    chargedMs: settlement.chargedMs,
    remainingAfterMs: settlement.remainingAfterMs,
    exhaustion: settlement.exhaustion,
  };
}

export type TimingVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly position: number; readonly detail: string };

const DECISION_FIELDS = [
  'turnLimitMs',
  'deadlineMs',
  'remainingBeforeMs',
  'wallElapsedBeforeMs',
  'chargedMs',
  'remainingAfterMs',
  'exhaustion',
] as const;

/**
 * Recompute every decision from the rules plus the recorded observations (`turnId`, `side`,
 * `elapsedMs`, `timedOut`, `wallElapsedBeforeMs`) and compare the derived fields. Each side's
 * budget is replayed from `totalBotBudgetMs`, so a recorded limit or remaining total that
 * disagrees with the rules is rejected.
 */
export function verifyTimingDecisions(timeControl: TimeControlV2, decisions: readonly TimingDecision[]): TimingVerdict {
  const remaining: Record<PlayerSide, number> = { X: timeControl.totalBotBudgetMs, O: timeControl.totalBotBudgetMs };
  let previousWallAfter = 0;
  let previousTurnId = 0;

  for (let position = 0; position < decisions.length; position++) {
    const recorded = decisions[position]!;
    const fail = (detail: string): TimingVerdict => ({ ok: false, position, detail: `timing[${position}] ${detail}` });

    if (recorded.turnId <= previousTurnId) return fail(`turnId ${recorded.turnId} is not after ${previousTurnId}`);
    if (recorded.elapsedMs < 0 || !Number.isFinite(recorded.elapsedMs)) return fail(`elapsedMs ${recorded.elapsedMs} is invalid`);
    // The wall clock only moves forward; time cannot be erased between turns.
    if (recorded.wallElapsedBeforeMs < previousWallAfter) {
      return fail(`wallElapsedBeforeMs ${recorded.wallElapsedBeforeMs} is before the previous turn ended (${previousWallAfter})`);
    }

    const grant = grantTurn(timeControl, {
      turnIndex: recorded.turnId - 1,
      remainingBotBudgetMs: remaining[recorded.side],
      wallElapsedMs: recorded.wallElapsedBeforeMs,
    });
    const settlement = settleTurn(grant, { elapsedMs: recorded.elapsedMs, timedOut: recorded.timedOut });
    const expected = toDecision(grant, settlement, recorded);

    for (const field of DECISION_FIELDS) {
      if (recorded[field] !== expected[field]) {
        return fail(`${field} is ${JSON.stringify(recorded[field])} but the rules give ${JSON.stringify(expected[field])}`);
      }
    }

    remaining[recorded.side] = settlement.remainingAfterMs;
    previousWallAfter = settlement.wallElapsedAfterMs;
    previousTurnId = recorded.turnId;
  }
  return { ok: true };
}
