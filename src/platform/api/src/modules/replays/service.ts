import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { parseAnyEventLog, type AnyEventLog, type EventLogV1, type EventLogV2, type TimingDecision, type TimingExhaustion } from '@ott/match-runner';
import type { TimeControlV2, PerTurnPolicyV2 } from '@ott/bot-protocol';

import type { Database } from '../../db/client.ts';
import type { ObjectStorage } from '../../storage/s3.ts';
import { listReplayCatalog, publishReplay, stageReplay, type ReplayTransitionInput } from './repository.ts';
import type { GameResultReason, PieceType, PlayerSide } from '@ott/game-core';
import type { ReplayCatalogPage, ReplayPublication, SpectatorReplay, SpectatorReplayV1, SpectatorReplayV2 } from './types.ts';

interface StoredReplayRow {
  readonly status: string;
  readonly event_log_key: string | null;
  readonly event_log_sha256: string | null;
  readonly final_state_hash: string | null;
  readonly publication_state: string | null;
}

export interface PublicReplayArtifact {
  readonly body: string;
  readonly checksum: string;
  readonly version: 1 | 2;
}


export class ReplayApiError extends Error {
  public readonly statusCode: 400 | 401 | 404 | 409;
  public readonly code: string;

  public constructor(statusCode: 400 | 401 | 404 | 409, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const replayChecksum = /^sha256:[0-9a-f]{64}$/;
const maxArtifactBytes = 16 * 1024 * 1024;

export type ReplayTransitionCommand = Omit<ReplayTransitionInput, 'verifiedEventLogSha256'>;

interface MatchStageRow {
  readonly tournament_stage: string;
}

async function getMatchStage(database: Database, matchId: string): Promise<string> {
  const result = await database.query<MatchStageRow>(`
    SELECT s.tournament_stage
    FROM matches m
    JOIN series s ON s.id = m.series_id
    WHERE m.id = $1`, [matchId]);
  return result.rows[0]?.tournament_stage ?? '';
}

async function assertFinalsStage(database: Database, matchId: string): Promise<void> {
  const stage = await getMatchStage(database, matchId);
  if (stage !== 'FINALS') {
    throw new ReplayApiError(409, 'REPLAY_NOT_PUBLIC_STAGE', 'Replay publication is only allowed for FINALS stage matches');
  }
}

export interface PrivateReplayPrincipal {
  readonly accountId: string;
  readonly role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
  readonly teamId: string | null;
}

async function assertPrivateReplayAccess(
  database: Database,
  matchId: string,
  principal: PrivateReplayPrincipal,
): Promise<void> {
  if (principal.role === 'BTC_ADMIN') return;

  const result = await database.query<{ readonly x_submission_id: string; readonly o_submission_id: string }>(`
    SELECT m.x_submission_id, m.o_submission_id
    FROM matches m
    WHERE m.id = $1`, [matchId]);
  const match = result.rows[0];
  if (match === undefined) {
    throw new ReplayApiError(404, 'REPLAY_NOT_FOUND', 'Replay is not available');
  }

  if (principal.role === 'TEAM_ACCOUNT' && principal.teamId !== null) {
    const submissionResult = await database.query<{ readonly team_id: string }>(`
      SELECT team_id FROM submissions WHERE id IN ($1, $2)`, [match.x_submission_id, match.o_submission_id]);
    const teamIds = submissionResult.rows.map((row) => row.team_id);
    if (teamIds.includes(principal.teamId)) return;
  }

  throw new ReplayApiError(404, 'REPLAY_NOT_FOUND', 'Replay is not available');
}

function failIntegrity(reason?: string): never {
  if (reason) console.error('[failIntegrity]', reason);
  throw new ReplayApiError(409, 'REPLAY_INTEGRITY_FAILED', 'Replay integrity verification failed');
}

function record(value: unknown, name = 'value'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) failIntegrity(`${name} not an object`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, name = 'value'): number {
  if (!Number.isSafeInteger(value)) failIntegrity(`${name} not safe integer: ${value}`);
  return Number(value);
}

function nonNegativeNumber(value: unknown, name = 'value'): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    failIntegrity(`${name} not non-negative number: ${value}`);
  }
  return value;
}

function text(value: unknown, name = 'value'): string {
  if (typeof value !== 'string') failIntegrity(`${name} not a string`);
  return value;
}

function position(value: unknown): Readonly<{ col: number; row: number }> {
  const row = record(value);
  const col = integer(row['col']);
  const line = integer(row['row']);
  if (col < 0 || col > 8 || line < 0 || line > 8) failIntegrity();
  return { col, row: line };
}

