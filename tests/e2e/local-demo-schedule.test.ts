import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRACE_WINDOW_SECONDS,
  DEFAULT_SUBMISSION_WINDOW_SECONDS,
  DEMO_E2E_MAX_WAIT_TO_CLOSE_MS,
  buildDemoRuleSetSchedule,
  resolveSubmissionWindowSeconds,
  validateScheduleOrdering,
} from './local-demo-schedule.js';

describe('Local Demo E2E Schedule Builder (Docker-free)', () => {
  it('satisfies rounds/types.ts:284 strict chronological ordering', () => {
    const fixedNow = 1770000000000;
    const { schedule, timestamps } = buildDemoRuleSetSchedule({ nowMs: fixedNow });

    const validation = validateScheduleOrdering(schedule);
    expect(validation.valid, `Validation failed: ${validation.errors.join(', ')}`).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Verify ordering relations explicitly: opens < deadline < grace <= runStarts < appeal
    expect(timestamps.opensMs).toBeLessThan(timestamps.deadlineMs);
    expect(timestamps.deadlineMs).toBeLessThan(timestamps.graceMs);
    expect(timestamps.graceMs).toBeLessThanOrEqual(timestamps.runStartsMs);
    expect(timestamps.runStartsMs).toBeLessThan(timestamps.appealMs);
  });

  it('keeps grace - now bounded and aligned with step e wait budget', () => {
    const fixedNow = 1770000000000;
    const submissionWindow = 75;
    const graceWindow = 5;
    const { timestamps, maxWaitToCloseMs } = buildDemoRuleSetSchedule({
      nowMs: fixedNow,
      submissionWindowSeconds: submissionWindow,
      graceWindowSeconds: graceWindow,
    });

    const expectedElapsedMs = (submissionWindow + graceWindow) * 1000; // 80,000 ms
    expect(timestamps.graceMs - fixedNow).toBe(expectedElapsedMs);
    expect(maxWaitToCloseMs).toBe(expectedElapsedMs);

    // Ensure step e wait budget is never exceeded by default
    expect(maxWaitToCloseMs).toBeLessThanOrEqual(DEMO_E2E_MAX_WAIT_TO_CLOSE_MS);
  });

  it('provides sufficient margin (D seconds) for reservations and uploads before grace', () => {
    const fixedNow = 1770000000000;
    const { timestamps, submissionWindowSeconds, graceWindowSeconds } = buildDemoRuleSetSchedule({
      nowMs: fixedNow,
    });

    // Reservations must complete before deadline
    expect(timestamps.deadlineMs - fixedNow).toBe(submissionWindowSeconds * 1000);
    expect(submissionWindowSeconds).toBeGreaterThanOrEqual(60);

    // Uploads must complete before grace, giving graceWindowSeconds additional buffer
    expect(timestamps.graceMs - timestamps.deadlineMs).toBe(graceWindowSeconds * 1000);
    expect(graceWindowSeconds).toBe(DEFAULT_GRACE_WINDOW_SECONDS);
  });

  it('respects OTT_E2E_SUBMISSION_WINDOW_SECONDS environment override', () => {
    const origEnv = process.env.OTT_E2E_SUBMISSION_WINDOW_SECONDS;
    try {
      process.env.OTT_E2E_SUBMISSION_WINDOW_SECONDS = '90';
      expect(resolveSubmissionWindowSeconds(process.env.OTT_E2E_SUBMISSION_WINDOW_SECONDS)).toBe(90);

      const { schedule, submissionWindowSeconds } = buildDemoRuleSetSchedule();
      expect(submissionWindowSeconds).toBe(90);

      const validation = validateScheduleOrdering(schedule);
      expect(validation.valid).toBe(true);
    } finally {
      if (origEnv !== undefined) {
        process.env.OTT_E2E_SUBMISSION_WINDOW_SECONDS = origEnv;
      } else {
        delete process.env.OTT_E2E_SUBMISSION_WINDOW_SECONDS;
      }
    }
  });

  it('falls back cleanly to default 75s when env override is absent, invalid, or non-positive', () => {
    expect(resolveSubmissionWindowSeconds(undefined)).toBe(DEFAULT_SUBMISSION_WINDOW_SECONDS);
    expect(resolveSubmissionWindowSeconds('')).toBe(DEFAULT_SUBMISSION_WINDOW_SECONDS);
    expect(resolveSubmissionWindowSeconds('not-a-number')).toBe(DEFAULT_SUBMISSION_WINDOW_SECONDS);
    expect(resolveSubmissionWindowSeconds('0')).toBe(DEFAULT_SUBMISSION_WINDOW_SECONDS);
    expect(resolveSubmissionWindowSeconds('-10')).toBe(DEFAULT_SUBMISSION_WINDOW_SECONDS);
  });
});
