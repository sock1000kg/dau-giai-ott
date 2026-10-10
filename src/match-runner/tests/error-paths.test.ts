/**
 * P1-D04 — MatchRunner error, skip and cleanup policy.
 *
 * AC coverage (tasks/todo.md → P1-D04):
 * - AC 1 (every error produces the right event and skip/forfeit): tests 1–9.
 * - AC 2 (a faulty action is never applied, the result is never sent twice): tests 1, 8, 10.
 * - AC 3 (both BotPorts always close in `finally`): tests 9, 12.
 *
 * Policy source of truth: `docs/contracts/bot-protocol-v1.md` §6, with limits from §3.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, PROTOCOL_VERSION, PROCESS_FAULT_CODES } from '@ott/bot-protocol';
import type {
  ActionMessage,
  FaultSummary,
  Limits,
  MatchResultMessage,
  ProcessFaultCode,
  ProtocolMessage,
  StateUpdateMessage,
  TurnResultMessage,
} from '@ott/bot-protocol';
import type { GameAction, MapDefinition, PlayerSide } from '@ott/game-core';

import { FakeGame, ScriptedBot, runMatch } from '../src/index.ts';
import type {
  MatchConfig,
  MatchPorts,
  MatchReport,
  ScriptedReply,
} from '../src/index.ts';

const MATCH_ID = 'match-errors';
const SEED = 'seed-errors';
const LEGAL_X: GameAction = { pieceId: 'X1', to: { col: 0, row: 0 } };
const LEGAL_O: GameAction = { pieceId: 'O1', to: { col: 0, row: 0 } };
const ILLEGAL: GameAction = { pieceId: 'X1', to: { col: 5, row: 5 } };

type RecoverableCode =
  | 'BOT_TIMEOUT'
  | 'MALFORMED_JSON'
  | 'SCHEMA_VIOLATION'
  | 'MESSAGE_TOO_LARGE'
  | 'MATCH_ID_MISMATCH'
  | 'TURN_ID_MISMATCH'
  | 'ILLEGAL_ACTION';

function makeMap(): MapDefinition {
  return {
    schemaVersion: 1,
    mapId: 'error-map',
    version: 1,
    checksum: 'd'.repeat(64),
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

function makeLimits(maxTurns: number, overrides: Partial<Limits> = {}): Limits {
  return { ...DEFAULT_LIMITS, maxTurns, ...overrides };
}

function makeConfig(maxTurns = 8, limits = makeLimits(maxTurns)): MatchConfig {
  return {
    matchId: MATCH_ID,
    seed: SEED,
    game: { gameId: MATCH_ID, engineVersion: '1.0.0', map: makeMap(), maxTurns },
    limits,
  };
}

/** A valid ACTION with the given id overrides, for mismatch cases. */
function rawAction(overrides: Partial<ActionMessage> = {}): ActionMessage {
  return {
    type: 'ACTION',
    protocolVersion: PROTOCOL_VERSION,
    matchId: MATCH_ID,
    turnId: 1,
    action: LEGAL_X,
    ...overrides,
  };
}

function ok(side: PlayerSide, times = 8): ScriptedReply[] {
  const action = side === 'X' ? LEGAL_X : LEGAL_O;
  return Array.from({ length: times }, () => ({ kind: 'action' as const, action }));
}

interface Harness {
  readonly ports: MatchPorts;
  readonly game: FakeGame;
  readonly x: ScriptedBot;
  readonly o: ScriptedBot;
}

function makeHarness(xReplies: readonly ScriptedReply[], oReplies: readonly ScriptedReply[]): Harness {
  const game = new FakeGame();
  const x = new ScriptedBot({ replies: xReplies });
  const o = new ScriptedBot({ replies: oReplies });
  return { ports: { game, bots: { X: x, O: o } }, game, x, o };
}

function transcript(bot: ScriptedBot): readonly ProtocolMessage['type'][] {
  return bot.received.map((message) => message.type);
}

