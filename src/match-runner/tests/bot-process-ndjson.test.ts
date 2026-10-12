import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  compileProtocolValidator,
  type InitMessage,
  type MatchResultMessage,
  type StateUpdateMessage,
  type TurnResultMessage,
} from '@ott/bot-protocol';

import { BotProcess, type BotProcessOptions } from '../src/bot-process.ts';

const schemaPath = new URL('../../../docs/contracts/bot-protocol-v1.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as unknown;
const validator = compileProtocolValidator(schema);

const botDir = new URL('fixtures/bots/', import.meta.url);
const echoBotPath = fileURLToPath(new URL('echo-first-legal.mjs', botDir));
const chunkedBotPath = fileURLToPath(new URL('chunked.mjs', botDir));
const twoLinesBotPath = fileURLToPath(new URL('two-lines.mjs', botDir));
const garbageBotPath = fileURLToPath(new URL('garbage.mjs', botDir));
const stderrNoiseBotPath = fileURLToPath(new URL('stderr-noise.mjs', botDir));
const unsolicitedBotPath = fileURLToPath(new URL('unsolicited.mjs', botDir));

const sampleInit: InitMessage = {
  type: 'INIT',
  protocolVersion: 1,
  matchId: 'm-fixture-001',
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
  matchId: 'm-fixture-001',
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

function createBot(scriptPath: string, args: string[] = [], overrides: Partial<BotProcessOptions> = {}): BotProcess {
  return new BotProcess({
    executable: process.execPath,
    args: [scriptPath, ...args],
    validator,
    maxMessageBytes: 65536,
    ...overrides,
  });
}

async function waitFor(condition: () => boolean, description: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('BotProcess NDJSON adapter (P1-D05)', () => {
  let activeBots: BotProcess[] = [];

  function trackBot(bot: BotProcess): BotProcess {
    activeBots.push(bot);
    return bot;
  }

  afterEach(async () => {
    for (const bot of activeBots) {
      await bot.stop();
    }
    activeBots = [];
  });

  it('6. No shell: executes argv without shell interpretation and asserts boundary invariants', { timeout: 5000 }, async () => {
    const rawMetaString = 'a b; echo pwned $(x) | y';
    let capturedStderr = '';

    const bot = trackBot(
      createBot(echoBotPath, ['--echo-argv', rawMetaString], {
        onStderr: (chunk) => {
          capturedStderr += Buffer.from(chunk).toString('utf-8');
        },
      }),
    );

    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    await waitFor(
      () => capturedStderr.includes(`ARGV:${JSON.stringify(['--echo-argv', rawMetaString])}`),
      'fixture argv diagnostic',
    );
    expect(capturedStderr).toContain(`ARGV:${JSON.stringify(['--echo-argv', rawMetaString])}`);

    // Boundary check on source text of bot-process.ts
    const botProcessSrc = readFileSync(fileURLToPath(new URL('../src/bot-process.ts', import.meta.url)), 'utf-8');
    expect(botProcessSrc).toContain('shell: false');
    expect(botProcessSrc).not.toMatch(/\bexec\s*\(/);
    expect(botProcessSrc).not.toMatch(/\bexecSync\s*\(/);
  });

  it('7. Happy path: INIT -> STATE_UPDATE -> ACTION reply ok: true, and broadcast delivery verified via stderr', { timeout: 5000 }, async () => {
    let capturedStderr = '';
    const bot = trackBot(
      createBot(echoBotPath, [], {
        onStderr: (chunk) => {
          capturedStderr += Buffer.from(chunk).toString('utf-8');
        },
      }),
    );

    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    const actionReply = await bot.requestAction(sampleUpdate, 1000);
    expect(actionReply.ok).toBe(true);
    if (actionReply.ok) {
      expect(actionReply.message.type).toBe('ACTION');
      expect(actionReply.message.turnId).toBe(1);
      expect(actionReply.message.action).toEqual({ pieceId: 'X-ROCK-1', to: { col: 0, row: 1 } });
    }

    // Verify other broadcast methods deliver lines to bot
    await bot.notifyStateUpdate({ ...sampleUpdate, turnId: 2 });

    const sampleTurnResult: TurnResultMessage = {
      type: 'TURN_RESULT',
      protocolVersion: 1,
      matchId: sampleInit.matchId,
      turnId: 1,
      actorSide: 'X',
      outcome: 'APPLIED',
      action: { pieceId: 'X-ROCK-1', to: { col: 0, row: 1 } },
      errorCode: null,
      revision: 2,
      nextSide: 'O',
    };
    await bot.sendTurnResult(sampleTurnResult);

    const sampleMatchResult: MatchResultMessage = {
      type: 'MATCH_RESULT',
      protocolVersion: 1,
      matchId: sampleInit.matchId,
      winnerSide: 'X',
      reason: 'REACHED_GOAL',
      turnCount: 1,
      finalStateHash: 'abc',
      faults: {
        X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
        O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      },
    };
    await bot.finish(sampleMatchResult);

    // Wait for the bot to process all incoming lines
    await new Promise((r) => setTimeout(r, 60));

    expect(capturedStderr).toContain('RECEIVED:INIT');
    expect(capturedStderr).toContain('RECEIVED:STATE_UPDATE');
    expect(capturedStderr).toContain('RECEIVED:TURN_RESULT');
    expect(capturedStderr).toContain('RECEIVED:MATCH_RESULT');
  });

  it('8. Chunking: chunked ACTION and split UTF-8 -> ok: true; two lines in one chunk discards the second', { timeout: 5000 }, async () => {
    // 8a. Chunked ACTION across multiple chunks with delays -> ok: true
    const chunkedBot = trackBot(createBot(chunkedBotPath));
    const startRes = await chunkedBot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    const reply1 = await chunkedBot.requestAction(sampleUpdate, 1000);
    expect(reply1.ok).toBe(true);
    if (reply1.ok) {
      expect(reply1.message.type).toBe('ACTION');
      expect(reply1.message.action.pieceId).toBe('X-ROCK-1');
    }

    // 8b. Split UTF-8 across chunk boundaries -> ok: true
    const splitUtf8Bot = trackBot(
      createBot(chunkedBotPath, ['--with-utf8'], {
        validator: { isProtocolMessage: () => true },
      }),
    );
    const startResUtf8 = await splitUtf8Bot.start(sampleInit);
    expect(startResUtf8.ok).toBe(true);

    const replyUtf8 = await splitUtf8Bot.requestAction(sampleUpdate, 1000);
    expect(replyUtf8.ok).toBe(true);
    if (replyUtf8.ok) {
      expect(replyUtf8.message.type).toBe('ACTION');
      expect(replyUtf8.message.action.pieceId).toBe('X-đ-1');
    }

    // 8c. Two lines in one chunk -> first answers the request, second discarded as unexpected
    const twoLinesBot = trackBot(createBot(twoLinesBotPath));
    const startRes2 = await twoLinesBot.start(sampleInit);
    expect(startRes2.ok).toBe(true);

    // Turn 1: bot writes action1 + action2 in one chunk
    const turn1Reply = await twoLinesBot.requestAction(sampleUpdate, 1000);
    expect(turn1Reply.ok).toBe(true);
    if (turn1Reply.ok) {
      expect(turn1Reply.message.turnId).toBe(1);
    }

    // The second line in that chunk was discarded as unexpected
    expect(twoLinesBot.unexpectedLines).toBe(1);

    // Turn 2: bot writes action3; it does NOT receive the discarded action2
    const turn2Reply = await twoLinesBot.requestAction({ ...sampleUpdate, turnId: 2 }, 1000);
    expect(turn2Reply.ok).toBe(true);
    if (turn2Reply.ok) {
      expect(turn2Reply.message.turnId).toBe(2);
    }
    expect(twoLinesBot.unexpectedLines).toBe(1);
  });

  describe('9. Per-line errors and no poisoning', () => {
    it.each([
      { name: 'non-JSON', mode: 'non-json', expectedError: 'MALFORMED_JSON' },
      { name: 'JSON array', mode: 'json-array', expectedError: 'MALFORMED_JSON' },
      { name: 'schema-invalid object', mode: 'schema-invalid', expectedError: 'SCHEMA_VIOLATION' },
      { name: 'INIT-typed message from bot', mode: 'init-typed', expectedError: 'SCHEMA_VIOLATION' },
      { name: 'line over maxMessageBytes', mode: 'oversize', expectedError: 'MESSAGE_TOO_LARGE' },
    ])('$name -> $expectedError, then next request on same process succeeds', { timeout: 5000 }, async ({ mode, expectedError }) => {
      const bot = trackBot(createBot(garbageBotPath, [mode]));
      const startRes = await bot.start(sampleInit);
      expect(startRes.ok).toBe(true);

      // Turn 1 produces the targeted per-line error
      const reply1 = await bot.requestAction(sampleUpdate, 1000);
      expect(reply1.ok).toBe(false);
      if (!reply1.ok) {
        expect(reply1.code).toBe(expectedError);
      }

      // Turn 2 produces a valid ACTION (verifying no adapter or process poisoning)
      const reply2 = await bot.requestAction({ ...sampleUpdate, turnId: 2 }, 1000);
      expect(reply2.ok).toBe(true);
      if (reply2.ok) {
        expect(reply2.message.type).toBe('ACTION');
        expect(reply2.message.turnId).toBe(2);
      }
    });
  });

  it('10. Unsolicited line before any request: discarded, counted, first request gets right answer', { timeout: 5000 }, async () => {
    const bot = trackBot(createBot(unsolicitedBotPath));
    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    await waitFor(() => bot.unexpectedLines === 1, 'startup unsolicited line');
    expect(bot.unexpectedLines).toBe(1);

    const reply = await bot.requestAction(sampleUpdate, 1000);
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      expect(reply.message.type).toBe('ACTION');
    }
  });

  it('11. stderr separation: JSON-looking stderr never becomes a reply; stderrBytes equals bytes written', { timeout: 5000 }, async () => {
    let capturedBytes = 0;
    const bot = trackBot(
      createBot(stderrNoiseBotPath, [], {
        onStderr: (chunk) => {
          capturedBytes += chunk.byteLength;
        },
      }),
    );

    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(true);

    const reply = await bot.requestAction(sampleUpdate, 1000);
    expect(reply.ok).toBe(true);
    if (reply.ok) {
      // Must receive the stdout action, NOT the stderr fake action
      expect(reply.message.action.pieceId).toBe('X-ROCK-1');
      expect(reply.message.action.pieceId).not.toBe('FAKE-PIECE');
    }

    expect(bot.stderrBytes).toBeGreaterThan(0);
    expect(bot.stderrBytes).toBe(capturedBytes);
  });

  it('12. Wrong matchId, turnId, and illegal action are passed through as ok: true (adapter does not judge them)', { timeout: 5000 }, async () => {
    // 12a: Wrong matchId
    const botWrongMatch = trackBot(createBot(echoBotPath, ['--pass-through-wrong-match-id']));
    await botWrongMatch.start(sampleInit);
    const replyMatch = await botWrongMatch.requestAction(sampleUpdate, 1000);
    expect(replyMatch.ok).toBe(true);
    if (replyMatch.ok) {
      expect(replyMatch.message.matchId).toBe('wrong-match-id');
    }

    // 12b: Wrong turnId
    const botWrongTurn = trackBot(createBot(echoBotPath, ['--pass-through-wrong-turn-id']));
    await botWrongTurn.start(sampleInit);
    const replyTurn = await botWrongTurn.requestAction(sampleUpdate, 1000);
    expect(replyTurn.ok).toBe(true);
    if (replyTurn.ok) {
      expect(replyTurn.message.turnId).toBe(9999);
    }

    // 12c: Illegal action (to: { col: 5, row: 5 } not in legalActions)
    const botIllegalAction = trackBot(createBot(echoBotPath, ['--pass-through-illegal-action']));
    await botIllegalAction.start(sampleInit);
    const replyIllegal = await botIllegalAction.requestAction(sampleUpdate, 1000);
    expect(replyIllegal.ok).toBe(true);
    if (replyIllegal.ok) {
      expect(replyIllegal.message.action).toEqual({ pieceId: 'X-ROCK-1', to: { col: 5, row: 5 } });
    }
  });

  it('13. Boundary check: imports and child_process restriction', () => {
    const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
    const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      const content = readFileSync(new URL(file, new URL('../src/', import.meta.url)), 'utf-8');
      if (file === 'bot-process.ts') {
        // bot-process is the ONLY file allowed to import child_process
        expect(content).toContain('node:child_process');
        // game-core can only be imported via `import type`
        if (content.includes('@ott/game-core')) {
          expect(content).toMatch(/import\s+type\s+.*from\s+['"]@ott\/game-core['"]/);
        }
      } else if (file === 'line-buffer.ts') {
        // line-buffer must not import child_process or fs
        expect(content).not.toContain('node:child_process');
        expect(content).not.toContain('node:fs');
        expect(content).not.toContain('@ott/game-core');
      } else {
        // No other match-runner src file may import child_process
        expect(content).not.toContain('child_process');
      }
    }
  });

  it('14. Spawn failure reports BOT_SPAWN_FAILED cleanly', { timeout: 5000 }, async () => {
    const bot = trackBot(
      new BotProcess({
        executable: 'nonexistent-executable-that-does-not-exist',
        args: [],
        validator,
        maxMessageBytes: 65536,
      }),
    );
    const startRes = await bot.start(sampleInit);
    expect(startRes.ok).toBe(false);
    if (!startRes.ok) {
      expect(startRes.code).toBe('BOT_SPAWN_FAILED');
    }
  });
});
