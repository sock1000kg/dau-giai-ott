import { createHash } from 'node:crypto';

export const ROUND_RULE_SET_SCHEMA_VERSION = 'ott.round-rules.v1' as const;

export type RoundStatus =
  | 'DRAFT_RULES'
  | 'SUBMISSION_OPEN'
  | 'SUBMISSION_CLOSED'
  | 'RUNNING'
  | 'SETTLING'
  | 'RATED'
  | 'PUBLISHED';

export type RoundAction =
  | { type: 'create' }
  | { type: 'open'; ruleSetId: string }
  | { type: 'close' }
  | { type: 'start'; ruleSetId: string; idempotencyKey: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reconcile' }
  | { type: 'publish' };

export interface RoundRuleSetRulesV1 {
  schemaVersion: typeof ROUND_RULE_SET_SCHEMA_VERSION;
  engineVersion: string;
  mapSet: { mapId: string; checksum: string }[];
  maxTurns: number;
  faultPolicyVersion: string;
  timeControl: {
    startupMs: number;
    totalBotBudgetMs: number;
    matchWallClockMs: number;
    perTurn:
      | { mode: 'FIXED'; fixedMs: number }
      | { mode: 'DYNAMIC'; baseMs: number; stepMs: number; everyTurns: number; maxMs: number };
  };
  resources: {
    memoryMiB: number;
    milliCpu: number;
    pids: number;
    tmpfsMiB: number;
    archiveMiB: number;
    unpackedMiB: number;
    maxLayers: number;
  };
  schedule: {
    submissionOpensAt: string;
    submissionDeadlineAt: string;
    graceEndsAt: string;
    runStartsAt: string;
    runMaxHours: number;
    appealEndsAt: string;
  };
  testRun: {
    quotaPerTeamPerDay: number;
    opponents: ('BTC_REFERENCE' | 'OWN_SUBMISSION')[];
  };
}

export interface ValidationError {
  readonly path: string;
  readonly code: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  const seen = new WeakSet<object>();

  function serialize(v: unknown): string {
    if (v === null) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('Non-finite number in canonical JSON');
      return String(v);
    }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (Array.isArray(v)) {
      if (seen.has(v)) throw new Error('Circular reference');
      seen.add(v);
      return '[' + v.map(serialize).join(',') + ']';
    }
    if (typeof v === 'object') {
      if (seen.has(v)) throw new Error('Circular reference');
      seen.add(v);
      const entries = Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => `${JSON.stringify(k)}:${serialize(val)}`);
      return '{' + entries.join(',') + '}';
    }
    throw new Error(`Unsupported type in canonical JSON: ${typeof v}`);
  }

  return serialize(value);
}

export function computeRulesSha256(rules: RoundRuleSetRulesV1): string {
  return sha256(canonicalJson(rules));
}

