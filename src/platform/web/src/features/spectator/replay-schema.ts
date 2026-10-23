export type ReplaySide = 'X' | 'O';
export type ReplayPosition = Readonly<{ col: number; row: number }>;
export type ReplayAction = Readonly<{ pieceId: string; to: ReplayPosition }>;

export interface SpectatorMapV1 {
  readonly schemaVersion: 1;
  readonly mapId: string;
  readonly version: number;
  readonly checksum: string;
  readonly width: 9;
  readonly height: 9;
  readonly obstacles: readonly ReplayPosition[];
  readonly spawns: readonly Readonly<{ id: string; owner: ReplaySide; type: 'ROCK' | 'PAPER' | 'SCISSORS'; position: ReplayPosition }>[];
  readonly goals: Readonly<Record<ReplaySide, ReplayPosition>>;
}

export type ReplaySkipReason =
  | 'NO_LEGAL_ACTION' | 'BOT_TIMEOUT' | 'MALFORMED_JSON' | 'SCHEMA_VIOLATION'
  | 'MATCH_ID_MISMATCH' | 'TURN_ID_MISMATCH' | 'MESSAGE_TOO_LARGE' | 'ILLEGAL_ACTION';
export type ReplayResultReason = 'REACHED_GOAL' | 'ELIMINATED_ALL_PIECES' | 'FORFEIT' | 'TURN_LIMIT';
export type ReplayFaultCode = 'BOT_SPAWN_FAILED' | 'BOT_CRASHED' | 'BOT_EOF' | 'STDERR_LIMIT_EXCEEDED' | 'RESOURCE_LIMIT_EXCEEDED' | 'SANDBOX_VIOLATION';

export type ReplayInput =
  | Readonly<{ kind: 'apply'; side: ReplaySide; action: ReplayAction }>
  | Readonly<{ kind: 'skip'; side: ReplaySide; reason: ReplaySkipReason }>
  | Readonly<{ kind: 'forfeit'; side: ReplaySide; fault: ReplayFaultCode | ReplaySkipReason }>;

export interface SpectatorReplayEntryV1 {
  readonly index: number;
  readonly input: ReplayInput;
  readonly events: readonly Readonly<{
    sequence: number;
    revision: number;
    turnId: number;
    type: 'ACTION_APPLIED' | 'TURN_SKIPPED' | 'MATCH_FINISHED';
    side: ReplaySide;
    action: ReplayAction | null;
    reason: ReplaySkipReason | ReplayResultReason | null;
  }>[];
  readonly revision: number;
  readonly stateHash: string;
}

export interface SpectatorReplayV1 {
  readonly schema: 'ott.spectator-replay';
  readonly schemaVersion: 1;
  readonly matchId: string;
  readonly header: Readonly<{
    format: 'ott.match-event-log';
    formatVersion: 1;
    matchId: string;
    protocolVersion: 1;
    engineVersion: string;
    game: Readonly<{ engineVersion: string; maxTurns: number; map: SpectatorMapV1 }>;
  }>;
  readonly entries: readonly SpectatorReplayEntryV1[];
  readonly result: Readonly<{
    winnerSide: ReplaySide | null;
    reason: ReplayResultReason;
    turnCount: number;
    forfeitedSide: ReplaySide | null;
    finalStateHash: string;
  }>;
  readonly faults: Readonly<Record<ReplaySide, Readonly<{
    recoverableTotal: number;
    recoverableConsecutive: number;
    lastErrorCode: string | null;
  }>>>;
}

export type SpectatorPerTurnPolicyV2 =
  | Readonly<{ mode: 'FIXED'; fixedMs: number }>
  | Readonly<{ mode: 'DYNAMIC'; baseMs: number; stepMs: number; everyTurns: number; maxMs: number }>
  | Readonly<{ mode: 'NONE' }>;

export interface SpectatorTimeControlV2 {
  readonly startupMs: number;
  readonly totalBotBudgetMs: number;
  readonly matchWallClockMs: number;
  readonly perTurn: SpectatorPerTurnPolicyV2;
}

export type SpectatorTimingExhaustion = 'TURN_LIMIT' | 'BOT_BUDGET' | 'WALL_CLOCK';

export interface SpectatorTimingDecision {
  readonly turnId: number;
  readonly side: ReplaySide;
  readonly turnLimitMs: number | null;
  readonly deadlineMs: number;
  readonly remainingBeforeMs: number;
  readonly wallElapsedBeforeMs: number;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
  readonly chargedMs: number;
  readonly remainingAfterMs: number;
  readonly exhaustion: SpectatorTimingExhaustion | null;
}

