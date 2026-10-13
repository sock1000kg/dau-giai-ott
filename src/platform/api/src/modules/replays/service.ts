import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { parseEventLog, type EventLogV1 } from '@ott/match-runner';

import type { Database } from '../../db/client.ts';
import type { ObjectStorage } from '../../storage/s3.ts';
import { listReplayCatalog, publishReplay, stageReplay, type ReplayTransitionInput } from './repository.ts';
import type { GameResultReason, PieceType, PlayerSide } from '@ott/game-core';
import type { ReplayCatalogPage, ReplayPublication, SpectatorReplayV1 } from './types.ts';

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
}

export class ReplayApiError extends Error {
  public readonly statusCode: 400 | 404 | 409;
  public readonly code: string;

  public constructor(statusCode: 400 | 404 | 409, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const replayChecksum = /^sha256:[0-9a-f]{64}$/;
const maxArtifactBytes = 16 * 1024 * 1024;

export type ReplayTransitionCommand = Omit<ReplayTransitionInput, 'verifiedEventLogSha256'>;

function failIntegrity(): never {
  throw new ReplayApiError(409, 'REPLAY_INTEGRITY_FAILED', 'Replay integrity verification failed');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) failIntegrity();
  return value as Record<string, unknown>;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) failIntegrity();
  return Number(value);
}

function text(value: unknown): string {
  if (typeof value !== 'string') failIntegrity();
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

function publicEventLog(log: EventLogV1, matchId: string, finalStateHash: string): SpectatorReplayV1 {
  if (log.header.matchId !== matchId || log.footer.result.finalStateHash !== finalStateHash
    || log.footer.entryCount !== log.entries.length || !/^[0-9a-f]{64}$/.test(finalStateHash)) failIntegrity();
  const game = record(log.header.game);
  if (game['gameId'] !== matchId || game['engineVersion'] !== log.header.engineVersion) failIntegrity();
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
    result: {
      winnerSide: result.winnerSide,
      reason: result.reason as GameResultReason,
      turnCount: integer(result.turnCount),
      forfeitedSide: result.forfeitedSide,
      finalStateHash: text(result.finalStateHash),
    },
    faults: {
      X: { recoverableTotal: integer(log.footer.faults.X.recoverableTotal), recoverableConsecutive: integer(log.footer.faults.X.recoverableConsecutive), lastErrorCode: log.footer.faults.X.lastErrorCode },
      O: { recoverableTotal: integer(log.footer.faults.O.recoverableTotal), recoverableConsecutive: integer(log.footer.faults.O.recoverableConsecutive), lastErrorCode: log.footer.faults.O.lastErrorCode },
    },
  };
}

async function storedReplay(database: Database, matchId: string, publishedOnly: boolean): Promise<StoredReplayRow> {
  const result = await database.query<StoredReplayRow>(`
    SELECT m.status, r.event_log_key, r.event_log_sha256, r.final_state_hash, p.state AS publication_state
    FROM matches m
    LEFT JOIN match_results r ON r.match_id = m.id
    LEFT JOIN replay_publications p ON p.match_id = m.id
    WHERE m.id = $1`, [matchId]);
  const row = result.rows[0];
  if (publishedOnly && (row?.status !== 'FINALIZED' || row.publication_state !== 'PUBLISHED')) {
    throw new ReplayApiError(404, 'REPLAY_NOT_FOUND', 'Replay is not available');
  }
  if (row?.status !== 'FINALIZED' || row.event_log_key === null || row.event_log_sha256 === null || row.final_state_hash === null) {
    throw new ReplayApiError(409, 'REPLAY_NOT_ELIGIBLE', 'Match does not have a verified terminal replay');
  }
  if (!replayChecksum.test(row.event_log_sha256) || row.event_log_key !== `match-results/${matchId}/event-log/${row.event_log_sha256}.json`) failIntegrity();
  return row;
}

async function loadVerifiedReplay(database: Database, storage: ObjectStorage, matchId: string): Promise<{
  readonly checksum: string;
  readonly log: EventLogV1;
  readonly finalStateHash: string;
}> {
  const identity = await storedReplay(database, matchId, false);
  let bytes: Uint8Array;
  try {
    bytes = await storage.get(identity.event_log_key!);
  } catch {
    return failIntegrity();
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maxArtifactBytes) failIntegrity();
  const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (checksum !== identity.event_log_sha256) failIntegrity();
  let log: EventLogV1;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    log = parseEventLog(text);
  } catch {
    return failIntegrity();
  }
  if (log.header.matchId !== matchId || log.footer.result.finalStateHash !== identity.final_state_hash) failIntegrity();
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
  const verified = await loadVerifiedReplay(database, storage, input.matchId);
  return stageReplay(database, { ...input, verifiedEventLogSha256: verified.checksum });
}

export async function publishReplayPublication(
  database: Database,
  storage: ObjectStorage,
  input: ReplayTransitionCommand,
): Promise<ReplayPublication> {
  const verified = await loadVerifiedReplay(database, storage, input.matchId);
  return publishReplay(database, { ...input, verifiedEventLogSha256: verified.checksum });
}

export async function getPublicReplay(
  database: Database,
  storage: ObjectStorage,
  matchId: string,
): Promise<PublicReplayArtifact> {
  await storedReplay(database, matchId, true);
  const verified = await loadVerifiedReplay(database, storage, matchId);
  const safeReplay = publicEventLog(verified.log, matchId, verified.finalStateHash);
  const body = `${JSON.stringify(safeReplay, null, 2)}\n`;
  return { body, checksum: `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}` };
}