function publicMap(value: unknown): import('@ott/game-core').MapDefinition {
  const map = record(value);
  if (map['schemaVersion'] !== 1 || map['width'] !== 9 || map['height'] !== 9) failIntegrity();
  if (!Array.isArray(map['obstacles']) || !Array.isArray(map['spawns'])) failIntegrity();
  const version = integer(map['version']);
  const checksum = text(map['checksum']);
  if (version < 1 || !/^[0-9a-f]{64}$/.test(checksum)) failIntegrity();
  const goals = record(map['goals']);
  const obstacles = map['obstacles'].map(position);
  const spawns = map['spawns'].map((value) => {
    const piece = record(value);
    const owner = piece['owner'];
    const type = piece['type'];
    if ((owner !== 'X' && owner !== 'O') || (type !== 'ROCK' && type !== 'PAPER' && type !== 'SCISSORS')) failIntegrity();
    return { id: text(piece['id']), owner: owner as PlayerSide, type: type as PieceType, position: position(piece['position']) };
  });
  return {
    schemaVersion: 1,
    mapId: text(map['mapId']),
    version,
    checksum,
    width: 9,
    height: 9,
    obstacles,
    spawns,
    goals: { X: position(goals['X']), O: position(goals['O']) },
  };
}

const timingExhaustions = ['TURN_LIMIT', 'BOT_BUDGET', 'WALL_CLOCK'] as const;

function publicTimingDecision(value: unknown): TimingDecision {
  const row = record(value);
  const turnId = integer(row['turnId']);
  if (turnId < 1) failIntegrity('turnId < 1');
  const side = row['side'];
  if (side !== 'X' && side !== 'O') failIntegrity('invalid side');
  const rawTurnLimit = row['turnLimitMs'];
  const turnLimitMs = rawTurnLimit === null ? null : nonNegativeNumber(rawTurnLimit, 'turnLimitMs');
  const deadlineMs = nonNegativeNumber(row['deadlineMs'], 'deadlineMs');
  const remainingBeforeMs = nonNegativeNumber(row['remainingBeforeMs'], 'remainingBeforeMs');
  const wallElapsedBeforeMs = nonNegativeNumber(row['wallElapsedBeforeMs'], 'wallElapsedBeforeMs');
  const elapsedMs = nonNegativeNumber(row['elapsedMs'], 'elapsedMs');
  const timedOut = row['timedOut'];
  if (typeof timedOut !== 'boolean') failIntegrity('timedOut not boolean');
  const chargedMs = nonNegativeNumber(row['chargedMs'], 'chargedMs');
  const remainingAfterMs = nonNegativeNumber(row['remainingAfterMs'], 'remainingAfterMs');
  const rawExhaustion = row['exhaustion'];
  if (rawExhaustion !== null && !timingExhaustions.includes(rawExhaustion as (typeof timingExhaustions)[number])) failIntegrity('invalid exhaustion');
  return {
    turnId,
    side,
    turnLimitMs,
    deadlineMs,
    remainingBeforeMs,
    wallElapsedBeforeMs,
    elapsedMs,
    timedOut,
    chargedMs,
    remainingAfterMs,
    exhaustion: rawExhaustion as TimingExhaustion | null,
  };
}

function publicTimeControl(value: unknown): TimeControlV2 {
  const tc = record(value);
  const startupMs = nonNegativeNumber(tc['startupMs'], 'startupMs');
  const totalBotBudgetMs = nonNegativeNumber(tc['totalBotBudgetMs'], 'totalBotBudgetMs');
  const matchWallClockMs = nonNegativeNumber(tc['matchWallClockMs'], 'matchWallClockMs');
  if (startupMs < 0 || totalBotBudgetMs < 1 || matchWallClockMs < 1) failIntegrity('invalid timeControl bounds');
  const perTurn = record(tc['perTurn']);
  const mode = text(perTurn['mode']);
  let safePerTurn: PerTurnPolicyV2;
  if (mode === 'FIXED') {
    const fixedMs = nonNegativeNumber(perTurn['fixedMs'], 'fixedMs');
    if (fixedMs < 1) failIntegrity('fixedMs < 1');
    safePerTurn = { mode: 'FIXED', fixedMs };
  } else if (mode === 'DYNAMIC') {
    const baseMs = nonNegativeNumber(perTurn['baseMs'], 'baseMs');
    const stepMs = nonNegativeNumber(perTurn['stepMs'], 'stepMs');
    const everyTurns = integer(perTurn['everyTurns']);
    const maxMs = nonNegativeNumber(perTurn['maxMs'], 'maxMs');
    if (baseMs < 1 || stepMs < 0 || everyTurns < 1 || maxMs < 0) failIntegrity('invalid dynamic bounds');
    safePerTurn = { mode: 'DYNAMIC', baseMs, stepMs, everyTurns, maxMs };
  } else if (mode === 'NONE') {
    safePerTurn = { mode: 'NONE' };
  } else {
    failIntegrity('unknown perTurn mode');
  }
  return {
    startupMs,
    totalBotBudgetMs,
    matchWallClockMs,
    perTurn: safePerTurn,
  };
}

