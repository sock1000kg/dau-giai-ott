import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canonicalJson,
  computeRulesSha256,
  validateRoundRuleSetRules,
  type RoundAction,
  type RoundRuleSetRulesV1,
  type RoundStatus,
} from '../src/modules/rounds/types.ts';

function validQualificationRules(): RoundRuleSetRulesV1 {
  return {
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
    resources: {
      memoryMiB: 256,
      milliCpu: 1000,
      pids: 64,
      tmpfsMiB: 64,
      archiveMiB: 512,
      unpackedMiB: 1024,
      maxLayers: 20,
    },
    schedule: {
      submissionOpensAt: '2026-10-14T14:00:00.000Z',
      submissionDeadlineAt: '2026-10-17T23:59:00.000Z',
      graceEndsAt: '2026-10-18T12:00:00.000Z',
      runStartsAt: '2026-10-18T14:00:00.000Z',
      runMaxHours: 48,
      appealEndsAt: '2026-10-21T12:00:00.000Z',
    },
    testRun: {
      quotaPerTeamPerDay: 2,
      opponents: ['BTC_REFERENCE'],
    },
  };
}

describe('P3-D01 round-rules unit', () => {
  it('accepts valid default qualification rules', () => {
    const result = validateRoundRuleSetRules(validQualificationRules());
    expect(result.errors).toEqual([]);
  });

  it('rejects unknown top-level keys', () => {
    const rules = { ...validQualificationRules(), extraField: true };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'extraField', code: 'UNKNOWN_FIELD' });
  });

  it('rejects wrong schemaVersion', () => {
    const rules = { ...validQualificationRules(), schemaVersion: 'wrong' };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'schemaVersion', code: 'INVALID_SCHEMA_VERSION' });
  });

  it('rejects invalid engineVersion pattern', () => {
    const rules = { ...validQualificationRules(), engineVersion: 'bad version!' };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'engineVersion', code: 'PATTERN_MISMATCH' });
  });

  it('rejects empty mapSet', () => {
    const rules = { ...validQualificationRules(), mapSet: [] };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'mapSet', code: 'OUT_OF_RANGE' });
  });

  it('rejects duplicate mapId', () => {
    const rules = {
      ...validQualificationRules(),
      mapSet: [
        { mapId: 'map-v1', checksum: 'a'.repeat(64) },
        { mapId: 'map-v1', checksum: 'b'.repeat(64) },
      ],
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'mapSet[1].mapId', code: 'DUPLICATE_MAP_ID' });
  });

  it('rejects invalid checksum format', () => {
    const rules = { ...validQualificationRules(), mapSet: [{ mapId: 'map-v1', checksum: 'not-hex' }] };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'mapSet[0].checksum', code: 'PATTERN_MISMATCH' });
  });

  it('rejects maxTurns out of range', () => {
    const rules = { ...validQualificationRules(), maxTurns: 0 };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'maxTurns', code: 'OUT_OF_RANGE' });
  });

  it('rejects perTurn NONE mode for qualification', () => {
    const rules = {
      ...validQualificationRules(),
      timeControl: {
        startupMs: 5000,
        totalBotBudgetMs: 60000,
        matchWallClockMs: 150000,
        perTurn: { mode: 'NONE' as const },
      },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'timeControl.perTurn.mode', code: 'NONE_NOT_ALLOWED_QUALIFICATION' });
  });

  it('rejects FIXED 30s for qualification', () => {
    const rules = {
      ...validQualificationRules(),
      timeControl: {
        startupMs: 5000,
        totalBotBudgetMs: 60000,
        matchWallClockMs: 150000,
        perTurn: { mode: 'FIXED' as const, fixedMs: 30000 },
      },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'timeControl.perTurn.fixedMs', code: 'FIXED_30S_NOT_ALLOWED_QUALIFICATION' });
  });

  it('rejects FIXED 60s for qualification', () => {
    const rules = {
      ...validQualificationRules(),
      timeControl: {
        startupMs: 5000,
        totalBotBudgetMs: 60000,
        matchWallClockMs: 150000,
        perTurn: { mode: 'FIXED' as const, fixedMs: 60000 },
      },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'timeControl.perTurn.fixedMs', code: 'FIXED_60S_NOT_ALLOWED_QUALIFICATION' });
  });

  it('rejects DYNAMIC baseMs > maxMs', () => {
    const rules = {
      ...validQualificationRules(),
      timeControl: {
        startupMs: 5000,
        totalBotBudgetMs: 60000,
        matchWallClockMs: 150000,
        perTurn: { mode: 'DYNAMIC' as const, baseMs: 5000, stepMs: 500, everyTurns: 40, maxMs: 3000 },
      },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'timeControl.perTurn.baseMs', code: 'BASE_EXCEEDS_MAX' });
  });

  it('rejects DYNAMIC maxMs > totalBotBudgetMs', () => {
    const rules = {
      ...validQualificationRules(),
      timeControl: {
        startupMs: 5000,
        totalBotBudgetMs: 60000,
        matchWallClockMs: 150000,
        perTurn: { mode: 'DYNAMIC' as const, baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 70000 },
      },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'timeControl.perTurn.maxMs', code: 'MAX_EXCEEDS_TOTAL_BUDGET' });
  });

  it('rejects schedule order violation', () => {
    const rules = {
      ...validQualificationRules(),
      schedule: {
        submissionOpensAt: '2026-10-14T14:00:00.000Z',
        submissionDeadlineAt: '2026-10-13T23:59:00.000Z',
        graceEndsAt: '2026-10-18T12:00:00.000Z',
        runStartsAt: '2026-10-18T14:00:00.000Z',
        runMaxHours: 48,
        appealEndsAt: '2026-10-21T12:00:00.000Z',
      },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'schedule', code: 'ORDER_VIOLATION' });
  });

  it('rejects invalid ISO-8601 schedule', () => {
    const rules = {
      ...validQualificationRules(),
      schedule: {
        submissionOpensAt: 'not-a-date',
        submissionDeadlineAt: '2026-10-17T23:59:00.000Z',
        graceEndsAt: '2026-10-18T12:00:00.000Z',
        runStartsAt: '2026-10-18T14:00:00.000Z',
        runMaxHours: 48,
        appealEndsAt: '2026-10-21T12:00:00.000Z',
      },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'schedule', code: 'INVALID_ISO8601' });
  });

  it('rejects unknown resource keys', () => {
    const rules = {
      ...validQualificationRules(),
      resources: { ...validQualificationRules().resources, unknownRes: 100 },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'resources.unknownRes', code: 'UNKNOWN_FIELD' });
  });

  it('rejects unknown timeControl keys', () => {
    const rules = {
      ...validQualificationRules(),
      timeControl: { ...validQualificationRules().timeControl, unknownTC: true },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'timeControl.unknownTC', code: 'UNKNOWN_FIELD' });
  });

  it('rejects unknown testRun keys', () => {
    const rules = {
      ...validQualificationRules(),
      testRun: { ...validQualificationRules().testRun, unknownTR: 'bad' },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'testRun.unknownTR', code: 'UNKNOWN_FIELD' });
  });

  it('rejects invalid opponent value', () => {
    const rules = {
      ...validQualificationRules(),
      testRun: { quotaPerTeamPerDay: 2, opponents: ['INVALID_OPPONENT' as 'BTC_REFERENCE'] },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'testRun.opponents[0]', code: 'INVALID_OPPONENT' });
  });

  it('rejects duplicate opponents', () => {
    const rules = {
      ...validQualificationRules(),
      testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE', 'BTC_REFERENCE'] as ('BTC_REFERENCE' | 'OWN_SUBMISSION')[] },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'testRun.opponents[1]', code: 'DUPLICATE_OPPONENT' });
  });

  it('rejects non-integer maxTurns', () => {
    const rules = { ...validQualificationRules(), maxTurns: 100.5 };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'maxTurns', code: 'NOT_INTEGER' });
  });

  it('rejects runMaxHours out of range', () => {
    const rules = {
      ...validQualificationRules(),
      schedule: { ...validQualificationRules().schedule, runMaxHours: 200 },
    };
    const result = validateRoundRuleSetRules(rules);
    expect(result.errors).toContainEqual({ path: 'schedule.runMaxHours', code: 'OUT_OF_RANGE' });
  });

  it('computes deterministic sha256 of canonical JSON', () => {
    const rules = validQualificationRules();
    const sha1 = computeRulesSha256(rules);
    const sha2 = computeRulesSha256(rules);
    expect(sha1).toBe(sha2);
    expect(sha1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonicalJson sorts keys recursively', () => {
    const obj1 = { b: 1, a: { d: 2, c: 3 } };
    const obj2 = { a: { c: 3, d: 2 }, b: 1 };
    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
  });

  it('transition table allows only valid edges', () => {
    const validEdges: [RoundStatus, RoundAction['type']][] = [
      ['DRAFT_RULES', 'open'],
      ['SUBMISSION_OPEN', 'close'],
      ['SUBMISSION_CLOSED', 'start'],
      ['RUNNING', 'pause'],
      ['RUNNING', 'resume'],
      ['RUNNING', 'reconcile'],
      ['SETTLING', 'reconcile'],
      ['RATED', 'publish'],
      ['DRAFT_RULES', 'cancel'],
      ['SUBMISSION_OPEN', 'cancel'],
      ['SUBMISSION_CLOSED', 'cancel'],
    ];
    for (const [from, action] of validEdges) {
      const actionObj: RoundAction = action === 'open'
        ? { type: 'open', ruleSetId: 'test' }
        : action === 'start'
          ? { type: 'start', ruleSetId: 'test', idempotencyKey: 'key' }
          : { type: action };
      const options = action === 'close'
        ? { graceEndsAt: '2020-01-01T00:00:00.000Z', now: new Date('2026-10-18T13:00:00.000Z') }
        : action === 'start'
          ? { ruleSetIdMatches: true }
          : undefined;
      expect(() => assertTransition(from, actionObj, options)).not.toThrow();
    }

    const invalidEdges: [RoundStatus, RoundAction['type']][] = [
      ['DRAFT_RULES', 'close'],
      ['DRAFT_RULES', 'start'],
      ['SUBMISSION_OPEN', 'start'],
      ['SUBMISSION_CLOSED', 'pause'],
      ['RUNNING', 'publish'],
      ['SETTLING', 'publish'],
      ['RATED', 'pause'],
      ['PUBLISHED', 'open'],
      ['RUNNING', 'cancel'],
      ['SETTLING', 'cancel'],
      ['RATED', 'cancel'],
      ['PUBLISHED', 'cancel'],
      ['CANCELLED', 'open'],
      ['CANCELLED', 'cancel'],
    ];
    for (const [from, action] of invalidEdges) {
      const actionObj: RoundAction = action === 'open'
        ? { type: 'open', ruleSetId: 'test' }
        : action === 'start'
          ? { type: 'start', ruleSetId: 'test', idempotencyKey: 'key' }
          : { type: action };
      expect(() => assertTransition(from, actionObj)).toThrow('ROUND_TRANSITION_INVALID');
    }
  });

  it('assertTransition validates close grace period', () => {
    const graceEndsAt = '2026-10-18T12:00:00.000Z';
    expect(() => assertTransition('SUBMISSION_OPEN', { type: 'close' }, { graceEndsAt, now: new Date('2026-10-18T11:00:00.000Z') })).toThrow('ROUND_TRANSITION_INVALID');
    expect(() => assertTransition('SUBMISSION_OPEN', { type: 'close' }, { graceEndsAt, now: new Date('2026-10-18T13:00:00.000Z') })).not.toThrow();
  });

  it('assertTransition validates start ruleSetId match', () => {
    expect(() => assertTransition('SUBMISSION_CLOSED', { type: 'start', ruleSetId: 'a', idempotencyKey: 'key' }, { ruleSetIdMatches: false })).toThrow('ROUND_TRANSITION_INVALID');
    expect(() => assertTransition('SUBMISSION_CLOSED', { type: 'start', ruleSetId: 'a', idempotencyKey: 'key' }, { ruleSetIdMatches: true })).not.toThrow();
  });

  it('ALLOWED_TRANSITIONS matches expected edges', () => {
    expect(ALLOWED_TRANSITIONS.DRAFT_RULES).toEqual(['open', 'cancel']);
    expect(ALLOWED_TRANSITIONS.SUBMISSION_OPEN).toEqual(['close', 'cancel']);
    expect(ALLOWED_TRANSITIONS.SUBMISSION_CLOSED).toEqual(['start', 'cancel']);
    expect(ALLOWED_TRANSITIONS.RUNNING).toEqual(['pause', 'resume', 'reconcile']);
    expect(ALLOWED_TRANSITIONS.SETTLING).toEqual(['reconcile']);
    expect(ALLOWED_TRANSITIONS.RATED).toEqual(['publish']);
    expect(ALLOWED_TRANSITIONS.PUBLISHED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.CANCELLED).toEqual([]);
  });
});