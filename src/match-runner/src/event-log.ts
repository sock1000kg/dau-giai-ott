/**
 * P1-D07 — the match event log: the runner's own artifact format.
 *
 * Sources of truth: `docs/team-assignment-phase-1-2.md` §8.5 (metadata, revision order,
 * result + finalStateHash, a reader that rebuilds and checks the final hash, and "editing one
 * event makes the hash check fail"), `docs/tai-lieu-yeu-cau.md` §13.1 and
 * `docs/contracts/engine-api-v1.md` §3/§8.
 *
 * Scope note (§13.1 lists a richer product event set — `MATCH_STARTED`, `TURN_STARTED`,
 * `ACTION_RECEIVED`, `BOT_FAULT`, snapshots, submission metadata): the locked Engine API v1
 * emits only `ACTION_APPLIED | TURN_SKIPPED | MATCH_FINISHED`, so the log stores exactly the
 * engine events **plus the runner inputs needed to replay them**. The format is versioned so
 * the Phase 2 replay product can extend it as v2 without breaking v1 readers.
 *
 * Content rule: the log never stores bot source, argv/env, stderr or raw stdout — only the
 * types declared below.
 */
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';

import type { Limits, FaultSummary } from '@ott/bot-protocol';
import type {
  GameAction,
  GameConfig,
  GameEvent,
  GameResult,
  PlayerSide,
  ProcessFaultCode,
  SkipReason,
} from '@ott/game-core';

export const EVENT_LOG_FORMAT = 'ott.match-event-log';
export const EVENT_LOG_FORMAT_VERSION = 1;

/** Why a serialized log could not be read. Stable across releases so callers can branch on it. */
export type EventLogErrorCode = 'MALFORMED_EVENT_LOG' | 'UNSUPPORTED_EVENT_LOG_FORMAT';

export class EventLogError extends Error {
  readonly code: EventLogErrorCode;

  constructor(code: EventLogErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'EventLogError';
    this.code = code;
  }
}

/**
 * Everything needed to rebuild the initial state and to interpret the entries: the full game
 * config (map definition included) plus the protocol limits in force for the match.
 */
export interface EventLogHeader {
  readonly format: typeof EVENT_LOG_FORMAT;
  readonly formatVersion: 1;
  readonly matchId: string;
  readonly protocolVersion: 1;
  readonly engineVersion: string;
  readonly seed: string;
  readonly game: GameConfig;
  readonly limits: Limits;
}

/** The runner input that produced one engine transition. */
export type TransitionInput =
  | { readonly kind: 'apply'; readonly side: PlayerSide; readonly action: GameAction }
  | { readonly kind: 'skip'; readonly side: PlayerSide; readonly reason: SkipReason }
  | { readonly kind: 'forfeit'; readonly side: PlayerSide; readonly fault: ProcessFaultCode | SkipReason };

/**
 * One entry per **transition**, not per event.
 *
 * `index` is owned by the log and contiguous from 1: Engine API v1 does not define where the
 * engine's own `sequence` starts or whether it is gap-free, so contiguity is guaranteed here
 * and the engine fields are stored verbatim for the replay to check.
 */
export interface EventLogEntry {
  readonly index: number;
  readonly input: TransitionInput;
  readonly events: readonly GameEvent[];
  /** `state.revision` after the transition. */
  readonly revision: number;
  /** `GamePort.hash(state)` after the transition. */
  readonly stateHash: string;
}

export interface EventLogFooter {
  /** Carries `finalStateHash` (Engine API v1 §8), so the log is self-contained. */
  readonly result: GameResult;
  readonly faults: Readonly<Record<PlayerSide, FaultSummary>>;
  readonly entryCount: number;
}

export interface EventLogV1 {
  readonly header: EventLogHeader;
  readonly entries: readonly EventLogEntry[];
  readonly footer: EventLogFooter;
}

function cloneAction(action: GameAction): GameAction {
  return { pieceId: action.pieceId, to: { col: action.to.col, row: action.to.row } };
}

export function cloneEvent(event: GameEvent): GameEvent {
  return {
    sequence: event.sequence,
    revision: event.revision,
    turnId: event.turnId,
    type: event.type,
    side: event.side,
    action: event.action === null ? null : cloneAction(event.action),
    reason: event.reason,
  };
}

