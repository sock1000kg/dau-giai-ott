import { describe, expect, it } from 'vitest';
import { estimateWorstCase, formatDuration } from './estimate.ts';
import {
  defaultFormState,
  formStateFromRules,
  formStateToRules,
  isoToVn,
  vnToIso,
  type RoundRuleSetRulesV1,
} from './rules-form.ts';

describe('RoundAdmin estimate helper', () => {
  it('reproduces section 10.4: 200 teams with concurrency 4 take 2 hours 5 minutes', () => {
    const estimate = estimateWorstCase({ teamCount: 200, concurrency: 4, matchWallClockMs: 150_000, runMaxHours: 48 });
    expect(estimate.series).toBe(100);
    expect(estimate.games).toBe(200);
    expect(estimate.waves).toBe(50);
    expect(formatDuration(estimate.worstMs)).toBe('2 giờ 5 phút');
    expect(estimate.exceedsWindow).toBe(false);
  });

  it('reproduces section 10.4: 200 teams with concurrency 2 take 4 hours 10 minutes', () => {
    const estimate = estimateWorstCase({ teamCount: 200, concurrency: 2, matchWallClockMs: 150_000, runMaxHours: 48 });
    expect(estimate.waves).toBe(100);
    expect(formatDuration(estimate.worstMs)).toBe('4 giờ 10 phút');
    expect(estimate.exceedsWindow).toBe(false);
  });

  it('rounds waves up and flags estimates beyond the run window', () => {
    const estimate = estimateWorstCase({ teamCount: 5, concurrency: 4, matchWallClockMs: 150_000, runMaxHours: 1 });
    expect(estimate.series).toBe(2);
    expect(estimate.games).toBe(4);
    expect(estimate.waves).toBe(1);
    expect(estimate.exceedsWindow).toBe(false);
    const over = estimateWorstCase({ teamCount: 200, concurrency: 1, matchWallClockMs: 150_000, runMaxHours: 1 });
    expect(over.waves).toBe(200);
    expect(over.exceedsWindow).toBe(true);
  });

  it('handles zero teams without waves', () => {
    const estimate = estimateWorstCase({ teamCount: 0, concurrency: 4, matchWallClockMs: 150_000, runMaxHours: 48 });
    expect(estimate).toMatchObject({ series: 0, games: 0, waves: 0, worstMs: 0, exceedsWindow: false });
  });
});

describe('RoundAdmin rules-form helper', () => {
  it('prefills the approved defaults and leaves unapproved fields empty', () => {
    const state = defaultFormState();
    expect(state).toMatchObject({
      startupMs: '5000',
      totalBotBudgetMs: '60000',
      baseMs: '1000',
      stepMs: '500',
      everyTurns: '40',
      maxMs: '3000',
      matchWallClockMs: '150000',
      archiveMiB: '512',
      unpackedMiB: '1024',
      maxLayers: '20',
      tmpfsMiB: '64',
      quotaPerTeamPerDay: '2',
      runMaxHours: '48',
      perTurnMode: 'DYNAMIC',
      opponentBtc: true,
      opponentOwn: true,
    });
    expect(state.memoryMiB).toBe('');
    expect(state.milliCpu).toBe('');
    expect(state.pids).toBe('');
    expect(state.engineVersion).toBe('');
    expect(state.faultPolicyVersion).toBe('');
    expect(state.submissionOpensAt).toBe('');
  });

  it('converts Asia/Ho_Chi_Minh datetime-local to ISO UTC and back', () => {
    expect(vnToIso('2026-10-18T14:00')).toBe('2026-10-18T07:00:00.000Z');
    expect(isoToVn('2026-10-18T07:00:00.000Z')).toBe('2026-10-18T14:00');
    expect(vnToIso('not-a-date')).toBeNull();
    expect(isoToVn('not-a-date')).toBeNull();
  });

  it('round-trips stored rules through form state', () => {
    const rules: RoundRuleSetRulesV1 = {
      schemaVersion: 'ott.round-rules.v1',
      engineVersion: '1.0.0',
      mapSet: [{ mapId: 'map-v1', checksum: 'a'.repeat(64) }],
      maxTurns: 200,
      faultPolicyVersion: 'P2_BASELINE_V1',
      timeControl: {
        startupMs: 5000,
        totalBotBudgetMs: 60000,
        matchWallClockMs: 150000,
        perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 },
      },
      resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
      schedule: {
        submissionOpensAt: '2026-10-14T07:00:00.000Z',
        submissionDeadlineAt: '2026-10-17T16:59:00.000Z',
        graceEndsAt: '2026-10-18T05:00:00.000Z',
        runStartsAt: '2026-10-18T07:00:00.000Z',
        runMaxHours: 48,
        appealEndsAt: '2026-10-21T05:00:00.000Z',
      },
      testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE', 'OWN_SUBMISSION'] },
    };
    const state = formStateFromRules(rules);
    expect(state.submissionOpensAt).toBe('2026-10-14T14:00');
    expect(state.runStartsAt).toBe('2026-10-18T14:00');
    const rebuilt = formStateToRules({ ...state, reason: 'round-trip' });
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) expect(rebuilt.rules).toEqual(rules);
  });

  it('reports client-side required and number errors without calling the server', () => {
    const result = formStateToRules({ ...defaultFormState(), startupMs: '', milliCpu: 'abc' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((entry) => entry.field)).toContain('engineVersion');
      expect(result.errors.map((entry) => entry.field)).toContain('startupMs');
      expect(result.errors.map((entry) => entry.field)).toContain('milliCpu');
    }
  });
});