export function validateRoundRuleSetRules(rules: unknown): { readonly errors: readonly ValidationError[] } {
  const errors: ValidationError[] = [];

  function addError(path: string, code: string): void {
    errors.push({ path, code });
  }

  function checkType(obj: unknown, path: string, expectedType: string): obj is Record<string, unknown> {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      addError(path, 'TYPE_MISMATCH');
      return false;
    }
    return true;
  }

  function checkString(obj: unknown, path: string, pattern?: RegExp, minLen = 1, maxLen = 64): boolean {
    if (typeof obj !== 'string') {
      addError(path, 'TYPE_MISMATCH');
      return false;
    }
    if (obj.length < minLen || obj.length > maxLen) {
      addError(path, 'LENGTH_OUT_OF_RANGE');
      return false;
    }
    if (pattern && !pattern.test(obj)) {
      addError(path, 'PATTERN_MISMATCH');
      return false;
    }
    return true;
  }

  function checkNumber(obj: unknown, path: string, min: number, max: number, integer = true): boolean {
    if (typeof obj !== 'number' || !Number.isFinite(obj)) {
      addError(path, 'TYPE_MISMATCH');
      return false;
    }
    if (integer && !Number.isInteger(obj)) {
      addError(path, 'NOT_INTEGER');
      return false;
    }
    if (obj < min || obj > max) {
      addError(path, 'OUT_OF_RANGE');
      return false;
    }
    return true;
  }

  if (!checkType(rules, '', 'object')) return { errors };

  const r = rules as Record<string, unknown>;
  const allowedKeys = new Set([
    'schemaVersion', 'engineVersion', 'mapSet', 'maxTurns', 'faultPolicyVersion',
    'timeControl', 'resources', 'schedule', 'testRun'
  ]);

  for (const key of Object.keys(r)) {
    if (!allowedKeys.has(key)) {
      addError(key, 'UNKNOWN_FIELD');
    }
  }

  if (!checkString(r.schemaVersion, 'schemaVersion', undefined, 1, 64)) {
  } else if (r.schemaVersion !== ROUND_RULE_SET_SCHEMA_VERSION) {
    addError('schemaVersion', 'INVALID_SCHEMA_VERSION');
  }

  checkString(r.engineVersion, 'engineVersion', /^[A-Za-z0-9._+-]{1,64}$/);

  if (!Array.isArray(r.mapSet)) {
    addError('mapSet', 'TYPE_MISMATCH');
  } else {
    if (r.mapSet.length < 1 || r.mapSet.length > 16) {
      addError('mapSet', 'OUT_OF_RANGE');
    }
    const mapIds = new Set<string>();
    for (let i = 0; i < r.mapSet.length; i++) {
      const m = r.mapSet[i];
      if (!checkType(m, `mapSet[${i}]`, 'object')) continue;
      if (!checkString((m as Record<string, unknown>).mapId, `mapSet[${i}].mapId`, undefined, 1, 64)) continue;
      if (!checkString((m as Record<string, unknown>).checksum, `mapSet[${i}].checksum`, /^[0-9a-f]{64}$/)) continue;
      if (mapIds.has((m as Record<string, unknown>).mapId as string)) {
        addError(`mapSet[${i}].mapId`, 'DUPLICATE_MAP_ID');
      }
      mapIds.add((m as Record<string, unknown>).mapId as string);
    }
  }

  checkNumber(r.maxTurns, 'maxTurns', 1, 1000);

  checkString(r.faultPolicyVersion, 'faultPolicyVersion', /^[A-Za-z0-9._+-]{1,64}$/);

  if (!checkType(r.timeControl, 'timeControl', 'object')) {
  } else {
    const tc = r.timeControl as Record<string, unknown>;
    checkNumber(tc.startupMs, 'timeControl.startupMs', 1, 60000);
    checkNumber(tc.totalBotBudgetMs, 'timeControl.totalBotBudgetMs', 1, 3_600_000);
    checkNumber(tc.matchWallClockMs, 'timeControl.matchWallClockMs', 1, 7_200_000);

    if (!checkType(tc.perTurn, 'timeControl.perTurn', 'object')) {
    } else {
      const pt = tc.perTurn as Record<string, unknown>;
      if (!checkString(pt.mode, 'timeControl.perTurn.mode', undefined, 1, 32)) {
      } else if (pt.mode === 'FIXED') {
        checkNumber(pt.fixedMs, 'timeControl.perTurn.fixedMs', 1, 3_600_000);
        if (pt.fixedMs !== undefined && pt.fixedMs === 30000) {
          addError('timeControl.perTurn.fixedMs', 'FIXED_30S_NOT_ALLOWED_QUALIFICATION');
        }
        if (pt.fixedMs !== undefined && pt.fixedMs === 60000) {
          addError('timeControl.perTurn.fixedMs', 'FIXED_60S_NOT_ALLOWED_QUALIFICATION');
        }
      } else if (pt.mode === 'DYNAMIC') {
        checkNumber(pt.baseMs, 'timeControl.perTurn.baseMs', 1, 3_600_000);
        checkNumber(pt.stepMs, 'timeControl.perTurn.stepMs', 1, 3_600_000);
        checkNumber(pt.everyTurns, 'timeControl.perTurn.everyTurns', 1, 10000);
        checkNumber(pt.maxMs, 'timeControl.perTurn.maxMs', 1, 3_600_000);
        if ((pt.baseMs as number) > (pt.maxMs as number)) {
          addError('timeControl.perTurn.baseMs', 'BASE_EXCEEDS_MAX');
        }
        if ((pt.maxMs as number) > (tc.totalBotBudgetMs as number)) {
          addError('timeControl.perTurn.maxMs', 'MAX_EXCEEDS_TOTAL_BUDGET');
        }
      } else if (pt.mode === 'NONE') {
        addError('timeControl.perTurn.mode', 'NONE_NOT_ALLOWED_QUALIFICATION');
      } else {
        addError('timeControl.perTurn.mode', 'INVALID_MODE');
      }
      const allowedPerTurnKeys = new Set(['mode', 'fixedMs', 'baseMs', 'stepMs', 'everyTurns', 'maxMs']);
      for (const key of Object.keys(pt)) {
        if (!allowedPerTurnKeys.has(key)) {
          addError(`timeControl.perTurn.${key}`, 'UNKNOWN_FIELD');
        }
      }
    }

    const allowedTcKeys = new Set(['startupMs', 'totalBotBudgetMs', 'matchWallClockMs', 'perTurn']);
    for (const key of Object.keys(tc)) {
      if (!allowedTcKeys.has(key)) {
        addError(`timeControl.${key}`, 'UNKNOWN_FIELD');
      }
    }
  }

  if (!checkType(r.resources, 'resources', 'object')) {
  } else {
    const res = r.resources as Record<string, unknown>;
    checkNumber(res.memoryMiB, 'resources.memoryMiB', 1, 16384);
    checkNumber(res.milliCpu, 'resources.milliCpu', 1, 4000);
    checkNumber(res.pids, 'resources.pids', 1, 1024);
    checkNumber(res.tmpfsMiB, 'resources.tmpfsMiB', 1, 4096);
    checkNumber(res.archiveMiB, 'resources.archiveMiB', 1, 8192);
    checkNumber(res.unpackedMiB, 'resources.unpackedMiB', 1, 16384);
    checkNumber(res.maxLayers, 'resources.maxLayers', 1, 128);
    const allowedResKeys = new Set(['memoryMiB', 'milliCpu', 'pids', 'tmpfsMiB', 'archiveMiB', 'unpackedMiB', 'maxLayers']);
    for (const key of Object.keys(res)) {
      if (!allowedResKeys.has(key)) {
        addError(`resources.${key}`, 'UNKNOWN_FIELD');
      }
    }
  }

  if (!checkType(r.schedule, 'schedule', 'object')) {
  } else {
    const sch = r.schedule as Record<string, unknown>;
    const opens = checkString(sch.submissionOpensAt, 'schedule.submissionOpensAt', undefined, 1, 64);
    const deadline = checkString(sch.submissionDeadlineAt, 'schedule.submissionDeadlineAt', undefined, 1, 64);
    const grace = checkString(sch.graceEndsAt, 'schedule.graceEndsAt', undefined, 1, 64);
    const runStarts = checkString(sch.runStartsAt, 'schedule.runStartsAt', undefined, 1, 64);
    checkNumber(sch.runMaxHours, 'schedule.runMaxHours', 1, 168);
    const appeal = checkString(sch.appealEndsAt, 'schedule.appealEndsAt', undefined, 1, 64);

    if (opens && deadline && grace && runStarts && appeal) {
      const tOpens = new Date(sch.submissionOpensAt as string).getTime();
      const tDeadline = new Date(sch.submissionDeadlineAt as string).getTime();
      const tGrace = new Date(sch.graceEndsAt as string).getTime();
      const tRunStarts = new Date(sch.runStartsAt as string).getTime();
      const tAppeal = new Date(sch.appealEndsAt as string).getTime();

      if (isNaN(tOpens) || isNaN(tDeadline) || isNaN(tGrace) || isNaN(tRunStarts) || isNaN(tAppeal)) {
        addError('schedule', 'INVALID_ISO8601');
      } else {
        if (!(tOpens < tDeadline && tDeadline < tGrace && tGrace <= tRunStarts && tRunStarts < tAppeal)) {
          addError('schedule', 'ORDER_VIOLATION');
        }
      }
    }

    const allowedSchKeys = new Set(['submissionOpensAt', 'submissionDeadlineAt', 'graceEndsAt', 'runStartsAt', 'runMaxHours', 'appealEndsAt']);
    for (const key of Object.keys(sch)) {
      if (!allowedSchKeys.has(key)) {
        addError(`schedule.${key}`, 'UNKNOWN_FIELD');
      }
    }
  }

  if (!checkType(r.testRun, 'testRun', 'object')) {
  } else {
    const tr = r.testRun as Record<string, unknown>;
    checkNumber(tr.quotaPerTeamPerDay, 'testRun.quotaPerTeamPerDay', 0, 50);

    if (!Array.isArray(tr.opponents)) {
      addError('testRun.opponents', 'TYPE_MISMATCH');
    } else {
      if (tr.opponents.length < 1 || tr.opponents.length > 2) {
        addError('testRun.opponents', 'OUT_OF_RANGE');
      }
      const oppSet = new Set<string>();
      for (let i = 0; i < tr.opponents.length; i++) {
        const opp = tr.opponents[i];
        if (opp !== 'BTC_REFERENCE' && opp !== 'OWN_SUBMISSION') {
          addError(`testRun.opponents[${i}]`, 'INVALID_OPPONENT');
        }
        if (oppSet.has(opp as string)) {
          addError(`testRun.opponents[${i}]`, 'DUPLICATE_OPPONENT');
        }
        oppSet.add(opp as string);
      }
    }

    const allowedTrKeys = new Set(['quotaPerTeamPerDay', 'opponents']);
    for (const key of Object.keys(tr)) {
      if (!allowedTrKeys.has(key)) {
        addError(`testRun.${key}`, 'UNKNOWN_FIELD');
      }
    }
  }

  return { errors };
}