export function publicEventLog(log: AnyEventLog, matchId: string, finalStateHash: string): SpectatorReplay {
  if (log.header.matchId !== matchId || log.footer.result.finalStateHash !== finalStateHash
    || log.footer.entryCount !== log.entries.length || !/^[0-9a-f]{64}$/.test(finalStateHash)) {
    failIntegrity(`publicEventLog mismatch: header matchId ${log.header.matchId} vs ${matchId}, footer hash ${log.footer.result.finalStateHash} vs ${finalStateHash}, entries ${log.footer.entryCount} vs ${log.entries.length}`);
  }
  const game = record(log.header.game, 'header.game');
  if (game['gameId'] !== matchId || game['engineVersion'] !== log.header.engineVersion) {
    failIntegrity(`publicEventLog game: gameId ${game['gameId']} vs ${matchId}, engineVersion ${game['engineVersion']} vs ${log.header.engineVersion}`);
  }
  const gameMap = publicMap(game['map']);
  const entries = log.entries.map((entry) => ({
    index: integer(entry.index),
    input: entry.input.kind === 'apply'
      ? { kind: 'apply' as const, side: entry.input.side, action: { pieceId: entry.input.action.pieceId, to: position(entry.input.action.to) } }
      : entry.input.kind === 'skip'
        ? { kind: 'skip' as const, side: entry.input.side, reason: entry.input.reason }
        : { kind: 'forfeit' as const, side: entry.input.side, fault: entry.input.fault },
    events: entry.events.map((event) => ({
      sequence: integer(event.sequence),
      revision: integer(event.revision),
      turnId: integer(event.turnId),
      type: event.type,
      side: event.side,
      action: event.action === null ? null : { pieceId: text(event.action.pieceId), to: position(event.action.to) },
      reason: event.reason,
    })),
    revision: integer(entry.revision),
    stateHash: text(entry.stateHash),
  }));
  const result = log.footer.result;
  const safeResult = {
    winnerSide: result.winnerSide,
    reason: result.reason as GameResultReason,
    turnCount: integer(result.turnCount),
    forfeitedSide: result.forfeitedSide,
    finalStateHash: text(result.finalStateHash),
  };
  const safeFaults = {
    X: { recoverableTotal: integer(log.footer.faults.X.recoverableTotal), recoverableConsecutive: integer(log.footer.faults.X.recoverableConsecutive), lastErrorCode: log.footer.faults.X.lastErrorCode },
    O: { recoverableTotal: integer(log.footer.faults.O.recoverableTotal), recoverableConsecutive: integer(log.footer.faults.O.recoverableConsecutive), lastErrorCode: log.footer.faults.O.lastErrorCode },
  };

  if (log.header.formatVersion === 1) {
    if (log.header.protocolVersion !== 1) failIntegrity();
    return {
      schema: 'ott.spectator-replay',
      schemaVersion: 1,
      matchId,
      header: {
        format: text(log.header.format),
        formatVersion: 1,
        matchId,
        protocolVersion: 1,
        engineVersion: text(log.header.engineVersion),
        game: { engineVersion: text(game['engineVersion']), maxTurns: integer(game['maxTurns']), map: gameMap },
      },
      entries,
      result: safeResult,
      faults: safeFaults,
    };
  }

  if (log.header.formatVersion === 2) {
    const v2Log = log as EventLogV2;
    if (v2Log.header.protocolVersion !== 2) failIntegrity();
    if (!Array.isArray(v2Log.timing)) failIntegrity();
    const limits = record(v2Log.header.limits);
    const timeControl = publicTimeControl(limits['timeControl']);
    const timing = v2Log.timing.map(publicTimingDecision);
    return {
      schema: 'ott.spectator-replay',
      schemaVersion: 2,
      matchId,
      header: {
        format: text(v2Log.header.format),
        formatVersion: 2,
        matchId,
        protocolVersion: 2,
        engineVersion: text(v2Log.header.engineVersion),
        game: { engineVersion: text(game['engineVersion']), maxTurns: integer(game['maxTurns']), map: gameMap },
        limits: { timeControl },
      },
      entries,
      timing,
      result: safeResult,
      faults: safeFaults,
    };
  }

  failIntegrity();
}