export interface SpectatorReplayV2 {
  readonly schema: 'ott.spectator-replay';
  readonly schemaVersion: 2;
  readonly matchId: string;
  readonly header: Readonly<{
    format: 'ott.match-event-log';
    formatVersion: 2;
    matchId: string;
    protocolVersion: 2;
    engineVersion: string;
    game: Readonly<{ engineVersion: string; maxTurns: number; map: SpectatorMapV1 }>;
    limits: Readonly<{ timeControl: SpectatorTimeControlV2 }>;
  }>;
  /** Team display names (names only); absent on artifacts that could not resolve them. */
  readonly teams?: Readonly<Record<ReplaySide, Readonly<{ name: string }>>>;
  readonly entries: readonly SpectatorReplayEntryV1[];
  readonly timing: readonly SpectatorTimingDecision[];
  readonly result: Readonly<{
    winnerSide: ReplaySide | null;
    reason: ReplayResultReason;
    turnCount: number;
    forfeitedSide: ReplaySide | null;
    finalStateHash: string;
  }>;
  readonly faults: Readonly<Record<ReplaySide, Readonly<{
    recoverableTotal: number;
    recoverableConsecutive: number;
    lastErrorCode: string | null;
  }>>>;
}

export type SpectatorReplay = SpectatorReplayV1 | SpectatorReplayV2;

export type SpectatorReplayErrorCode =
  | 'REPLAY_NOT_FOUND' | 'REPLAY_UNAVAILABLE' | 'CHECKSUM_MISMATCH' | 'UNSUPPORTED_SCHEMA' | 'INVALID_REPLAY' | 'UNAUTHENTICATED';

export class SpectatorReplayError extends Error {
  public readonly code: SpectatorReplayErrorCode;

  public constructor(code: SpectatorReplayErrorCode) {
    super(code);
    this.name = 'SpectatorReplayError';
    this.code = code;
  }
}

class ReplaySchemaError extends Error {}

const sideValues = ['X', 'O'] as const;
const pieceTypes = ['ROCK', 'PAPER', 'SCISSORS'] as const;
const skipReasons = [
  'NO_LEGAL_ACTION', 'BOT_TIMEOUT', 'MALFORMED_JSON', 'SCHEMA_VIOLATION',
  'MATCH_ID_MISMATCH', 'TURN_ID_MISMATCH', 'MESSAGE_TOO_LARGE', 'ILLEGAL_ACTION',
] as const;
const resultReasons = ['REACHED_GOAL', 'ELIMINATED_ALL_PIECES', 'FORFEIT', 'TURN_LIMIT'] as const;
const faultCodes = ['BOT_SPAWN_FAILED', 'BOT_CRASHED', 'BOT_EOF', 'STDERR_LIMIT_EXCEEDED', 'RESOURCE_LIMIT_EXCEEDED', 'SANDBOX_VIOLATION'] as const;
const eventTypes = ['ACTION_APPLIED', 'TURN_SKIPPED', 'MATCH_FINISHED'] as const;
const timingExhaustions = ['TURN_LIMIT', 'BOT_BUDGET', 'WALL_CLOCK'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;

/** Explicit historical adapter registry. Unknown engines never use a current rule implementation. */
export function supportsHistoricalReplay(engineVersion: string, protocolVersion: number, formatVersion: number): boolean {
  if (engineVersion === '1.0.0' && protocolVersion === 1 && formatVersion === 1) return true;
  if (engineVersion === '1.0.0' && protocolVersion === 2 && formatVersion === 2) return true;
  return false;
}

function invalid(): never { throw new ReplaySchemaError('Invalid replay schema'); }

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, nonEmpty = true): string {
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) return invalid();
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) return invalid();
  return Number(value);
}

function nonNegativeNumber(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < minimum) return invalid();
  return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return invalid();
  return value as T;
}

function side(value: unknown): ReplaySide { return oneOf(value, sideValues); }

function position(value: unknown): ReplayPosition {
  const row = object(value);
  const col = integer(row.col);
  const line = integer(row.row);
  if (col > 8 || line > 8) return invalid();
  return { col, row: line };
}

function action(value: unknown): ReplayAction {
  const row = object(value);
  return { pieceId: text(row.pieceId), to: position(row.to) };
}

function mapDefinition(value: unknown): SpectatorMapV1 {
  const row = object(value);
  if (row.schemaVersion !== 1 || row.width !== 9 || row.height !== 9
    || !Array.isArray(row.obstacles) || !Array.isArray(row.spawns)) return invalid();
  const goals = object(row.goals);
  const version = integer(row.version, 1);
  const checksum = text(row.checksum);
  if (!hashPattern.test(checksum)) return invalid();
  return {
    schemaVersion: 1,
    mapId: text(row.mapId),
    version,
    checksum,
    width: 9,
    height: 9,
    obstacles: row.obstacles.map(position),
    spawns: row.spawns.map((item) => {
      const spawn = object(item);
      return { id: text(spawn.id), owner: side(spawn.owner), type: oneOf(spawn.type, pieceTypes), position: position(spawn.position) };
    }),
    goals: { X: position(goals.X), O: position(goals.O) },
  };
}

