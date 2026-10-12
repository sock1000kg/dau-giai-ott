import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compileProtocolValidator,
  type InitMessage,
  type StateUpdateMessage,
} from '@ott/bot-protocol';
import type { GameState, PlayerSide, TransitionResult } from '@ott/game-core';

import { BotProcess, type BotProcessOptions } from '../src/bot-process.ts';
import { FakeGame } from '../src/fakes.ts';
import { runMatch } from '../src/match-runner.ts';
import type { MatchConfig } from '../src/types.ts';

const schemaPath = new URL('../../../docs/contracts/bot-protocol-v1.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as unknown;
const validator = compileProtocolValidator(schema);

const botDir = new URL('fixtures/bots/', import.meta.url);
const echoBotPath = fileURLToPath(new URL('echo-first-legal.mjs', botDir));
const slowBotPath = fileURLToPath(new URL('slow.mjs', botDir));
const silentBotPath = fileURLToPath(new URL('silent.mjs', botDir));
const crashBotPath = fileURLToPath(new URL('crash.mjs', botDir));
const exitZeroBotPath = fileURLToPath(new URL('exit-zero.mjs', botDir));
const closeStdoutBotPath = fileURLToPath(new URL('close-stdout.mjs', botDir));
const stderrFloodBotPath = fileURLToPath(new URL('stderr-flood.mjs', botDir));
const ignoreSigtermBotPath = fileURLToPath(new URL('ignore-sigterm.mjs', botDir));
const hangBeforeInitBotPath = fileURLToPath(new URL('hang-before-init.mjs', botDir));

const sampleInit: InitMessage = {
  type: 'INIT',
  protocolVersion: 1,
  matchId: 'm-lifecycle-001',
  engineVersion: '0.0.0',
  side: 'X',
  seed: 'seed-1',
  map: {
    schemaVersion: 1,
    mapId: 'map-1',
    version: 1,
    checksum: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    width: 9,
    height: 9,
    obstacles: [],
    spawns: [
      { id: 'X-ROCK-1', owner: 'X', type: 'ROCK', position: { col: 0, row: 0 } },
      { id: 'X-ROCK-2', owner: 'X', type: 'ROCK', position: { col: 1, row: 0 } },
      { id: 'X-ROCK-3', owner: 'X', type: 'ROCK', position: { col: 2, row: 0 } },
      { id: 'X-PAPER-1', owner: 'X', type: 'PAPER', position: { col: 0, row: 1 } },
      { id: 'X-PAPER-2', owner: 'X', type: 'PAPER', position: { col: 1, row: 1 } },
      { id: 'X-PAPER-3', owner: 'X', type: 'PAPER', position: { col: 2, row: 1 } },
      { id: 'X-SCISSORS-1', owner: 'X', type: 'SCISSORS', position: { col: 0, row: 2 } },
      { id: 'X-SCISSORS-2', owner: 'X', type: 'SCISSORS', position: { col: 1, row: 2 } },
      { id: 'X-SCISSORS-3', owner: 'X', type: 'SCISSORS', position: { col: 2, row: 2 } },
      { id: 'O-ROCK-1', owner: 'O', type: 'ROCK', position: { col: 6, row: 6 } },
      { id: 'O-ROCK-2', owner: 'O', type: 'ROCK', position: { col: 7, row: 6 } },
      { id: 'O-ROCK-3', owner: 'O', type: 'ROCK', position: { col: 8, row: 6 } },
      { id: 'O-PAPER-1', owner: 'O', type: 'PAPER', position: { col: 6, row: 7 } },
      { id: 'O-PAPER-2', owner: 'O', type: 'PAPER', position: { col: 7, row: 7 } },
      { id: 'O-PAPER-3', owner: 'O', type: 'PAPER', position: { col: 8, row: 7 } },
      { id: 'O-SCISSORS-1', owner: 'O', type: 'SCISSORS', position: { col: 6, row: 8 } },
      { id: 'O-SCISSORS-2', owner: 'O', type: 'SCISSORS', position: { col: 7, row: 8 } },
      { id: 'O-SCISSORS-3', owner: 'O', type: 'SCISSORS', position: { col: 8, row: 8 } },
    ],
    goals: { X: { col: 8, row: 8 }, O: { col: 0, row: 0 } },
  },
  limits: {
    startupTimeoutMs: 1000,
    turnTimeoutMs: 1000,
    maxTurns: 100,
    maxMessageBytes: 65536,
    maxStderrBytes: 65536,
    maxConsecutiveFaults: 3,
    maxTotalFaults: 5,
  },
};

const sampleUpdate: StateUpdateMessage = {
  type: 'STATE_UPDATE',
  protocolVersion: 1,
  matchId: 'm-lifecycle-001',
  turnId: 1,
  state: {
    schemaVersion: 1,
    engineVersion: '0.0.0',
    map: sampleInit.map,
    status: 'PLAYING',
    turn: 'X',
    turnNumber: 1,
    turnCount: 0,
    revision: 1,
    maxTurns: 100,
    pieces: sampleInit.map.spawns,
    outcome: null,
  },
  legalActions: [{ pieceId: 'X-ROCK-1', to: { col: 0, row: 1 } }],
};

function isAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as { code?: string })?.code !== 'ESRCH';
  }
}