function cloneInput(input: TransitionInput): TransitionInput {
  switch (input.kind) {
    case 'apply':
      return { kind: 'apply', side: input.side, action: cloneAction(input.action) };
    case 'skip':
      return { kind: 'skip', side: input.side, reason: input.reason };
    case 'forfeit':
      return { kind: 'forfeit', side: input.side, fault: input.fault };
  }
}

function cloneFaults(faults: Readonly<Record<PlayerSide, FaultSummary>>): Readonly<Record<PlayerSide, FaultSummary>> {
  return {
    X: { ...faults.X },
    O: { ...faults.O },
  };
}

/** Deep copy of a finished log, so no caller can mutate a shared object graph. */
export function cloneEventLog(log: EventLogV1): EventLogV1 {
  return {
    header: structuredClone(log.header),
    entries: log.entries.map((entry) => ({
      index: entry.index,
      input: cloneInput(entry.input),
      events: entry.events.map(cloneEvent),
      revision: entry.revision,
      stateHash: entry.stateHash,
    })),
    footer: {
      result: { ...log.footer.result },
      faults: cloneFaults(log.footer.faults),
      entryCount: log.footer.entryCount,
    },
  };
}

/**
 * Byte-stable serialization: fixed 2-space indent, a trailing newline, and a fixed key order
 * (every log object above is built in one literal), so equal logs serialize to equal strings.
 */
export function serializeEventLog(log: EventLogV1): string {
  return `${JSON.stringify(log, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(detail: string): never {
  throw new EventLogError('MALFORMED_EVENT_LOG', detail);
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where} must be a string`);
  return value;
}

function requireNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where} must be a finite number`);
  return value;
}

function requireSide(value: unknown, where: string): PlayerSide {
  if (value !== 'X' && value !== 'O') fail(`${where} must be 'X' or 'O'`);
  return value;
}

function requireAction(value: unknown, where: string): void {
  if (!isRecord(value)) fail(`${where} must be an object`);
  requireString(value['pieceId'], `${where}.pieceId`);
  const to = value['to'];
  if (!isRecord(to)) fail(`${where}.to must be an object`);
  requireNumber(to['col'], `${where}.to.col`);
  requireNumber(to['row'], `${where}.to.row`);
}

function requireEvent(value: unknown, where: string): void {
  if (!isRecord(value)) fail(`${where} must be an object`);
  requireNumber(value['sequence'], `${where}.sequence`);
  requireNumber(value['revision'], `${where}.revision`);
  requireNumber(value['turnId'], `${where}.turnId`);
  requireString(value['type'], `${where}.type`);
  requireSide(value['side'], `${where}.side`);
  const action = value['action'];
  if (action !== null) requireAction(action, `${where}.action`);
  const reason = value['reason'];
  if (reason !== null) requireString(reason, `${where}.reason`);
}

function requireInput(value: unknown, where: string): void {
  if (!isRecord(value)) fail(`${where} must be an object`);
  const kind = requireString(value['kind'], `${where}.kind`);
  requireSide(value['side'], `${where}.side`);
  if (kind === 'apply') requireAction(value['action'], `${where}.action`);
  else if (kind === 'skip') requireString(value['reason'], `${where}.reason`);
  else if (kind === 'forfeit') requireString(value['fault'], `${where}.fault`);
  else fail(`${where}.kind "${kind}" is not a known transition kind`);
}

function requireSummary(value: unknown, where: string): void {
  if (!isRecord(value)) fail(`${where} must be an object`);
  requireNumber(value['recoverableTotal'], `${where}.recoverableTotal`);
  requireNumber(value['recoverableConsecutive'], `${where}.recoverableConsecutive`);
  const last = value['lastErrorCode'];
  if (last !== null) requireString(last, `${where}.lastErrorCode`);
}

function requireResult(value: unknown, where: string): void {
  if (!isRecord(value)) fail(`${where} must be an object`);
  const winner = value['winnerSide'];
  if (winner !== null) requireSide(winner, `${where}.winnerSide`);
  requireString(value['reason'], `${where}.reason`);
  requireNumber(value['turnCount'], `${where}.turnCount`);
  const forfeited = value['forfeitedSide'];
  if (forfeited !== null) requireSide(forfeited, `${where}.forfeitedSide`);
  requireString(value['finalStateHash'], `${where}.finalStateHash`);
}

/**
 * Parse a serialized log. Structural checks only (no schema library): format identity and
 * version first, then the required fields of every level.
 *
 * Throws `EventLogError` with `UNSUPPORTED_EVENT_LOG_FORMAT` for a foreign format/version and
 * `MALFORMED_EVENT_LOG` for anything else.
 */
export function parseEventLog(text: string): EventLogV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new EventLogError('MALFORMED_EVENT_LOG', 'not valid JSON');
  }
  if (!isRecord(parsed)) fail('log must be a JSON object');

  const header = parsed['header'];
  if (header === undefined) fail('header is missing');
  if (!isRecord(header)) fail('header must be an object');
  if (header['format'] !== EVENT_LOG_FORMAT) {
    throw new EventLogError(
      'UNSUPPORTED_EVENT_LOG_FORMAT',
      `format ${JSON.stringify(header['format'])} is not ${EVENT_LOG_FORMAT}`,
    );
  }
  if (header['formatVersion'] !== EVENT_LOG_FORMAT_VERSION) {
    throw new EventLogError(
      'UNSUPPORTED_EVENT_LOG_FORMAT',
      `formatVersion ${JSON.stringify(header['formatVersion'])} is not ${EVENT_LOG_FORMAT_VERSION}`,
    );
  }
  requireString(header['matchId'], 'header.matchId');
  const protocolVersion = requireNumber(header['protocolVersion'], 'header.protocolVersion');
  if (protocolVersion !== 1) {
    throw new EventLogError(
      'UNSUPPORTED_EVENT_LOG_FORMAT',
      `protocolVersion ${JSON.stringify(protocolVersion)} is not 1`,
    );
  }
  requireString(header['engineVersion'], 'header.engineVersion');
  requireString(header['seed'], 'header.seed');
  if (!isRecord(header['game'])) fail('header.game must be an object');
  if (!isRecord(header['limits'])) fail('header.limits must be an object');

  const entries = parsed['entries'];
  if (!Array.isArray(entries)) fail('entries must be an array');
  entries.forEach((entry, position) => {
    const where = `entries[${position}]`;
    if (!isRecord(entry)) fail(`${where} must be an object`);
    requireNumber(entry['index'], `${where}.index`);
    requireInput(entry['input'], `${where}.input`);
    const events = entry['events'];
    if (!Array.isArray(events)) fail(`${where}.events must be an array`);
    events.forEach((event, at) => requireEvent(event, `${where}.events[${at}]`));
    requireNumber(entry['revision'], `${where}.revision`);
    requireString(entry['stateHash'], `${where}.stateHash`);
  });

  const footer = parsed['footer'];
  if (!isRecord(footer)) fail('footer must be an object');
  requireResult(footer['result'], 'footer.result');
  const faults = footer['faults'];
  if (!isRecord(faults)) fail('footer.faults must be an object');
  requireSummary(faults['X'], 'footer.faults.X');
  requireSummary(faults['O'], 'footer.faults.O');
  requireNumber(footer['entryCount'], 'footer.entryCount');

  return parsed as unknown as EventLogV1;
}

/** The temporary file a write goes through; deterministic, no clock or randomness. */
function partialPathOf(path: string): string {
  return `${path}.partial`;
}

/** Best-effort cleanup of the temp file; a failure here must not mask the original error. */
async function removePartial(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

/**
 * Atomic write (AC2: no half-written artifact): the bytes go to `${path}.partial` in the same
 * directory and are then `rename`d onto `path`, which is atomic within a filesystem. On any
 * failure the temp file is removed (best effort) and the error is rethrown, so a reader never
 * sees a truncated log at `path`.
 */
export async function writeEventLogFile(path: string, log: EventLogV1): Promise<void> {
  const partial = partialPathOf(path);
  try {
    await writeFile(partial, serializeEventLog(log), 'utf8');
    await rename(partial, path);
  } catch (error) {
    await removePartial(partial);
    throw error;
  }
}

/** Read a log file written by {@link writeEventLogFile}; throws `EventLogError` when unreadable. */
export async function readEventLogFile(path: string): Promise<EventLogV1> {
  return parseEventLog(await readFile(path, 'utf8'));
}