function replayInput(value: unknown): ReplayInput {
  const row = object(value);
  const owner = side(row.side);
  if (row.kind === 'apply') return { kind: 'apply', side: owner, action: action(row.action) };
  if (row.kind === 'skip') return { kind: 'skip', side: owner, reason: oneOf(row.reason, skipReasons) };
  if (row.kind === 'forfeit') return { kind: 'forfeit', side: owner, fault: oneOf(row.fault, [...faultCodes, ...skipReasons]) };
  return invalid();
}

function replayEntry(value: unknown, expectedIndex: number): SpectatorReplayEntryV1 {
  const row = object(value);
  const index = integer(row.index, 1);
  const revision = integer(row.revision);
  const stateHash = text(row.stateHash);
  if (index !== expectedIndex || !hashPattern.test(stateHash) || !Array.isArray(row.events)) return invalid();
  return {
    index,
    input: replayInput(row.input),
    events: row.events.map((eventValue) => {
      const event = object(eventValue);
      if (event.action !== null && event.action !== undefined && typeof event.action !== 'object') return invalid();
      const reason = event.reason === null ? null : oneOf(event.reason, [...skipReasons, ...resultReasons]);
      const eventType = oneOf(event.type, eventTypes);
      const eventAction = event.action === null ? null : action(event.action);
      if ((eventType === 'ACTION_APPLIED' && (eventAction === null || reason !== null))
        || (eventType === 'TURN_SKIPPED' && (eventAction !== null || reason === null || !skipReasons.includes(reason as ReplaySkipReason)))
        || (eventType === 'MATCH_FINISHED' && (eventAction !== null || reason === null || !resultReasons.includes(reason as ReplayResultReason)))) return invalid();
      return {
        sequence: integer(event.sequence),
        revision: integer(event.revision),
        turnId: integer(event.turnId, 1),
        type: eventType,
        side: side(event.side),
        action: eventAction,
        reason,
      };
    }),
    revision,
    stateHash,
  };
}

function faultSummary(value: unknown) {
  const row = object(value);
  if (!(row.lastErrorCode === null || typeof row.lastErrorCode === 'string')) return invalid();
  return {
    recoverableTotal: integer(row.recoverableTotal),
    recoverableConsecutive: integer(row.recoverableConsecutive),
    lastErrorCode: row.lastErrorCode,
  };
}

function timingDecision(value: unknown): SpectatorTimingDecision {
  const row = object(value);
  const turnId = integer(row.turnId, 1);
  const turnSide = side(row.side);
  const turnLimitMs = row.turnLimitMs === null ? null : nonNegativeNumber(row.turnLimitMs);
  const deadlineMs = nonNegativeNumber(row.deadlineMs);
  const remainingBeforeMs = nonNegativeNumber(row.remainingBeforeMs);
  const wallElapsedBeforeMs = nonNegativeNumber(row.wallElapsedBeforeMs);
  const elapsedMs = nonNegativeNumber(row.elapsedMs);
  if (typeof row.timedOut !== 'boolean') return invalid();
  const timedOut = row.timedOut;
  const chargedMs = nonNegativeNumber(row.chargedMs);
  const remainingAfterMs = nonNegativeNumber(row.remainingAfterMs);
  const exhaustion = row.exhaustion === null ? null : oneOf(row.exhaustion, timingExhaustions);
  return {
    turnId,
    side: turnSide,
    turnLimitMs,
    deadlineMs,
    remainingBeforeMs,
    wallElapsedBeforeMs,
    elapsedMs,
    timedOut,
    chargedMs,
    remainingAfterMs,
    exhaustion,
  };
}

function timeControlDefinition(value: unknown): SpectatorTimeControlV2 {
  const tc = object(value);
  const startupMs = nonNegativeNumber(tc.startupMs);
  const totalBotBudgetMs = nonNegativeNumber(tc.totalBotBudgetMs, 1);
  const matchWallClockMs = nonNegativeNumber(tc.matchWallClockMs, 1);
  const perTurnObj = object(tc.perTurn);
  const mode = oneOf(perTurnObj.mode, ['FIXED', 'DYNAMIC', 'NONE'] as const);
  let perTurn: SpectatorPerTurnPolicyV2;
  if (mode === 'FIXED') {
    perTurn = { mode: 'FIXED', fixedMs: nonNegativeNumber(perTurnObj.fixedMs, 1) };
  } else if (mode === 'DYNAMIC') {
    perTurn = {
      mode: 'DYNAMIC',
      baseMs: nonNegativeNumber(perTurnObj.baseMs, 1),
      stepMs: nonNegativeNumber(perTurnObj.stepMs),
      everyTurns: integer(perTurnObj.everyTurns, 1),
      maxMs: nonNegativeNumber(perTurnObj.maxMs),
    };
  } else {
    perTurn = { mode: 'NONE' };
  }
  return {
    startupMs,
    totalBotBudgetMs,
    matchWallClockMs,
    perTurn,
  };
}

