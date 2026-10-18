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
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;

/** Explicit historical adapter registry. Unknown engines never use a current rule implementation. */
export function supportsHistoricalReplay(engineVersion: string, protocolVersion: number, formatVersion: number): boolean {
  return engineVersion === '1.0.0' && protocolVersion === 1 && formatVersion === 1;
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

export function parseSpectatorReplay(value: unknown): SpectatorReplayV1 {
  const replay = object(value);
  if (replay.schema !== 'ott.spectator-replay' || replay.schemaVersion !== 1) throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  if (!uuidPattern.test(text(replay.matchId)) || !Array.isArray(replay.entries)) return invalid();
  const header = object(replay.header);
  const matchId = replay.matchId as string;
  if (header.format !== 'ott.match-event-log' || header.formatVersion !== 1 || header.protocolVersion !== 1 || header.matchId !== matchId) {
    throw new SpectatorReplayError('UNSUPPORTED_SCHEMA');
  }
  const engineVersion = text(header.engineVersion);
  if (!supportsHistoricalReplay(engineVersion, Number(header.protocolVersion), Number(header.formatVersion))) {
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
    result: {
      winnerSide: result.winnerSide === null ? null : side(result.winnerSide),
      reason: oneOf(result.reason, resultReasons),
      turnCount,
      forfeitedSide: result.forfeitedSide === null ? null : side(result.forfeitedSide),
      finalStateHash,
    },
    faults: { X: faultSummary(faults.X), O: faultSummary(faults.O) },
  };
}

export function isReplaySchemaError(error: unknown): boolean {
  return error instanceof ReplaySchemaError;
}