async function storedReplay(database: Database, matchId: string, publishedOnly: boolean): Promise<StoredReplayRow> {
  const result = await database.query<StoredReplayRow>(`
    SELECT m.status, r.event_log_key, r.event_log_sha256, r.final_state_hash, p.state AS publication_state
    FROM matches m
    LEFT JOIN match_results r ON r.match_id = m.id
    LEFT JOIN replay_publications p ON p.match_id = m.id
    WHERE m.id = $1`, [matchId]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new ReplayApiError(404, 'REPLAY_NOT_FOUND', 'Replay is not available');
  }
  if (publishedOnly && (row.status !== 'FINALIZED' || row.publication_state !== 'PUBLISHED')) {
    throw new ReplayApiError(404, 'REPLAY_NOT_FOUND', 'Replay is not available');
  }
  if (row.status !== 'FINALIZED' || row.event_log_key === null || row.event_log_sha256 === null || row.final_state_hash === null) {
    throw new ReplayApiError(409, 'REPLAY_NOT_ELIGIBLE', 'Match does not have a verified terminal replay');
  }
  if (!replayChecksum.test(row.event_log_sha256) || row.event_log_key !== `match-results/${matchId}/event-log/${row.event_log_sha256}.json`) {
    failIntegrity(`storedReplay key mismatch: ${row.event_log_key} vs match-results/${matchId}/event-log/${row.event_log_sha256}.json`);
  }
  return row;
}

async function loadVerifiedReplay(database: Database, storage: ObjectStorage, matchId: string): Promise<{
  readonly checksum: string;
  readonly log: AnyEventLog;
  readonly finalStateHash: string;
}> {
  const identity = await storedReplay(database, matchId, false);
  let bytes: Uint8Array;
  try {
    bytes = await storage.get(identity.event_log_key!);
  } catch (err) {
    return failIntegrity(`storage.get failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maxArtifactBytes) failIntegrity(`byteLength ${bytes.byteLength}`);
  const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (checksum !== identity.event_log_sha256) failIntegrity(`checksum ${checksum} != ${identity.event_log_sha256}`);
  let log: AnyEventLog;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    log = parseAnyEventLog(text);
  } catch (err) {
    return failIntegrity(`parseAnyEventLog failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (log.header.matchId !== matchId || log.footer.result.finalStateHash !== identity.final_state_hash) {
    failIntegrity(`matchId (${log.header.matchId} vs ${matchId}) or hash (${log.footer.result.finalStateHash} vs ${identity.final_state_hash})`);
  }
  return { checksum, log, finalStateHash: identity.final_state_hash! };
}

export async function getReplayCatalog(database: Database, page: number, pageSize: number): Promise<ReplayCatalogPage> {
  return listReplayCatalog(database, { page, pageSize });
}

export async function stageReplayPublication(
  database: Database,
  storage: ObjectStorage,
  input: ReplayTransitionCommand,
): Promise<ReplayPublication> {
  await assertFinalsStage(database, input.matchId);
  const verified = await loadVerifiedReplay(database, storage, input.matchId);
  return stageReplay(database, { ...input, verifiedEventLogSha256: verified.checksum });
}

export async function publishReplayPublication(
  database: Database,
  storage: ObjectStorage,
  input: ReplayTransitionCommand,
): Promise<ReplayPublication> {
  await assertFinalsStage(database, input.matchId);
  const verified = await loadVerifiedReplay(database, storage, input.matchId);
  return publishReplay(database, { ...input, verifiedEventLogSha256: verified.checksum });
}

export async function getPublicReplay(
  database: Database,
  storage: ObjectStorage,
  matchId: string,
): Promise<PublicReplayArtifact> {
  const stage = await getMatchStage(database, matchId);
  if (stage !== 'FINALS') {
    throw new ReplayApiError(404, 'REPLAY_NOT_FOUND', 'Replay is not available');
  }
  await storedReplay(database, matchId, true);
  const verified = await loadVerifiedReplay(database, storage, matchId);
  const safeReplay = publicEventLog(verified.log, matchId, verified.finalStateHash);
  const body = `${JSON.stringify(safeReplay, null, 2)}\n`;
  return {
    body,
    checksum: `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`,
    version: safeReplay.schemaVersion,
  };
}

export interface PrivateReplayArtifact {
  readonly body: string;
  readonly checksum: string;
  readonly version: 1 | 2;
}

export async function getPrivateReplay(
  database: Database,
  storage: ObjectStorage,
  matchId: string,
  principal: PrivateReplayPrincipal,
): Promise<PrivateReplayArtifact> {
  await assertPrivateReplayAccess(database, matchId, principal);
  const verified = await loadVerifiedReplay(database, storage, matchId);
  const safeReplay = publicEventLog(verified.log, matchId, verified.finalStateHash);
  const body = `${JSON.stringify(safeReplay, null, 2)}\n`;
  return {
    body,
    checksum: `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`,
    version: safeReplay.schemaVersion,
  };
}