const TEAM_NAME_MAX_LENGTH = 128;

function teamName(value: unknown): { readonly name: string } {
  const entry = object(value);
  if (Object.keys(entry).some((key) => key !== 'name')) return invalid();
  const name = text(entry.name);
  if (name.length > TEAM_NAME_MAX_LENGTH * 2) return invalid();
  return { name };
}

function teams(value: unknown): { readonly X: { readonly name: string }; readonly O: { readonly name: string } } {
  const entry = object(value);
  if (Object.keys(entry).some((key) => key !== 'X' && key !== 'O')) return invalid();
  return { X: teamName(entry.X), O: teamName(entry.O) };
}

export function parseSpectatorReplay(value: unknown): SpectatorReplay {
  const replay = object(value);
  if (replay.schema !== 'ott.spectator-replay') throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  const schemaVersion = replay.schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  if (!uuidPattern.test(text(replay.matchId)) || !Array.isArray(replay.entries)) return invalid();
  const header = object(replay.header);
  const matchId = replay.matchId as string;
  if (header.format !== 'ott.match-event-log' || header.matchId !== matchId) {
    throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  }
  const formatVersion = header.formatVersion;
  const protocolVersion = header.protocolVersion;
  if (typeof formatVersion !== 'number' || typeof protocolVersion !== 'number') {
    throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  }
  if (schemaVersion === 1 && (formatVersion !== 1 || protocolVersion !== 1)) {
    throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  }
  if (schemaVersion === 2 && (formatVersion !== 2 || protocolVersion !== 2)) {
    throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  }
  const engineVersion = text(header.engineVersion);
  if (!supportsHistoricalReplay(engineVersion, protocolVersion, formatVersion)) {
    throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  }
  const game = object(header.game);
  const gameEngineVersion = text(game.engineVersion);
  if (gameEngineVersion !== engineVersion) return invalid();
  const map = mapDefinition(game.map);
  const maxTurns = integer(game.maxTurns, 1);
  const result = object(replay.result);
  const finalStateHash = text(result.finalStateHash);
  if (!hashPattern.test(finalStateHash)) return invalid();
  const turnCount = integer(result.turnCount);
  const entries = replay.entries.map((entry, index) => replayEntry(entry, index + 1));
  if (turnCount > maxTurns || (entries.length > 0 && entries.at(-1)?.stateHash !== finalStateHash)) return invalid();
  const faults = object(replay.faults);
  const safeResult = {
    winnerSide: result.winnerSide === null ? null : side(result.winnerSide),
    reason: oneOf(result.reason, resultReasons),
    turnCount,
    forfeitedSide: result.forfeitedSide === null ? null : side(result.forfeitedSide),
    finalStateHash,
  };
  const safeFaults = { X: faultSummary(faults.X), O: faultSummary(faults.O) };

  if (schemaVersion === 1) {
    return {
      schema: 'ott.spectator-replay',
      schemaVersion: 1,
      matchId,
      header: {
        format: 'ott.match-event-log',
        formatVersion: 1,
        matchId,
        protocolVersion: 1,
        engineVersion,
        game: { engineVersion: gameEngineVersion, maxTurns, map },
      },
      entries,
      result: safeResult,
      faults: safeFaults,
    };
  }

  // schemaVersion === 2
  const limits = object(header.limits);
  const timeControl = timeControlDefinition(limits.timeControl);
  if (!Array.isArray(replay.timing)) return invalid();
  const timing = replay.timing.map(timingDecision);
  const replayTeams = replay.teams === undefined ? undefined : teams(replay.teams);

  return {
    schema: 'ott.spectator-replay',
    schemaVersion: 2,
    matchId,
    header: {
      format: 'ott.match-event-log',
      formatVersion: 2,
      matchId,
      protocolVersion: 2,
      engineVersion,
      game: { engineVersion: gameEngineVersion, maxTurns, map },
      limits: { timeControl },
    },
    ...(replayTeams === undefined ? {} : { teams: replayTeams }),
    entries,
    timing,
    result: safeResult,
    faults: safeFaults,
  };
}

export function isReplaySchemaError(error: unknown): boolean {
  return error instanceof ReplaySchemaError;
}
