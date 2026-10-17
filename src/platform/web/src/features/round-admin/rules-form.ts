export const ROUND_RULES_SCHEMA_VERSION = 'ott.round-rules.v1' as const;

export interface MapRow {
  readonly mapId: string;
  readonly checksum: string;
}

export interface RoundRuleFormState {
  readonly startupMs: string;
  readonly totalBotBudgetMs: string;
  readonly matchWallClockMs: string;
  readonly perTurnMode: 'FIXED' | 'DYNAMIC';
  readonly fixedMs: string;
  readonly baseMs: string;
  readonly stepMs: string;
  readonly everyTurns: string;
  readonly maxMs: string;
  readonly memoryMiB: string;
  readonly milliCpu: string;
  readonly pids: string;
  readonly tmpfsMiB: string;
  readonly archiveMiB: string;
  readonly unpackedMiB: string;
  readonly maxLayers: string;
  readonly engineVersion: string;
  readonly maxTurns: string;
  readonly faultPolicyVersion: string;
  readonly maps: readonly MapRow[];
  readonly submissionOpensAt: string;
  readonly submissionDeadlineAt: string;
  readonly graceEndsAt: string;
  readonly runStartsAt: string;
  readonly runMaxHours: string;
  readonly appealEndsAt: string;
  readonly quotaPerTeamPerDay: string;
  readonly opponentBtc: boolean;
  readonly opponentOwn: boolean;
  readonly reason: string;
}

export interface RoundRuleSetRulesV1 {
  readonly schemaVersion: typeof ROUND_RULES_SCHEMA_VERSION;
  readonly engineVersion: string;
  readonly mapSet: readonly { readonly mapId: string; readonly checksum: string }[];
  readonly maxTurns: number;
  readonly faultPolicyVersion: string;
  readonly timeControl: {
    readonly startupMs: number;
    readonly totalBotBudgetMs: number;
    readonly matchWallClockMs: number;
    readonly perTurn:
      | { readonly mode: 'FIXED'; readonly fixedMs: number }
      | { readonly mode: 'DYNAMIC'; readonly baseMs: number; readonly stepMs: number; readonly everyTurns: number; readonly maxMs: number };
  };
  readonly resources: {
    readonly memoryMiB: number;
    readonly milliCpu: number;
    readonly pids: number;
    readonly tmpfsMiB: number;
    readonly archiveMiB: number;
    readonly unpackedMiB: number;
    readonly maxLayers: number;
  };
  readonly schedule: {
    readonly submissionOpensAt: string;
    readonly submissionDeadlineAt: string;
    readonly graceEndsAt: string;
    readonly runStartsAt: string;
    readonly runMaxHours: number;
    readonly appealEndsAt: string;
  };
  readonly testRun: {
    readonly quotaPerTeamPerDay: number;
    readonly opponents: readonly ('BTC_REFERENCE' | 'OWN_SUBMISSION')[];
  };
}

const VN_OFFSET_MS = 7 * 3_600_000;

export function vnToIso(vn: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(vn);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (![year, month, day, hour, minute].every(Number.isSafeInteger)) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - VN_OFFSET_MS;
  if (Number.isNaN(utc)) return null;
  return new Date(utc).toISOString();
}

