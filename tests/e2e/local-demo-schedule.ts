/**
 * local-demo-schedule.ts
 *
 * Pure schedule builder helper for local demo qualification E2E tests.
 * Calculates rule set schedule windows according to contract rules in
 * src/platform/api/src/modules/rounds/types.ts:284:
 *   tOpens < tDeadline && tDeadline < tGrace && tGrace <= tRunStarts && tRunStarts < tAppeal
 *
 * Contract requirements:
 *   - Reservation requires: now <= submissionDeadlineAt (submissions/reservations.ts:133)
 *   - Upload requires: now <= graceEndsAt (submissions/reservations.ts:218)
 *   - Close requires: now >= graceEndsAt (rounds/service.ts:526)
 *
 * To permit fast test execution while guaranteeing that reservations and uploads
 * succeed and close is not permanently blocked, the schedule is calculated
 * relative to creation time with a configurable submission window D (default: 75s).
 */

export interface DemoScheduleConfig {
  /**
   * Submission window in seconds (D). Covers steps c + d reservations and uploads with margin.
   * Default: 75 seconds. Can be overridden via env OTT_E2E_SUBMISSION_WINDOW_SECONDS.
   */
  submissionWindowSeconds?: number;
  /**
   * Grace window in seconds after submission deadline before round close is allowed.
   * Default: 5 seconds.
   */
  graceWindowSeconds?: number;
  /**
   * Reference start timestamp in milliseconds. Default: Date.now().
   */
  nowMs?: number;
}

export interface DemoSchedule {
  submissionOpensAt: string;
  submissionDeadlineAt: string;
  graceEndsAt: string;
  runStartsAt: string;
  runMaxHours: number;
  appealEndsAt: string;
}

export interface DemoScheduleTimestamps {
  opensMs: number;
  deadlineMs: number;
  graceMs: number;
  runStartsMs: number;
  appealMs: number;
}

export interface DemoScheduleResult {
  schedule: DemoSchedule;
  timestamps: DemoScheduleTimestamps;
  submissionWindowSeconds: number;
  graceWindowSeconds: number;
  maxWaitToCloseMs: number;
}

export const DEFAULT_SUBMISSION_WINDOW_SECONDS = 75;
export const DEFAULT_GRACE_WINDOW_SECONDS = 5;
export const DEMO_E2E_MAX_WAIT_TO_CLOSE_MS = 120_000;

/**
 * Resolves the submission window seconds from optional input, environment, or default.
 */
export function resolveSubmissionWindowSeconds(envValue?: string): number {
  if (envValue) {
    const parsed = Number.parseInt(envValue, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_SUBMISSION_WINDOW_SECONDS;
}

/**
 * Builds a valid qualification round rule set schedule.
 */
export function buildDemoRuleSetSchedule(config: DemoScheduleConfig = {}): DemoScheduleResult {
  const windowSec =
    config.submissionWindowSeconds ??
    resolveSubmissionWindowSeconds(process.env.OTT_E2E_SUBMISSION_WINDOW_SECONDS);
  const graceSec = config.graceWindowSeconds ?? DEFAULT_GRACE_WINDOW_SECONDS;
  const nowMs = config.nowMs ?? Date.now();

  const opensMs = nowMs - 3600_000; // opens 1 hour in the past so submissions open immediately
  const deadlineMs = nowMs + windowSec * 1000; // now + D (allows reservations up to deadline)
  const graceMs = deadlineMs + graceSec * 1000; // deadline + 5s (allows uploads up to grace)
  const runStartsMs = graceMs; // grace <= runStarts
  const appealMs = nowMs + 86400_000; // now + 24 hours

  const schedule: DemoSchedule = {
    submissionOpensAt: new Date(opensMs).toISOString(),
    submissionDeadlineAt: new Date(deadlineMs).toISOString(),
    graceEndsAt: new Date(graceMs).toISOString(),
    runStartsAt: new Date(runStartsMs).toISOString(),
    runMaxHours: 24,
    appealEndsAt: new Date(appealMs).toISOString(),
  };

  const timestamps: DemoScheduleTimestamps = {
    opensMs,
    deadlineMs,
    graceMs,
    runStartsMs,
    appealMs,
  };

  // Maximum wait required from nowMs until graceEndsAt has elapsed
  const maxWaitToCloseMs = Math.max(0, graceMs - nowMs);

  return {
    schedule,
    timestamps,
    submissionWindowSeconds: windowSec,
    graceWindowSeconds: graceSec,
    maxWaitToCloseMs,
  };
}

/**
 * Validates the strict chronological order required by types.ts:284:
 * tOpens < tDeadline && tDeadline < tGrace && tGrace <= tRunStarts && tRunStarts < tAppeal
 */
export function validateScheduleOrdering(schedule: DemoSchedule): {
  valid: boolean;
  errors: string[];
} {
  const tOpens = new Date(schedule.submissionOpensAt).getTime();
  const tDeadline = new Date(schedule.submissionDeadlineAt).getTime();
  const tGrace = new Date(schedule.graceEndsAt).getTime();
  const tRunStarts = new Date(schedule.runStartsAt).getTime();
  const tAppeal = new Date(schedule.appealEndsAt).getTime();

  const errs: string[] = [];

  if (Number.isNaN(tOpens) || Number.isNaN(tDeadline) || Number.isNaN(tGrace) || Number.isNaN(tRunStarts) || Number.isNaN(tAppeal)) {
    errs.push('One or more schedule timestamps are invalid ISO8601 strings');
  } else {
    if (!(tOpens < tDeadline)) {
      errs.push(`submissionOpensAt (${schedule.submissionOpensAt}) must be strictly before submissionDeadlineAt (${schedule.submissionDeadlineAt})`);
    }
    if (!(tDeadline < tGrace)) {
      errs.push(`submissionDeadlineAt (${schedule.submissionDeadlineAt}) must be strictly before graceEndsAt (${schedule.graceEndsAt})`);
    }
    if (!(tGrace <= tRunStarts)) {
      errs.push(`graceEndsAt (${schedule.graceEndsAt}) must be less than or equal to runStartsAt (${schedule.runStartsAt})`);
    }
    if (!(tRunStarts < tAppeal)) {
      errs.push(`runStartsAt (${schedule.runStartsAt}) must be strictly before appealEndsAt (${schedule.appealEndsAt})`);
    }
  }

  return {
    valid: errs.length === 0,
    errors: errs,
  };
}