function ofType<T extends ProtocolMessage['type']>(
  messages: readonly ProtocolMessage[],
  type: T,
): Extract<ProtocolMessage, { type: T }>[] {
  return messages.filter(
    (message): message is Extract<ProtocolMessage, { type: T }> => message.type === type,
  );
}

function updates(bot: ScriptedBot): StateUpdateMessage[] {
  return ofType(bot.received, 'STATE_UPDATE');
}

function turnResults(bot: ScriptedBot): TurnResultMessage[] {
  return ofType(bot.received, 'TURN_RESULT');
}

function matchResults(bot: ScriptedBot): MatchResultMessage[] {
  return ofType(bot.received, 'MATCH_RESULT');
}

function countCalls(game: FakeGame, name: string): number {
  return game.calls.filter((entry) => entry === name).length;
}

describe('P1-D04 recoverable turn faults', () => {
  const RECOVERABLE: ReadonlyArray<readonly [RecoverableCode, (turnId: number) => ScriptedReply]> = [
    ['BOT_TIMEOUT', () => ({ kind: 'error', code: 'BOT_TIMEOUT' })],
    ['MALFORMED_JSON', () => ({ kind: 'error', code: 'MALFORMED_JSON' })],
    ['SCHEMA_VIOLATION', () => ({ kind: 'error', code: 'SCHEMA_VIOLATION' })],
    ['MESSAGE_TOO_LARGE', () => ({ kind: 'error', code: 'MESSAGE_TOO_LARGE' })],
    ['MATCH_ID_MISMATCH', (turnId) => ({ kind: 'raw', message: rawAction({ matchId: 'other', turnId }) })],
    ['TURN_ID_MISMATCH', (turnId) => ({ kind: 'raw', message: rawAction({ turnId: turnId + 99 }) })],
    ['ILLEGAL_ACTION', (turnId) => ({ kind: 'action', action: ILLEGAL })],
  ];

  it.each(RECOVERABLE)('1. %s skips the turn exactly once and counts one fault', async (code, replyFor) => {
    // One turn only: the skip hits maxTurns, so the match ends as a TURN_LIMIT draw.
    const { ports, game, x } = makeHarness([replyFor(1)], ok('O'));

    const report = await runMatch(makeConfig(1), ports);

    // Never applied, skipped exactly once.
    expect(countCalls(game, 'apply')).toBe(0);
    expect(countCalls(game, 'skip')).toBe(1);
    expect(countCalls(game, 'forfeit')).toBe(0);

    const turnResult = turnResults(x)[0];
    expect(turnResult?.outcome).toBe('SKIPPED');
    expect(turnResult?.errorCode).toBe(code);
    expect(turnResult?.action).toBeNull();

    const skipped = report.events.filter((event) => event.type === 'TURN_SKIPPED');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toBe(code);

    expect(report.faults.X).toEqual({
      recoverableTotal: 1,
      recoverableConsecutive: 1,
      lastErrorCode: code,
    });
    expect(report.result.reason).toBe('TURN_LIMIT');
  });

  it('2. detects matchId before turnId before legality', async () => {
    const both = makeHarness(
      [{ kind: 'raw', message: rawAction({ matchId: 'other', turnId: 99, action: ILLEGAL }) }],
      ok('O'),
    );
    const first = await runMatch(makeConfig(1), both.ports);
    expect(first.faults.X.lastErrorCode).toBe('MATCH_ID_MISMATCH');

    const wrongTurn = makeHarness(
      [{ kind: 'raw', message: rawAction({ turnId: 99, action: ILLEGAL }) }],
      ok('O'),
    );
    const second = await runMatch(makeConfig(1), wrongTurn.ports);
    expect(second.faults.X.lastErrorCode).toBe('TURN_ID_MISMATCH');
  });

  it('3. a valid action resets the consecutive counter but not the total', async () => {
    const { ports, game } = makeHarness(
      [
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'action', action: LEGAL_X },
        { kind: 'error', code: 'BOT_TIMEOUT' },
      ],
      ok('O'),
    );

    // X moves on odd turns, so its four scripted replies need eight turns.
    const report = await runMatch(makeConfig(8), ports);

    expect(report.faults.X.recoverableTotal).toBe(3);
    expect(report.faults.X.recoverableConsecutive).toBe(1);
    expect(report.faults.X.lastErrorCode).toBe('BOT_TIMEOUT');
    expect(countCalls(game, 'forfeit')).toBe(0);
    expect(report.result.reason).toBe('TURN_LIMIT');
    expect(report.result.winnerSide).toBeNull();
  });

  it('4. three consecutive faults forfeit the match after broadcasting the skip', async () => {
    const { ports, game, x, o } = makeHarness(
      [
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
      ],
      ok('O'),
    );

    const report = await runMatch(makeConfig(20), ports);

    expect(report.faults.X).toEqual({
      recoverableTotal: 3,
      recoverableConsecutive: 3,
      lastErrorCode: 'BOT_TIMEOUT',
    });
    expect(countCalls(game, 'forfeit')).toBe(1);
    expect(report.result.reason).toBe('FORFEIT');
    expect(report.result.winnerSide).toBe('O');
    expect(report.result.forfeitedSide).toBe('X');
    expect(report.events.slice(-2).map((event) => event.type)).toEqual(['TURN_SKIPPED', 'MATCH_FINISHED']);

    // The threshold turn still got its TURN_RESULT, then exactly one MATCH_RESULT each.
    // A recoverable threshold forfeit does not kill the bot, so it stays in the broadcast.
    expect(turnResults(x)).toHaveLength(5);
    expect(turnResults(x).at(-1)?.errorCode).toBe('BOT_TIMEOUT');
    expect(turnResults(x).at(-1)?.outcome).toBe('SKIPPED');
    expect(matchResults(x)).toHaveLength(1);
    expect(matchResults(o)).toHaveLength(1);
    expect(transcript(x).at(-1)).toBe('MATCH_RESULT');
  });

  it('5. five total faults forfeit even when never consecutive', async () => {
    const error = (): ScriptedReply => ({ kind: 'error', code: 'BOT_TIMEOUT' });
    const valid = (): ScriptedReply => ({ kind: 'action', action: LEGAL_X });
    const { ports, game } = makeHarness(
      [error(), valid(), error(), valid(), error(), valid(), error(), valid(), error()],
      ok('O'),
    );

    const report = await runMatch(makeConfig(20), ports);

    expect(report.faults.X.recoverableTotal).toBe(5);
    expect(report.faults.X.recoverableConsecutive).toBe(1);
    expect(countCalls(game, 'forfeit')).toBe(1);
    expect(report.result.reason).toBe('FORFEIT');
    expect(report.result.winnerSide).toBe('O');
  });

  it('6. NO_LEGAL_ACTION is a skip but never a fault', async () => {
    const game = new FakeGame({ legalActions: [] });
    const x = new ScriptedBot({ replies: [] });
    const o = new ScriptedBot({ replies: [] });
    const report = await runMatch(makeConfig(4), { game, bots: { X: x, O: o } });

    const zero: FaultSummary = { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null };
    expect(report.faults).toEqual({ X: zero, O: zero });
    expect(countCalls(game, 'forfeit')).toBe(0);
    expect(report.result.reason).toBe('TURN_LIMIT');
  });

  it('7. a skip that ends the match does not also forfeit', async () => {
    // maxTurns 1 and maxTotalFaults 1: the threshold is reached on the very turn the
    // match ends, so the skip must not trigger a forfeit.
    const { ports, game, x, o } = makeHarness(
      [{ kind: 'error', code: 'BOT_TIMEOUT' }],
      ok('O'),
    );

    const report = await runMatch(makeConfig(1, makeLimits(1, { maxTotalFaults: 1 })), ports);

    expect(report.faults.X.recoverableTotal).toBe(1);
    expect(countCalls(game, 'forfeit')).toBe(0);
    expect(report.result.reason).toBe('TURN_LIMIT');
    expect(matchResults(x)).toHaveLength(1);
    expect(matchResults(o)).toHaveLength(1);
  });
});

