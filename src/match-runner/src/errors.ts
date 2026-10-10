/**
 * P1-D04 — MatchRunner fault policy helpers.
 *
 * Source of truth: `docs/contracts/bot-protocol-v1.md` §6 (error codes and policy), with the
 * thresholds from §3, mirrored in `docs/decisions/0002-*.md` and
 * `docs/tai-lieu-yeu-cau.md` §7.3.
 *
 * Everything here is pure: helpers take a `FaultSummary` and return new objects, so a fault
 * record can never be mutated through an outbound message or the returned report.
 */
import { PROCESS_FAULT_CODES } from '@ott/bot-protocol';
import type { FaultSummary, Limits, ProcessFaultCode, TurnErrorCode } from '@ott/bot-protocol';
import type { PlayerSide } from '@ott/game-core';

import type { MatchRunnerErrorCode } from './types.ts';

/** Every failure the runner refuses to continue with; carries a stable `code`. */
export class MatchRunnerError extends Error {
  readonly code: MatchRunnerErrorCode;

  constructor(code: MatchRunnerErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MatchRunnerError';
    this.code = code;
  }
}

/** A recoverable turn fault: one skip, counted once, forfeit only at a threshold. */
export type RecoverableCode = Exclude<TurnErrorCode, 'NO_LEGAL_ACTION'>;

/**
 * True for the immediate-forfeit process faults, built from the protocol's own
 * `PROCESS_FAULT_CODES` rather than a re-listed copy.
 */
export function isProcessFault(code: string): code is ProcessFaultCode {
  return (PROCESS_FAULT_CODES as readonly string[]).includes(code);
}

/** A fresh zero summary; used at match start and in tests. */
export function zeroFaultSummary(): FaultSummary {
  return { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null };
}

export interface RecoverableRecord {
  readonly summary: FaultSummary;
  /** True when the consecutive or total threshold has been reached (Bot Protocol v1 §6). */
  readonly mustForfeit: boolean;
}

/**
 * Record one recoverable turn fault: total and consecutive each grow by exactly one, the
 * last code is kept, and the thresholds from `limits` decide the forfeit. Returns a new
 * summary; the input is never mutated.
 */
export function recordRecoverable(
  summary: FaultSummary,
  code: RecoverableCode,
  limits: Limits,
): RecoverableRecord {
  const recoverableTotal = summary.recoverableTotal + 1;
  const recoverableConsecutive = summary.recoverableConsecutive + 1;
  return {
    summary: { recoverableTotal, recoverableConsecutive, lastErrorCode: code },
    mustForfeit:
      recoverableConsecutive >= limits.maxConsecutiveFaults ||
      recoverableTotal >= limits.maxTotalFaults,
  };
}

/** A valid action resets only the consecutive counter (total and last code stay). */
export function recordValidAction(summary: FaultSummary): FaultSummary {
  return { ...summary, recoverableConsecutive: 0 };
}

/**
 * Record a process fault: only the last code changes, the recoverable counters are
 * untouched, and the bot is marked dead.
 */
export function recordProcessFault(summary: FaultSummary, code: ProcessFaultCode): FaultSummary {
  return { ...summary, lastErrorCode: code };
}

/** Zero summaries for both sides, as separate objects. */
export function zeroFaults(): Readonly<Record<PlayerSide, FaultSummary>> {
  return { X: zeroFaultSummary(), O: zeroFaultSummary() };
}
