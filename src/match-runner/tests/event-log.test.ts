/**
 * P1-D07 — Event log serialization, parsing, atomic file I/O, and boundary tests.
 *
 * AC coverage (tasks/todo.md → P1-D07):
 * - AC 1 (contiguous sequence, complete metadata/outcome/final hash): tests 1, 2.
 * - AC 2 (no half-written artifact, versioned format): tests 3, 4, 5, 6.
 * - Boundary: test 7 (type-only domain imports, no child_process, no fs in replay).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  failRename: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (mocks.failRename) {
        throw new Error('injected rename failure');
      }
      return actual.rename(from, to);
    },
  };
});

import { DEFAULT_LIMITS, PROTOCOL_VERSION } from '@ott/bot-protocol';
import type { Limits } from '@ott/bot-protocol';
import type { GameAction, MapDefinition } from '@ott/game-core';

import {
  EVENT_LOG_FORMAT,
  EVENT_LOG_FORMAT_VERSION,
  EventLogError,
  FakeGame,
  ScriptedBot,
  parseEventLog,
  readEventLogFile,
  runMatch,
  serializeEventLog,
  writeEventLogFile,
} from '../src/index.ts';
import type { MatchConfig, MatchPorts, MatchReport, ScriptedReply } from '../src/index.ts';

const MAP_CHECKSUM = 'e'.repeat(64);
const MATCH_ID = 'match-event-log';
const SEED = 'seed-event-log';
const ACTION_X: GameAction = { pieceId: 'X1', to: { col: 0, row: 0 } };
const ACTION_O: GameAction = { pieceId: 'O1', to: { col: 0, row: 0 } };
const ILLEGAL_ACTION: GameAction = { pieceId: 'X1', to: { col: 5, row: 5 } };

function makeMap(): MapDefinition {
  return {
    schemaVersion: 1,
    mapId: 'log-map',
    version: 1,
    checksum: MAP_CHECKSUM,
    width: 9,
    height: 9,
    obstacles: [],
    spawns: [
      { id: 'X1', owner: 'X', type: 'ROCK', position: { col: 0, row: 0 } },
      { id: 'O1', owner: 'O', type: 'PAPER', position: { col: 8, row: 8 } },
    ],
    goals: { X: { col: 8, row: 8 }, O: { col: 0, row: 0 } },
  };
}

function makeConfig(maxTurns = 4, limitsOverrides: Partial<Limits> = {}): MatchConfig {
  return {
    matchId: MATCH_ID,
    seed: SEED,
    game: { gameId: MATCH_ID, engineVersion: '1.0.0', map: makeMap(), maxTurns },
    limits: { ...DEFAULT_LIMITS, maxTurns, ...limitsOverrides },
  };
}

function makePorts(options: {
  game?: FakeGame;
  xReplies?: readonly ScriptedReply[];
  oReplies?: readonly ScriptedReply[];
  xStartOk?: boolean;
  xStartFault?: 'BOT_SPAWN_FAILED';
}): { ports: MatchPorts; game: FakeGame; botX: ScriptedBot; botO: ScriptedBot } {
  const game = options.game ?? new FakeGame();
  const botX = new ScriptedBot({
    replies: options.xReplies ?? [],
    startResult: options.xStartOk === false ? { ok: false, code: options.xStartFault ?? 'BOT_SPAWN_FAILED' } : { ok: true },
  });
  const botO = new ScriptedBot({
    replies: options.oReplies ?? [],
  });
  return { ports: { game, bots: { X: botX, O: botO } }, game, botX, botO };
}

describe('P1-D07 — Match event log', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ott-event-log-test-'));
  });

  afterEach(() => {
    mocks.failRename = false;
    vi.restoreAllMocks();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('1. happy-path match log contains complete metadata, contiguous sequence, and matching outcome', async () => {
    const config = makeConfig(4);
    const { ports } = makePorts({
      xReplies: [{ kind: 'action', action: ACTION_X }, { kind: 'action', action: ACTION_X }],
      oReplies: [{ kind: 'action', action: ACTION_O }, { kind: 'action', action: ACTION_O }],
    });

    const report = await runMatch(config, ports);
    const log = report.log;

    // Header checks
    expect(log.header.format).toBe(EVENT_LOG_FORMAT);
    expect(log.header.formatVersion).toBe(EVENT_LOG_FORMAT_VERSION);
    expect(log.header.matchId).toBe(config.matchId);
    expect(log.header.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(log.header.engineVersion).toBe(config.game.engineVersion);
    expect(log.header.seed).toBe(config.seed);
    expect(log.header.game).toEqual(config.game);
    expect(log.header.limits).toEqual(config.limits);

    // Contiguous sequence 1..n
    expect(log.entries.length).toBeGreaterThan(0);
    const indices = log.entries.map((entry) => entry.index);
    expect(indices).toEqual(Array.from({ length: log.entries.length }, (_, i) => i + 1));

    // Flattened entry events match report.events verbatim
    const flattenedEvents = log.entries.flatMap((entry) => entry.events);
    expect(flattenedEvents).toEqual(report.events);

    // Footer matches report.result and faults
    expect(log.footer.result).toEqual(report.result);
    expect(log.footer.result.finalStateHash).toBe(report.result.finalStateHash);
    expect(log.footer.entryCount).toBe(log.entries.length);
    expect(log.footer.faults).toEqual(report.faults);
  });

  it('2. error paths record skips and forfeits with exact reasons and fault codes', async () => {
    // 2a. Recoverable skips leading to threshold forfeit (consecutive limit = 3)
    const configRecoverable = makeConfig(10, { maxConsecutiveFaults: 3 });
    const { ports: portsRecoverable } = makePorts({
      xReplies: [
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
      ],
      oReplies: [
        { kind: 'action', action: ACTION_O },
        { kind: 'action', action: ACTION_O },
      ],
    });
    const reportRecoverable = await runMatch(configRecoverable, portsRecoverable);
    const logRecoverable = reportRecoverable.log;

    expect(reportRecoverable.result.reason).toBe('FORFEIT');
    expect(reportRecoverable.result.forfeitedSide).toBe('X');
    // 3 skip entries for X + 2 apply entries for O + 1 forfeit entry for X = 6 entries
    expect(logRecoverable.entries).toHaveLength(6);
    expect(logRecoverable.entries[0]?.input).toEqual({ kind: 'skip', side: 'X', reason: 'BOT_TIMEOUT' });
    expect(logRecoverable.entries[1]?.input).toEqual({ kind: 'apply', side: 'O', action: ACTION_O });
    expect(logRecoverable.entries[2]?.input).toEqual({ kind: 'skip', side: 'X', reason: 'BOT_TIMEOUT' });
    expect(logRecoverable.entries[3]?.input).toEqual({ kind: 'apply', side: 'O', action: ACTION_O });
    expect(logRecoverable.entries[4]?.input).toEqual({ kind: 'skip', side: 'X', reason: 'BOT_TIMEOUT' });
    expect(logRecoverable.entries[5]?.input).toEqual({ kind: 'forfeit', side: 'X', fault: 'BOT_TIMEOUT' });

    // 2b. Process-fault forfeit (BOT_CRASHED)
    const configCrash = makeConfig(4);
    const { ports: portsCrash } = makePorts({
      xReplies: [{ kind: 'error', code: 'BOT_CRASHED' }],
      oReplies: [],
    });
    const reportCrash = await runMatch(configCrash, portsCrash);
    const logCrash = reportCrash.log;

    expect(reportCrash.result.reason).toBe('FORFEIT');
    expect(reportCrash.result.forfeitedSide).toBe('X');
    expect(logCrash.entries).toHaveLength(1);
    expect(logCrash.entries[0]?.input).toEqual({ kind: 'forfeit', side: 'X', fault: 'BOT_CRASHED' });

    // 2c. Start-failure forfeit (BOT_SPAWN_FAILED)
    const configSpawn = makeConfig(4);
    const { ports: portsSpawn } = makePorts({
      xStartOk: false,
      xStartFault: 'BOT_SPAWN_FAILED',
      xReplies: [],
      oReplies: [],
    });
    const reportSpawn = await runMatch(configSpawn, portsSpawn);
    const logSpawn = reportSpawn.log;

    expect(reportSpawn.result.reason).toBe('FORFEIT');
    expect(reportSpawn.result.forfeitedSide).toBe('X');
    expect(logSpawn.entries).toHaveLength(1);
    expect(logSpawn.entries[0]?.input).toEqual({ kind: 'forfeit', side: 'X', fault: 'BOT_SPAWN_FAILED' });
  });

  it('3. serializeEventLog round-trips through parseEventLog and is byte-stable', async () => {
    const config = makeConfig(4);
    const { ports: ports1 } = makePorts({
      xReplies: [{ kind: 'action', action: ACTION_X }, { kind: 'action', action: ACTION_X }],
      oReplies: [{ kind: 'action', action: ACTION_O }, { kind: 'action', action: ACTION_O }],
    });
    const report1 = await runMatch(config, ports1);

    const serialized1 = serializeEventLog(report1.log);
    const parsed = parseEventLog(serialized1);
    expect(parsed).toEqual(report1.log);

    // Second identical run produces identical byte output
    const { ports: ports2 } = makePorts({
      xReplies: [{ kind: 'action', action: ACTION_X }, { kind: 'action', action: ACTION_X }],
      oReplies: [{ kind: 'action', action: ACTION_O }, { kind: 'action', action: ACTION_O }],
    });
    const report2 = await runMatch(config, ports2);
    const serialized2 = serializeEventLog(report2.log);
    expect(serialized1).toBe(serialized2);
  });

  it('4. parseEventLog rejects non-JSON, missing header, wrong format, unsupported version, and wrong protocol version', () => {
    // Non-JSON
    expect(() => parseEventLog('not json at all')).toThrowError(EventLogError);
    expect(() => parseEventLog('not json')).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_EVENT_LOG' })
    );

    // Missing header
    expect(() => parseEventLog(JSON.stringify({ entries: [], footer: {} }))).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_EVENT_LOG' })
    );

    // Wrong format
    const wrongFormat = {
      header: {
        format: 'wrong-format',
        formatVersion: 1,
        matchId: 'm',
        protocolVersion: 1,
        engineVersion: '1',
        seed: 's',
        game: {},
        limits: {},
      },
      entries: [],
      footer: { result: {}, faults: {}, entryCount: 0 },
    };
    expect(() => parseEventLog(JSON.stringify(wrongFormat))).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_EVENT_LOG_FORMAT' })
    );

    // Unsupported version
    const wrongVersion = {
      header: {
        format: EVENT_LOG_FORMAT,
        formatVersion: 2,
        matchId: 'm',
        protocolVersion: 1,
        engineVersion: '1',
        seed: 's',
        game: {},
        limits: {},
      },
      entries: [],
      footer: { result: {}, faults: {}, entryCount: 0 },
    };
    expect(() => parseEventLog(JSON.stringify(wrongVersion))).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_EVENT_LOG_FORMAT' })
    );

    // Unsupported protocol version
    const wrongProtocolVersion = {
      header: {
        format: EVENT_LOG_FORMAT,
        formatVersion: 1,
        matchId: 'm',
        protocolVersion: 2,
        engineVersion: '1',
        seed: 's',
        game: {},
        limits: {},
      },
      entries: [],
      footer: { result: {}, faults: {}, entryCount: 0 },
    };
    expect(() => parseEventLog(JSON.stringify(wrongProtocolVersion))).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_EVENT_LOG_FORMAT' })
    );

    // Malformed protocol version (not a number)
    const malformedProtocolVersion = {
      header: {
        format: EVENT_LOG_FORMAT,
        formatVersion: 1,
        matchId: 'm',
        protocolVersion: '1',
        engineVersion: '1',
        seed: 's',
        game: {},
        limits: {},
      },
      entries: [],
      footer: { result: {}, faults: {}, entryCount: 0 },
    };
    expect(() => parseEventLog(JSON.stringify(malformedProtocolVersion))).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_EVENT_LOG' })
    );
  });

  it('5. writeEventLogFile writes atomically via .partial and cleans up on failure', async () => {
    const config = makeConfig(4);
    const { ports } = makePorts({
      xReplies: [{ kind: 'action', action: ACTION_X }],
      oReplies: [{ kind: 'action', action: ACTION_O }],
    });
    const report = await runMatch(config, ports);

    const logPath = join(tempDir, 'match.log');
    const partialPath = `${logPath}.partial`;

    // 5a. Successful write: reads back equal, no .partial left behind
    await writeEventLogFile(logPath, report.log);
    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(partialPath)).toBe(false);

    const readBack = await readEventLogFile(logPath);
    expect(readBack).toEqual(report.log);

    // 5b. Write to an invalid directory: fails, target does not exist, no .partial remains
    const invalidDirTarget = join(tempDir, 'nonexistent-subdir', 'match.log');
    await expect(writeEventLogFile(invalidDirTarget, report.log)).rejects.toThrow();
    expect(existsSync(invalidDirTarget)).toBe(false);
    expect(existsSync(`${invalidDirTarget}.partial`)).toBe(false);

    // 5c. Atomic write failure test:
    // If writeEventLogFile wrote directly to targetPath instead of writing to .partial then rename,
    // this test fails because:
    // (1) An injected failure on rename causes writeEventLogFile to fail.
    // (2) The targetPath must NEVER exist, and partialPath must be cleaned up.
    // A mutant writing directly to path would either not call rename (failing the rejection expectation)
    // or leave targetPath created on the disk.
    const failingTargetPath = join(tempDir, 'fail-atomic.log');
    const failingPartialPath = `${failingTargetPath}.partial`;

    mocks.failRename = true;

    await expect(writeEventLogFile(failingTargetPath, report.log)).rejects.toThrow('injected rename failure');
    expect(existsSync(failingTargetPath)).toBe(false);
    expect(existsSync(failingPartialPath)).toBe(false);
  });

  it('6. no secret, environment, or bot stdout/stderr is leaked into the serialized log', async () => {
    const config = makeConfig(4);
    const { ports } = makePorts({
      xReplies: [{ kind: 'action', action: ACTION_X }],
      oReplies: [{ kind: 'action', action: ACTION_O }],
    });
    const report = await runMatch(config, ports);
    const rawJson = serializeEventLog(report.log);
    const parsedObj = JSON.parse(rawJson) as Record<string, unknown>;

    // Allowed keys per structure level
    const TOP_ALLOWED = new Set(['header', 'entries', 'footer']);
    const HEADER_ALLOWED = new Set([
      'format',
      'formatVersion',
      'matchId',
      'protocolVersion',
      'engineVersion',
      'seed',
      'game',
      'limits',
    ]);
    const ENTRY_ALLOWED = new Set(['index', 'input', 'events', 'revision', 'stateHash']);
    const INPUT_ALLOWED = new Set(['kind', 'side', 'action', 'reason', 'fault']);
    const EVENT_ALLOWED = new Set(['sequence', 'revision', 'turnId', 'type', 'side', 'action', 'reason']);
    const ACTION_ALLOWED = new Set(['pieceId', 'to']);
    const POSITION_ALLOWED = new Set(['col', 'row']);
    const FOOTER_ALLOWED = new Set(['result', 'faults', 'entryCount']);
    const RESULT_ALLOWED = new Set(['winnerSide', 'reason', 'turnCount', 'forfeitedSide', 'finalStateHash']);
    const FAULT_SUMMARY_ALLOWED = new Set(['recoverableTotal', 'recoverableConsecutive', 'lastErrorCode']);

    expect(Object.keys(parsedObj).filter((k) => !TOP_ALLOWED.has(k))).toEqual([]);

    const header = parsedObj['header'] as Record<string, unknown>;
    expect(Object.keys(header).filter((k) => !HEADER_ALLOWED.has(k))).toEqual([]);

    const entries = parsedObj['entries'] as Array<Record<string, unknown>>;
    for (const entry of entries) {
      expect(Object.keys(entry).filter((k) => !ENTRY_ALLOWED.has(k))).toEqual([]);
      const input = entry['input'] as Record<string, unknown>;
      expect(Object.keys(input).filter((k) => !INPUT_ALLOWED.has(k))).toEqual([]);
      if (input['action']) {
        const action = input['action'] as Record<string, unknown>;
        expect(Object.keys(action).filter((k) => !ACTION_ALLOWED.has(k))).toEqual([]);
      }
      const events = entry['events'] as Array<Record<string, unknown>>;
      for (const ev of events) {
        expect(Object.keys(ev).filter((k) => !EVENT_ALLOWED.has(k))).toEqual([]);
        if (ev['action']) {
          const action = ev['action'] as Record<string, unknown>;
          expect(Object.keys(action).filter((k) => !ACTION_ALLOWED.has(k))).toEqual([]);
        }
      }
    }

    const footer = parsedObj['footer'] as Record<string, unknown>;
    expect(Object.keys(footer).filter((k) => !FOOTER_ALLOWED.has(k))).toEqual([]);
    const result = footer['result'] as Record<string, unknown>;
    expect(Object.keys(result).filter((k) => !RESULT_ALLOWED.has(k))).toEqual([]);
    const faults = footer['faults'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(faults)).toEqual(['X', 'O']);
    expect(Object.keys(faults['X']!).filter((k) => !FAULT_SUMMARY_ALLOWED.has(k))).toEqual([]);
    expect(Object.keys(faults['O']!).filter((k) => !FAULT_SUMMARY_ALLOWED.has(k))).toEqual([]);

    // Explicit check against forbidden leaked substrings (stdout, stderr, argv, env, secrets)
    expect(rawJson).not.toMatch(/"(rawStdout|stdout|stderr|env|argv|secret|token)":/i);
  });

  it('7. boundary: event-log.ts and replay.ts import domain modules type-only, spawn no processes, and replay.ts has no fs', () => {
    const ottImports = /^import\s+(?<kind>type\s+)?(?:[^;]*?)\bfrom\s+'(?<module>@ott\/[^']+)'/gm;

    const read = (file: string): string =>
      readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

    // event-log.ts boundary
    const eventLogSrc = read('../src/event-log.ts');
    expect(eventLogSrc).not.toMatch(/child_process/);
    expect(eventLogSrc).not.toMatch(/^import\s+'@ott\//m);
    expect(eventLogSrc).not.toMatch(/^export\s+(?!type)[^;]*from\s+'@ott\//m);

    const eventLogOttMatches = [...eventLogSrc.matchAll(ottImports)];
    expect(eventLogOttMatches).toHaveLength(2);
    for (const match of eventLogOttMatches) {
      expect(match.groups?.['module']).toMatch(/^@ott\/(game-core|bot-protocol)$/);
      expect(match.groups?.['kind']).toBe('type ');
    }

    // replay.ts boundary
    const replaySrc = read('../src/replay.ts');
    expect(replaySrc).not.toMatch(/child_process/);
    expect(replaySrc).not.toMatch(/^import\s+'@ott\//m);
    expect(replaySrc).not.toMatch(/^export\s+(?!type)[^;]*from\s+'@ott\//m);
    expect(replaySrc).not.toMatch(/node:fs/);
    expect(replaySrc).not.toMatch(/from\s+['"]fs(\/promises)?['"]/);

    const replayOttMatches = [...replaySrc.matchAll(ottImports)];
    expect(replayOttMatches).toHaveLength(1);
    for (const match of replayOttMatches) {
      expect(match.groups?.['module']).toBe('@ott/game-core');
      expect(match.groups?.['kind']).toBe('type ');
    }
  });
});