describe('P1-D04 process faults', () => {
  it.each(PROCESS_FAULT_CODES)(
    '8. %s forfeits immediately and reaches only the living bot',
    async (code: ProcessFaultCode) => {
      const { ports, game, x, o } = makeHarness(ok('X'), [{ kind: 'error', code }]);

      const report = await runMatch(makeConfig(20), ports);

      // No skip, and no TURN_RESULT for the fatal turn itself. O was still alive when
      // turn 1 was adjudicated, so it keeps exactly that one TURN_RESULT.
      expect(countCalls(game, 'skip')).toBe(0);
      expect(turnResults(x).map((message) => message.turnId)).toEqual([1]);
      expect(turnResults(o).map((message) => message.turnId)).toEqual([1]);
      expect(countCalls(game, 'forfeit')).toBe(1);

      expect(report.result.reason).toBe('FORFEIT');
      expect(report.result.winnerSide).toBe('X');
      expect(report.result.forfeitedSide).toBe('O');
      expect(report.faults.O).toEqual({
        recoverableTotal: 0,
        recoverableConsecutive: 0,
        lastErrorCode: code,
      });

      // X gets exactly one MATCH_RESULT and it is its last message; O gets none and its
      // last message is the STATE_UPDATE of the fatal turn.
      expect(matchResults(x)).toHaveLength(1);
      expect(transcript(x).at(-1)).toBe('MATCH_RESULT');
      expect(matchResults(o)).toHaveLength(0);
      expect(transcript(o).at(-1)).toBe('STATE_UPDATE');
      expect(updates(o)).toHaveLength(1);
    },
  );

  it('9. a failed start forfeits that side, still starts the other bot, and sends one result', async () => {
    const game = new FakeGame();
    const x = new ScriptedBot({
      replies: [],
      startResult: { ok: false, code: 'BOT_SPAWN_FAILED' },
    });
    const o = new ScriptedBot({ replies: ok('O') });

    const report = await runMatch(makeConfig(4), { game, bots: { X: x, O: o } });

    // Both sides are still started, X first, deterministically. The bot whose start
    // failed received no INIT, so it holds no message at all.
    expect(transcript(x)).toEqual([]);
    expect(transcript(o)[0]).toBe('INIT');
    // Nobody is asked for a turn.
    expect(updates(x)).toHaveLength(0);
    expect(updates(o)).toHaveLength(0);
    expect(countCalls(game, 'forfeit')).toBe(1);
    expect(report.result.reason).toBe('FORFEIT');
    expect(report.result.winnerSide).toBe('O');

    // Only the bot that started successfully receives the result.
    expect(matchResults(x)).toHaveLength(0);
    expect(matchResults(o)).toHaveLength(1);
    expect(report.faults.X.lastErrorCode).toBe('BOT_SPAWN_FAILED');
    expect(report.faults.O.recoverableTotal).toBe(0);

    // Cleanup still happens for both.
    expect(x.stopCalls).toBe(1);
    expect(o.stopCalls).toBe(1);
  });

  it('9b. when both starts fail the first side (X) is forfeited and nobody gets a result', async () => {
    const game = new FakeGame();
    const x = new ScriptedBot({ replies: [], startResult: { ok: false, code: 'BOT_SPAWN_FAILED' } });
    const o = new ScriptedBot({ replies: [], startResult: { ok: false, code: 'BOT_SPAWN_FAILED' } });

    const report = await runMatch(makeConfig(4), { game, bots: { X: x, O: o } });

    expect(countCalls(game, 'forfeit')).toBe(1);
    expect(report.result.reason).toBe('FORFEIT');
    expect(report.result.winnerSide).toBe('O');
    expect(report.result.forfeitedSide).toBe('X');
    expect(matchResults(x)).toHaveLength(0);
    expect(matchResults(o)).toHaveLength(0);
    expect(x.stopCalls).toBe(1);
    expect(o.stopCalls).toBe(1);
  });
});