const activeBots: BotProcess[] = [];

function trackBot(bot: BotProcess): BotProcess {
  activeBots.push(bot);
  return bot;
}

function createBot(scriptPath: string, args: string[] = [], overrides: Partial<BotProcessOptions> = {}): BotProcess {
  return trackBot(
    new BotProcess({
      executable: process.execPath,
      args: [scriptPath, ...args],
      validator,
      maxMessageBytes: sampleInit.limits.maxMessageBytes,
      startupTimeoutMs: 1000,
      stopGraceMs: 100,
      ...overrides,
    }),
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (activeBots.length > 0) {
    const bot = activeBots.pop();
    if (bot) {
      await bot.stop();
    }
  }
});

describe('BotProcess lifecycle and timeouts (P1-D06)', () => {
  it('1. Timeout settles once: silent bot -> BOT_TIMEOUT; settled exactly once, timer cleared', { timeout: 3000 }, async () => {
    const bot = createBot(silentBotPath);
    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    let settleCount = 0;
    const reqPromise = bot.requestAction(sampleUpdate, 120);
    reqPromise.then(() => {
      settleCount++;
    });

    const reply = await reqPromise;
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.code).toBe('BOT_TIMEOUT');
    }
    expect(settleCount).toBe(1);

    // Active timers must be 0 after timeout settlement
    const handles = bot.debugHandles();
    expect(handles.activeTimers).toBe(0);
    // BOT_TIMEOUT is a turn skip, not a process fault
    expect(bot.fault).toBeNull();
  });

  it('2. Deadline starts after write: delay measured from write callback using injected now()', { timeout: 3000 }, async () => {
    let currentTime = 1000;
    const fakeNow = () => currentTime;

    const bot = createBot(silentBotPath, [], { now: fakeNow });
    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    // Intercept stdin.write to advance time during the write
    const child = (bot as unknown as { child: { stdin: { write: Function } } }).child;
    const origWrite = child.stdin.write.bind(child.stdin);
    child.stdin.write = function (chunk: unknown, enc: unknown, cb: unknown) {
      currentTime += 200; // time advances during the write callback
      return origWrite(chunk, enc, cb);
    };

    const reqPromise = bot.requestAction(sampleUpdate, 150);
    // Wait briefly for write callback to complete so turn timer is armed
    await new Promise((r) => setTimeout(r, 10));

    // Find the turn timer call
    const turnTimerCall = setTimeoutSpy.mock.calls.find((call) => call[1] === 150);
    expect(turnTimerCall).toBeDefined();
    expect(turnTimerCall?.[1]).toBe(150);

    await bot.stop();
  });

  it('3. Bot timestamps ignored: bot-process reads no Date/time from messages or environment', () => {
    const botProcessFile = fileURLToPath(new URL('../src/bot-process.ts', import.meta.url));
    const content = readFileSync(botProcessFile, 'utf-8');

    expect(content).not.toContain('Date.now');
    expect(content).not.toContain('new Date');
    expect(content).not.toMatch(/message\.(?:time|timestamp|created|duration)/i);
  });

  it('4. Late reply discarded: slow bot replies to turn 1 after timeout; turn 2 gets turn 2 reply', { timeout: 5000 }, async () => {
    // Turn 1 delayed 150ms. Turn 2 delayed 300ms.
    // Turn 1 times out at 80ms. Turn 2 requested at 100ms.
    // Turn 1 arrives at ~150ms while Turn 2 is pending and must be discarded.
    // Turn 2 arrives at ~400ms and settles Turn 2 with turnId 2.
    const bot = createBot(slowBotPath, ['--delays', JSON.stringify({ '1': 150, '2': 300 })]);
    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    // Turn 1 with 80 ms timeout -> times out at 80 ms
    const reply1 = await bot.requestAction(sampleUpdate, 80);
    expect(reply1.ok).toBe(false);
    if (!reply1.ok) {
      expect(reply1.code).toBe('BOT_TIMEOUT');
    }

    // Short pause: Turn 1 reply not arrived yet (150ms > 100ms)
    await new Promise((r) => setTimeout(r, 20));

    // Turn 2 requested with turnId 2 (Turn 1 arrives while Turn 2 is pending)
    const reply2 = await bot.requestAction({ ...sampleUpdate, turnId: 2 }, 1000);
    expect(reply2.ok).toBe(true);
    if (reply2.ok) {
      expect(reply2.message.turnId).toBe(2);
    }

    // Turn 1's late reply was discarded as UNEXPECTED_MESSAGE
    expect(bot.unexpectedLines).toBe(1);
    expect(bot.fault).toBeNull();
  });

  it('5. Stale turnId not from a timeout passes through as ok: true (runner judges it)', { timeout: 3000 }, async () => {
    const bot = createBot(echoBotPath, ['--pass-through-wrong-turn-id']);
    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    const reply = await bot.requestAction(sampleUpdate, 1000);
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.message.turnId).toBe(9999);
    }
  });

  describe('6. Exit codes', () => {
    it.each([
      {
        name: 'crash non-zero on STATE_UPDATE -> BOT_CRASHED',
        botScript: crashBotPath,
        botArgs: ['--on-state-update', '--code', '42'],
        phase: 'request',
        expectedCode: 'BOT_CRASHED',
      },
      {
        name: 'killed by signal -> BOT_CRASHED',
        botScript: crashBotPath,
        botArgs: ['--on-state-update', '--signal', 'SIGTERM'],
        phase: 'request',
        expectedCode: 'BOT_CRASHED',
      },
      {
        name: 'exit 0 -> BOT_EOF',
        botScript: exitZeroBotPath,
        botArgs: [],
        phase: 'request',
        expectedCode: 'BOT_EOF',
      },
      {
        name: 'stdout closed -> BOT_EOF',
        botScript: closeStdoutBotPath,
        botArgs: [],
        phase: 'request',
        expectedCode: 'BOT_EOF',
      },
      {
        name: 'crash before INIT is written -> BOT_SPAWN_FAILED',
        botScript: '/bin/false',
        botArgs: [],
        phase: 'start-executable',
        expectedCode: 'BOT_SPAWN_FAILED',
      },
      {
        name: 'nonexistent executable -> BOT_SPAWN_FAILED',
        botScript: 'nonexistent-bot-path-binary',
        botArgs: [],
        phase: 'start-executable',
        expectedCode: 'BOT_SPAWN_FAILED',
      },
      {
        name: 'startup timeout (bot never drains stdin with huge INIT) -> BOT_SPAWN_FAILED',
        botScript: hangBeforeInitBotPath,
        botArgs: [],
        phase: 'start-timeout',
        expectedCode: 'BOT_SPAWN_FAILED',
      },
    ])('$name', { timeout: 4000 }, async ({ botScript, botArgs, phase, expectedCode }) => {
      if (phase === 'start-executable') {
        const bot = trackBot(
          new BotProcess({
            executable: botScript,
            args: botArgs,
            validator,
            maxMessageBytes: sampleInit.limits.maxMessageBytes,
          }),
        );
        const startRes = await bot.start(sampleInit);
        expect(startRes.ok).toBe(false);
        if (!startRes.ok) {
          expect(startRes.code).toBe(expectedCode);
        }
        expect(bot.fault).toBe(expectedCode);
      } else if (phase === 'start-timeout') {
        // Test startup timeout: bot never reads stdin, 250KB payload fills OS pipe buffer
        const hugeInit = {
          ...sampleInit,
          _padding: 'x'.repeat(250_000),
        } as unknown as InitMessage;
        const bot = createBot(botScript, botArgs, { startupTimeoutMs: 100 });
        const startRes = await bot.start(hugeInit);
        expect(startRes.ok).toBe(false);
        if (!startRes.ok) {
          expect(startRes.code).toBe(expectedCode);
        }
        expect(bot.fault).toBe(expectedCode);
      } else {
        const bot = createBot(botScript, botArgs);
        const startRes = await bot.start(sampleInit);
        expect(startRes.ok).toBe(true);

        const reply = await bot.requestAction(sampleUpdate, 1000);
        expect(reply.ok).toBe(false);
        if (!reply.ok) {
          expect(reply.code).toBe(expectedCode);
        }
        expect(bot.fault).toBe(expectedCode);
      }
    });
  });

  it('7. Sticky fault: after fault, requestAction returns same code; send-only methods resolve without throwing', { timeout: 3000 }, async () => {
    const bot = createBot(crashBotPath, ['--on-state-update', '--code', '1']);
    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    const reply1 = await bot.requestAction(sampleUpdate, 1000);
    expect(reply1.ok).toBe(false);
    if (!reply1.ok) {
      expect(reply1.code).toBe('BOT_CRASHED');
    }
    expect(bot.fault).toBe('BOT_CRASHED');

    // Subsequent requestAction immediately returns sticky fault
    const reply2 = await bot.requestAction({ ...sampleUpdate, turnId: 2 }, 1000);
    expect(reply2.ok).toBe(false);
    if (!reply2.ok) {
      expect(reply2.code).toBe('BOT_CRASHED');
    }

    // Send-only methods never throw and never write
    await expect(bot.notifyStateUpdate({ ...sampleUpdate, turnId: 3 })).resolves.toBeUndefined();
    await expect(
      bot.sendTurnResult({
        type: 'TURN_RESULT',
        protocolVersion: 1,
        matchId: sampleInit.matchId,
        turnId: 3,
        actorSide: 'X',
        outcome: 'APPLIED',
        action: sampleUpdate.legalActions[0] ?? null,
        errorCode: null,
        revision: 2,
        nextSide: 'O',
      }),
    ).resolves.toBeUndefined();
    await expect(
      bot.finish({
        type: 'MATCH_RESULT',
        protocolVersion: 1,
        matchId: sampleInit.matchId,
        winnerSide: 'X',
        reason: 'FORFEIT',
        turnCount: 3,
        finalStateHash: 'abc',
        faults: {
          X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
          O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
        },
      }),
    ).resolves.toBeUndefined();

    // Still returns the same sticky fault
    const reply3 = await bot.requestAction({ ...sampleUpdate, turnId: 4 }, 1000);
    expect(reply3).toEqual({ ok: false, code: 'BOT_CRASHED' });
  });

  it('8. stderr quota: stderr-flood over maxStderrBytes -> STDERR_LIMIT_EXCEEDED, process dead, onStderr capped', { timeout: 3000 }, async () => {
    let capturedBytes = 0;
    const maxStderr = 500;
    const bot = createBot(stderrFloodBotPath, ['--bytes', '20000'], {
      maxStderrBytes: maxStderr,
      onStderr: (chunk) => {
        capturedBytes += chunk.byteLength;
      },
    });

    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    const reply = await bot.requestAction(sampleUpdate, 1000);
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.code).toBe('STDERR_LIMIT_EXCEEDED');
    }
    expect(bot.fault).toBe('STDERR_LIMIT_EXCEEDED');

    // Forwarded stderr must not exceed quota
    expect(capturedBytes).toBeLessThanOrEqual(maxStderr);

    // Process is killed
    await new Promise((r) => setTimeout(r, 50));
    expect(isAlive(bot.pid)).toBe(false);
  });

  it('9. Abort: stop() while request is pending settles BOT_EOF once', { timeout: 3000 }, async () => {
    const bot = createBot(silentBotPath);
    await bot.start(sampleInit);

    let settleCount = 0;
    const reqPromise = bot.requestAction(sampleUpdate, 10000);
    reqPromise.then((reply) => {
      settleCount++;
      expect(reply).toEqual({ ok: false, code: 'BOT_EOF' });
    });

    // Wait briefly for write to complete so request is actively pending
    await new Promise((r) => setTimeout(r, 10));

    await bot.stop();
    await reqPromise;
    expect(settleCount).toBe(1);
  });

  it('10. Idempotent close: stop() twice (sequential and concurrent) -> same resolution, no throw; stop() before start() resolves', { timeout: 3000 }, async () => {
    // Part A: stop before start
    const unstartedBot = createBot(silentBotPath);
    await expect(unstartedBot.stop()).resolves.toBeUndefined();

    // Part B: concurrent and sequential stop
    const bot = createBot(echoBotPath);
    await bot.start(sampleInit);

    const p1 = bot.stop();
    const p2 = bot.stop();
    expect(p1).toBe(p2); // identical promise instance
    await Promise.all([p1, p2]);

    // Sequential call after already stopped
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  it('11. SIGKILL path: ignore-sigterm bot -> stop() still resolves within ~2x grace and PID is dead', { timeout: 3000 }, async () => {
    const stopGraceMs = 80;
    const bot = createBot(ignoreSigtermBotPath, [], { stopGraceMs });
    await bot.start(sampleInit);

    // The fixture's ready line is emitted after it has installed its SIGTERM
    // handler. BotProcess treats it as intentionally out-of-window input.
    await vi.waitFor(() => expect(bot.unexpectedLines).toBe(1));

    const pid = bot.pid;
    expect(isAlive(pid)).toBe(true);

    const t0 = performance.now();
    await bot.stop();
    const elapsed = performance.now() - t0;

    // Grace sequence: stdin.end() (80ms) -> SIGTERM (80ms) -> SIGKILL -> exit (~160-350ms)
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(1000);
    expect(isAlive(pid)).toBe(false);
  });

  describe('12. No leftovers after every branch', () => {
    it.each([
      { scenario: 'silent timeout', script: silentBotPath, args: [] },
      { scenario: 'crash non-zero', script: crashBotPath, args: ['--on-state-update', '--code', '2'] },
      { scenario: 'exit zero', script: exitZeroBotPath, args: [] },
      { scenario: 'stdout closed', script: closeStdoutBotPath, args: [] },
      { scenario: 'stderr flood', script: stderrFloodBotPath, args: ['--bytes', '20000'] },
      { scenario: 'normal echo', script: echoBotPath, args: [] },
    ])('$scenario: PID dead, 0 listeners, 0 active timers', { timeout: 4000 }, async ({ script, args }) => {
      const bot = createBot(script, args, { maxStderrBytes: 500, stopGraceMs: 80 });
      await bot.start(sampleInit);
      const pid = bot.pid;

      await bot.requestAction(sampleUpdate, 150);
      await bot.stop();

      expect(isAlive(pid)).toBe(false);
      const handles = bot.debugHandles();
      expect(handles.childListeners).toBe(0);
      expect(handles.stdinListeners).toBe(0);
      expect(handles.stdoutListeners).toBe(0);
      expect(handles.stderrListeners).toBe(0);
      expect(handles.activeTimers).toBe(0);
    });
  });

  it('13. Runner integration with real processes: runMatch with FakeGame and silent bot', { timeout: 5000 }, async () => {
    const botX = createBot(echoBotPath, [], { stopGraceMs: 50 });
    const botO = createBot(silentBotPath, [], { stopGraceMs: 50 });

    const game = new FakeGame({});

    const config: MatchConfig = {
      matchId: 'm-integration-001',
      seed: 'seed-integration-001',
      game: {
        gameId: 'm-integration-001',
        engineVersion: '0.0.0',
        map: sampleInit.map,
        maxTurns: 10,
      },
      limits: {
        startupTimeoutMs: 500,
        turnTimeoutMs: 80,
        maxTurns: 10,
        maxMessageBytes: 65536,
        maxStderrBytes: 65536,
        maxConsecutiveFaults: 3,
        maxTotalFaults: 5,
      },
    };

    const ports = {
      game,
      bots: {
        X: botX,
        O: botO,
      },
    };

    const report = await runMatch(config, ports);

    expect(report.result.winnerSide).toBe('X');
    expect(report.result.reason).toBe('FORFEIT');
    expect(report.faults.O.recoverableConsecutive).toBe(3);
    expect(report.faults.O.lastErrorCode).toBe('BOT_TIMEOUT');

    // Both processes must be stopped and dead
    expect(isAlive(botX.pid)).toBe(false);
    expect(isAlive(botO.pid)).toBe(false);
    expect(botX.debugHandles().activeTimers).toBe(0);
    expect(botO.debugHandles().activeTimers).toBe(0);
  });
});