export const ALLOWED_TRANSITIONS: Readonly<Record<RoundStatus, Readonly<RoundAction['type'][]>>> = {
  DRAFT_RULES: ['open'],
  SUBMISSION_OPEN: ['close'],
  SUBMISSION_CLOSED: ['start'],
  RUNNING: ['pause', 'resume', 'reconcile'],
  SETTLING: ['reconcile'],
  RATED: ['publish'],
  PUBLISHED: [],
};

export function assertTransition(
  from: RoundStatus,
  action: RoundAction,
  options?: { readonly ruleSetIdMatches?: boolean; readonly now?: Date; readonly graceEndsAt?: string }
): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(action.type)) {
    throw new Error('ROUND_TRANSITION_INVALID');
  }

  if (action.type === 'open') {
    if (!action.ruleSetId || action.ruleSetId.length < 1) {
      throw new Error('ROUND_TRANSITION_INVALID');
    }
  }

  if (action.type === 'close') {
    if (!options?.graceEndsAt) {
      throw new Error('ROUND_TRANSITION_INVALID');
    }
    const now = options.now ?? new Date();
    if (now < new Date(options.graceEndsAt)) {
      throw new Error('ROUND_TRANSITION_INVALID');
    }
  }

  if (action.type === 'start') {
    if (!options?.ruleSetIdMatches) {
      throw new Error('ROUND_TRANSITION_INVALID');
    }
    if (!action.idempotencyKey || action.idempotencyKey.length < 1 || action.idempotencyKey.length > 200) {
      throw new Error('ROUND_TRANSITION_INVALID');
    }
  }

  if (action.type === 'reconcile') {
    if (from === 'RUNNING' && !options?.now) {
    }
  }

  if (['open', 'close', 'start', 'pause', 'resume', 'reconcile', 'publish'].includes(action.type)) {
  }
}