describe('P1-D04 results, cleanup and boundaries', () => {
  it('10. exactly one MATCH_RESULT per living bot and nothing after it', async () => {
    const forfeit = makeHarness(
      [
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
      ],
      ok('O'),
    );
    const first = await runMatch(makeConfig(20), forfeit.ports);
    expect(matchResults(forfeit.x)).toHaveLength(1);
    expect(matchResults(forfeit.o)).toHaveLength(1);
    for (const bot of [forfeit.x, forfeit.o]) {
      const types = transcript(bot);
      expect(types.filter((type) => type === 'MATCH_RESULT')).toHaveLength(1);
      expect(types.indexOf('MATCH_RESULT')).toBe(types.length - 1);
    }
    expect(first.result.reason).toBe('FORFEIT');

    const crashed = makeHarness(ok('X'), [{ kind: 'error', code: 'BOT_CRASHED' }]);
    await runMatch(makeConfig(20), crashed.ports);
    expect(matchResults(crashed.x)).toHaveLength(1);
    expect(matchResults(crashed.o)).toHaveLength(0);

    const spawnFailed = makeHarness([], ok('O'));
    await runMatch(makeConfig(4), spawnFailed.ports);
    expect(matchResults(spawnFailed.x)).toHaveLength(0);
    expect(matchResults(spawnFailed.o)).toHaveLength(1);
  });

  it('11. MATCH_RESULT faults equal the report faults but are a separate object graph', async () => {
    const { ports, x } = makeHarness(
      [
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
      ],
      ok('O'),
    );

    const report = await runMatch(makeConfig(20), ports);

    const message = matchResults(x)[0] as MatchResultMessage;
    expect(message.faults.X).toEqual(report.faults.X);
    expect(message.faults.X).not.toBe(report.faults.X);
    expect(message.faults.X).not.toBe(message.faults.O);

    (message.faults.X as { recoverableTotal: number }).recoverableTotal = 99;
    expect(report.faults.X.recoverableTotal).toBe(3);
    expect(message.faults.O.recoverableTotal).toBe(0);
  });

  it('12. cleanup always runs, and unexpected exceptions propagate unchanged', async () => {
    const boom = new Error('adapter bug');
    const throwingBot = makeHarness([{ kind: 'throw', error: boom }], ok('O'));
    await expect(runMatch(makeConfig(20), throwingBot.ports)).rejects.toBe(boom);
    expect(throwingBot.x.stopCalls).toBe(1);
    expect(throwingBot.o.stopCalls).toBe(1);

    const engineBoom = new Error('engine exploded');
    class ThrowingGame extends FakeGame {
      override apply(...args: Parameters<FakeGame['apply']>): ReturnType<FakeGame['apply']> {
        throw engineBoom;
      }
    }
    const engineGame = new ThrowingGame();
    const ex = new ScriptedBot({ replies: ok('X') });
    const eo = new ScriptedBot({ replies: ok('O') });
    await expect(
      runMatch(makeConfig(20), { game: engineGame, bots: { X: ex, O: eo } }),
    ).rejects.toBe(engineBoom);
    expect(ex.stopCalls).toBe(1);
    expect(eo.stopCalls).toBe(1);

    const processFault = makeHarness(ok('X'), [{ kind: 'error', code: 'BOT_EOF' }]);
    await runMatch(makeConfig(20), processFault.ports);
    expect(processFault.x.stopCalls).toBe(1);
    expect(processFault.o.stopCalls).toBe(1);

    const thresholded = makeHarness(
      [
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
        { kind: 'error', code: 'BOT_TIMEOUT' },
      ],
      ok('O'),
    );
    await runMatch(makeConfig(20), thresholded.ports);
    expect(thresholded.x.stopCalls).toBe(1);
    expect(thresholded.o.stopCalls).toBe(1);
  });

  it('13. the same scripted run twice produces equal reports and transcripts', async () => {
    const runOnce = async (): Promise<{
      readonly report: MatchReport;
      readonly x: readonly ProtocolMessage[];
      readonly o: readonly ProtocolMessage[];
    }> => {
      const error = (): ScriptedReply => ({ kind: 'error', code: 'BOT_TIMEOUT' });
      const valid = (): ScriptedReply => ({ kind: 'action', action: LEGAL_X });
      const harness = makeHarness(
        [error(), valid(), error(), valid(), error(), valid(), error(), valid(), error()],
        ok('O'),
      );
      const report = await runMatch(makeConfig(20), harness.ports);
      return { report, x: harness.x.received, o: harness.o.received };
    };

    const first = await runOnce();
    const second = await runOnce();

    expect(first.report).toEqual(second.report);
    expect(first.x).toEqual(second.x);
    expect(first.o).toEqual(second.o);
  });

  it('14. keeps the module boundary in errors.ts and match-runner.ts', () => {
    const read = (name: string): string =>
      readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

    // Whole import statements, exact counts so the check cannot go vacuous.
    const ottImports = /^import\s+(?<kind>type\s+)?(?:[^;]*?)\bfrom\s+'(?<module>@ott\/[^']+)'/gm;
    const counts: Readonly<Record<string, number>> = {
      '../src/errors.ts': 3,
      '../src/match-runner.ts': 3,
    };

    for (const file of Object.keys(counts)) {
      const source = read(file);
      expect(source).not.toMatch(/child_process/);
      expect(source).not.toMatch(/^import\s+'@ott\//m);
      expect(source).not.toMatch(/^export\s+(?!type)[^;]*from\s+'@ott\//m);

      const matches = [...source.matchAll(ottImports)];
      expect(matches).toHaveLength(counts[file] as number);
      for (const match of matches) {
        expect(match.groups?.['module']).toMatch(/^@ott\/(game-core|bot-protocol)$/);
        // Every @ott/game-core import is type-only. @ott/bot-protocol may additionally be
        // imported for its runtime constants; errors.ts is the only such case and it is
        // checked separately below.
        if (match.groups?.['module'] === '@ott/game-core') {
          expect(match.groups?.['kind']).toBe('type ');
        }
      }
    }

    const runner = read('../src/match-runner.ts');
    const runtimeOtt = [...runner.matchAll(ottImports)].filter((m) => m.groups?.['kind'] === undefined);
    expect(runtimeOtt.map((m) => m.groups?.['module'])).toEqual(['@ott/bot-protocol']);

    // errors.ts may import PROCESS_FAULT_CODES at runtime, and only that.
    const errorSource = read('../src/errors.ts');
    const errorRuntime = [...errorSource.matchAll(ottImports)].filter(
      (m) => m.groups?.['kind'] === undefined,
    );
    expect(errorRuntime).toHaveLength(1);
    expect(errorRuntime[0]?.groups?.['module']).toBe('@ott/bot-protocol');
    expect(errorRuntime[0]?.[0]).toContain('PROCESS_FAULT_CODES');
    for (const banned of [/\bDate\b/, /Math\.random/, /setTimeout/, /setInterval/, /node:crypto/]) {
      expect(runner).not.toMatch(banned);
    }
    // The D04 policy must not re-list the protocol's own code unions.
    for (const code of ['BOT_SPAWN_FAILED', 'BOT_CRASHED', 'STDERR_LIMIT_EXCEEDED']) {
      expect(read('../src/errors.ts')).not.toMatch(new RegExp(`'${code}'`));
    }
    expect(runner).not.toMatch(/UNHANDLED_BOT_FAILURE/);
  });
});