export function isoToVn(iso: string): string | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  const vn = new Date(parsed + VN_OFFSET_MS);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}T${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`;
}

export function defaultFormState(): RoundRuleFormState {
  return {
    startupMs: '5000',
    totalBotBudgetMs: '60000',
    matchWallClockMs: '150000',
    perTurnMode: 'DYNAMIC',
    fixedMs: '3000',
    baseMs: '1000',
    stepMs: '500',
    everyTurns: '40',
    maxMs: '3000',
    memoryMiB: '',
    milliCpu: '',
    pids: '',
    tmpfsMiB: '64',
    archiveMiB: '512',
    unpackedMiB: '1024',
    maxLayers: '20',
    engineVersion: '',
    maxTurns: '',
    faultPolicyVersion: '',
    maps: [{ mapId: '', checksum: '' }],
    submissionOpensAt: '',
    submissionDeadlineAt: '',
    graceEndsAt: '',
    runStartsAt: '',
    runMaxHours: '48',
    appealEndsAt: '',
    quotaPerTeamPerDay: '2',
    opponentBtc: true,
    opponentOwn: true,
    reason: '',
  };
}

export function formStateFromRules(rules: RoundRuleSetRulesV1): RoundRuleFormState {
  const base = defaultFormState();
  const perTurn = rules.timeControl.perTurn;
  return {
    ...base,
    startupMs: String(rules.timeControl.startupMs),
    totalBotBudgetMs: String(rules.timeControl.totalBotBudgetMs),
    matchWallClockMs: String(rules.timeControl.matchWallClockMs),
    perTurnMode: perTurn.mode,
    fixedMs: perTurn.mode === 'FIXED' ? String(perTurn.fixedMs) : base.fixedMs,
    baseMs: perTurn.mode === 'DYNAMIC' ? String(perTurn.baseMs) : base.baseMs,
    stepMs: perTurn.mode === 'DYNAMIC' ? String(perTurn.stepMs) : base.stepMs,
    everyTurns: perTurn.mode === 'DYNAMIC' ? String(perTurn.everyTurns) : base.everyTurns,
    maxMs: perTurn.mode === 'DYNAMIC' ? String(perTurn.maxMs) : base.maxMs,
    memoryMiB: String(rules.resources.memoryMiB),
    milliCpu: String(rules.resources.milliCpu),
    pids: String(rules.resources.pids),
    tmpfsMiB: String(rules.resources.tmpfsMiB),
    archiveMiB: String(rules.resources.archiveMiB),
    unpackedMiB: String(rules.resources.unpackedMiB),
    maxLayers: String(rules.resources.maxLayers),
    engineVersion: rules.engineVersion,
    maxTurns: String(rules.maxTurns),
    faultPolicyVersion: rules.faultPolicyVersion,
    maps: rules.mapSet.map((entry) => ({ mapId: entry.mapId, checksum: entry.checksum })),
    submissionOpensAt: isoToVn(rules.schedule.submissionOpensAt) ?? '',
    submissionDeadlineAt: isoToVn(rules.schedule.submissionDeadlineAt) ?? '',
    graceEndsAt: isoToVn(rules.schedule.graceEndsAt) ?? '',
    runStartsAt: isoToVn(rules.schedule.runStartsAt) ?? '',
    runMaxHours: String(rules.schedule.runMaxHours),
    appealEndsAt: isoToVn(rules.schedule.appealEndsAt) ?? '',
    quotaPerTeamPerDay: String(rules.testRun.quotaPerTeamPerDay),
    opponentBtc: rules.testRun.opponents.includes('BTC_REFERENCE'),
    opponentOwn: rules.testRun.opponents.includes('OWN_SUBMISSION'),
  };
}

export interface ClientFieldError {
  readonly field: string;
  readonly message: string;
}

export type FormToRulesResult =
  | { readonly ok: true; readonly rules: RoundRuleSetRulesV1 }
  | { readonly ok: false; readonly errors: readonly ClientFieldError[] };

function parseInteger(raw: string, field: string, errors: ClientFieldError[]): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    errors.push({ field, message: 'Bắt buộc nhập.' });
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    errors.push({ field, message: 'Phải là số nguyên.' });
    return null;
  }
  return value;
}

function parseRequired(raw: string, field: string, errors: ClientFieldError[]): string | null {
  if (raw.trim().length === 0) {
    errors.push({ field, message: 'Bắt buộc nhập.' });
    return null;
  }
  return raw.trim();
}

function parseDateTime(raw: string, field: string, errors: ClientFieldError[]): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    errors.push({ field, message: 'Bắt buộc nhập.' });
    return null;
  }
  const iso = vnToIso(trimmed);
  if (iso === null) {
    errors.push({ field, message: 'Ngày giờ không hợp lệ.' });
    return null;
  }
  return iso;
}

export function formStateToRules(state: RoundRuleFormState): FormToRulesResult {
  const errors: ClientFieldError[] = [];
  const startupMs = parseInteger(state.startupMs, 'startupMs', errors);
  const totalBotBudgetMs = parseInteger(state.totalBotBudgetMs, 'totalBotBudgetMs', errors);
  const matchWallClockMs = parseInteger(state.matchWallClockMs, 'matchWallClockMs', errors);
  const memoryMiB = parseInteger(state.memoryMiB, 'memoryMiB', errors);
  const milliCpu = parseInteger(state.milliCpu, 'milliCpu', errors);
  const pids = parseInteger(state.pids, 'pids', errors);
  const tmpfsMiB = parseInteger(state.tmpfsMiB, 'tmpfsMiB', errors);
  const archiveMiB = parseInteger(state.archiveMiB, 'archiveMiB', errors);
  const unpackedMiB = parseInteger(state.unpackedMiB, 'unpackedMiB', errors);
  const maxLayers = parseInteger(state.maxLayers, 'maxLayers', errors);
  const engineVersion = parseRequired(state.engineVersion, 'engineVersion', errors);
  const maxTurns = parseInteger(state.maxTurns, 'maxTurns', errors);
  const faultPolicyVersion = parseRequired(state.faultPolicyVersion, 'faultPolicyVersion', errors);
  const submissionOpensAt = parseDateTime(state.submissionOpensAt, 'submissionOpensAt', errors);
  const submissionDeadlineAt = parseDateTime(state.submissionDeadlineAt, 'submissionDeadlineAt', errors);
  const graceEndsAt = parseDateTime(state.graceEndsAt, 'graceEndsAt', errors);
  const runStartsAt = parseDateTime(state.runStartsAt, 'runStartsAt', errors);
  const runMaxHours = parseInteger(state.runMaxHours, 'runMaxHours', errors);
  const appealEndsAt = parseDateTime(state.appealEndsAt, 'appealEndsAt', errors);
  const quotaPerTeamPerDay = parseInteger(state.quotaPerTeamPerDay, 'quotaPerTeamPerDay', errors);

  let fixedMs: number | null = null;
  let baseMs: number | null = null;
  let stepMs: number | null = null;
  let everyTurns: number | null = null;
  let maxMs: number | null = null;
  if (state.perTurnMode === 'FIXED') {
    fixedMs = parseInteger(state.fixedMs, 'fixedMs', errors);
  } else {
    baseMs = parseInteger(state.baseMs, 'baseMs', errors);
    stepMs = parseInteger(state.stepMs, 'stepMs', errors);
    everyTurns = parseInteger(state.everyTurns, 'everyTurns', errors);
    maxMs = parseInteger(state.maxMs, 'maxMs', errors);
  }

  const maps = state.maps
    .map((row) => ({ mapId: row.mapId.trim(), checksum: row.checksum.trim() }))
    .filter((row) => row.mapId.length > 0 || row.checksum.length > 0);
  if (maps.length === 0) {
    errors.push({ field: 'maps', message: 'Cần ít nhất một map.' });
  } else {
    maps.forEach((row, index) => {
      if (row.mapId.length === 0) errors.push({ field: `maps[${index}].mapId`, message: 'Bắt buộc nhập.' });
      if (row.checksum.length === 0) errors.push({ field: `maps[${index}].checksum`, message: 'Bắt buộc nhập.' });
    });
  }

  const opponents: ('BTC_REFERENCE' | 'OWN_SUBMISSION')[] = [];
  if (state.opponentBtc) opponents.push('BTC_REFERENCE');
  if (state.opponentOwn) opponents.push('OWN_SUBMISSION');

  if (
    startupMs === null || totalBotBudgetMs === null || matchWallClockMs === null
    || memoryMiB === null || milliCpu === null || pids === null || tmpfsMiB === null
    || archiveMiB === null || unpackedMiB === null || maxLayers === null
    || engineVersion === null || maxTurns === null || faultPolicyVersion === null
    || submissionOpensAt === null || submissionDeadlineAt === null || graceEndsAt === null
    || runStartsAt === null || runMaxHours === null || appealEndsAt === null
    || quotaPerTeamPerDay === null
    || (state.perTurnMode === 'FIXED' ? fixedMs === null : baseMs === null || stepMs === null || everyTurns === null || maxMs === null)
    || maps.length === 0 || maps.some((row) => row.mapId.length === 0 || row.checksum.length === 0)
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    rules: {
      schemaVersion: ROUND_RULES_SCHEMA_VERSION,
      engineVersion,
      mapSet: maps,
      maxTurns,
      faultPolicyVersion,
      timeControl: {
        startupMs,
        totalBotBudgetMs,
        matchWallClockMs,
        perTurn: state.perTurnMode === 'FIXED'
          ? { mode: 'FIXED', fixedMs: fixedMs as number }
          : { mode: 'DYNAMIC', baseMs: baseMs as number, stepMs: stepMs as number, everyTurns: everyTurns as number, maxMs: maxMs as number },
      },
      resources: { memoryMiB, milliCpu, pids, tmpfsMiB, archiveMiB, unpackedMiB, maxLayers },
      schedule: { submissionOpensAt, submissionDeadlineAt, graceEndsAt, runStartsAt, runMaxHours, appealEndsAt },
      testRun: { quotaPerTeamPerDay, opponents },
    },
  };
}
