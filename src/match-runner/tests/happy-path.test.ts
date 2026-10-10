/**
 * P1-D03 — MatchRunner happy path.
 *
 * AC coverage (tasks/todo.md → P1-D03):
 * - AC 1 (INIT once, only ask the right bot): tests 1, 2.
 * - AC 2 (valid actions applied and broadcast in order): tests 3, 4, 6, 7.
 * - AC 3 (one consistent result at the end): tests 5, 8.
 *
 * Only `FakeGame` + `ScriptedBot` are used, imported from the package's own public
 * entrypoint, so the test also pins that `../src/index.ts` re-exports everything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, PROTOCOL_VERSION } from '@ott/bot-protocol';
import type {
  InitMessage,
  Limits,
  MatchResultMessage,
  ProtocolMessage,
  StateUpdateMessage,
  TurnResultMessage,
} from '@ott/bot-protocol';
import type { GameAction, GameResult, MapDefinition, PlayerSide } from '@ott/game-core';

import {
  FakeGame,
  MatchRunnerError,
  ScriptedBot,
  runMatch,
} from '../src/index.ts';
import type {
  FakeGameOptions,
  MatchConfig,
  MatchPorts,
  MatchReport,
  ScriptedReply,
} from '../src/index.ts';

const MAP_CHECKSUM = 'c'.repeat(64);
const MATCH_ID = 'match-happy';
const SEED = 'seed-happy';

function makeMap(): MapDefinition {
  return {
    schemaVersion: 1,
    mapId: 'happy-map',
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

function makeLimits(maxTurns: number): Limits {
  return { ...DEFAULT_LIMITS, maxTurns };
}

function makeConfig(maxTurns = 4, limitsMaxTurns = maxTurns): MatchConfig {
  return {
    matchId: MATCH_ID,
    seed: SEED,
    game: { gameId: MATCH_ID, engineVersion: '1.0.0', map: makeMap(), maxTurns },
    limits: makeLimits(limitsMaxTurns),
  };
}

/** Default `FakeGame` script: one legal action per side, in Engine API ordering. */
function defaultActions(): { X: GameAction; O: GameAction } {
  return {
    X: { pieceId: 'X1', to: { col: 0, row: 0 } },
    O: { pieceId: 'O1', to: { col: 0, row: 0 } },
  };
}

/** A bot script of `count` copies of that side's own legal action. */
function actionReplies(count: number, side: PlayerSide = 'X'): ScriptedReply[] {
  return Array.from({ length: count }, () => ({
    kind: 'action' as const,
    action: defaultActions()[side],
  }));
}

interface Harness {
  readonly ports: MatchPorts;
  readonly x: ScriptedBot;
  readonly o: ScriptedBot;
  readonly game: FakeGame;
}

function makeHarness(gameOptions: FakeGameOptions = {}, replies: number = 8): Harness {
  const game = new FakeGame(gameOptions);
  const x = new ScriptedBot({ replies: actionReplies(replies, 'X') });
  const o = new ScriptedBot({ replies: actionReplies(replies, 'O') });
  return { ports: { game, bots: { X: x, O: o } }, x, o, game };
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

function matchResultOf(bot: ScriptedBot): MatchResultMessage {
  const found = ofType(bot.received, 'MATCH_RESULT');
  expect(found).toHaveLength(1);
  return found[0] as MatchResultMessage;
}

function expectResultMatches(report: MatchReport, result: GameResult): void {
  expect(report.result.winnerSide).toBe(result.winnerSide);
  expect(report.result.reason).toBe(result.reason);
  expect(report.result.turnCount).toBe(result.turnCount);
  expect(report.result.finalStateHash).toBe(result.finalStateHash);
}

async function expectRunnerError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(MatchRunnerError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('P1-D03 MatchRunner happy path', () => {
  it('1. sends INIT exactly once per bot, first, with the full INIT payload', async () => {
    const config = makeConfig();
    const { ports, x, o } = makeHarness();

    await runMatch(config, ports);

    for (const [bot, side] of [
      [x, 'X'],
      [o, 'O'],
    ] as const) {
      const received = bot.received;
      const inits = ofType(received, 'INIT');
      expect(inits).toHaveLength(1);
      expect(received[0]?.type).toBe('INIT');
      expect(inits[0]).toEqual({
        type: 'INIT',
        protocolVersion: PROTOCOL_VERSION,
        matchId: MATCH_ID,
        engineVersion: '1.0.0',
        side,
        seed: SEED,
        map: makeMap(),
        limits: makeLimits(4),
      } satisfies InitMessage);
    }
  });

  it('2. asks only the active bot, in alternating turnId order, with the turn timeout', async () => {
    const { ports, x, o } = makeHarness();
    const config = makeConfig(4);

    await runMatch(config, ports);

    expect(updates(x).map((update) => update.turnId)).toEqual([1, 3]);
    expect(updates(o).map((update) => update.turnId)).toEqual([2, 4]);
    for (const bot of [x, o]) {
      expect(bot.requestedTimeouts).toEqual([3000, 3000]);
      expect(bot.requestedTimeouts.every((ms) => ms === config.limits.turnTimeoutMs)).toBe(true);
    }
  });

  it('3. projects a public state with no gameId and the engine legal actions', async () => {
    const { ports, x, o, game } = makeHarness();
    await runMatch(makeConfig(4), ports);

    for (const [bot, side] of [
      [x, 'X'],
      [o, 'O'],
    ] as const) {
      for (const update of updates(bot)) {
        expect(Object.keys(update.state)).not.toContain('gameId');
        expect(update.state.status).toBe('PLAYING');
        expect(update.state.outcome).toBeNull();
        expect(update.state.turn).toBe(side);
        expect(update.state.turnNumber).toBe(update.turnId);
        expect(update.legalActions).toEqual(game.listLegalActions({} as never, side));
        expect(update.matchId).toBe(MATCH_ID);
        expect(update.protocolVersion).toBe(PROTOCOL_VERSION);
      }
    }
  });

  it('4. applies valid actions and broadcasts TURN_RESULT to both bots in order', async () => {
    const { ports, x, o } = makeHarness();

    await runMatch(makeConfig(4), ports);

    expect(transcript(x)).toEqual([
      'INIT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'TURN_RESULT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'TURN_RESULT',
      'MATCH_RESULT',
    ]);
    // O is never asked for a turn before X has acted, so its first message after INIT is
    // the TURN_RESULT of turn 1.
    expect(transcript(o)).toEqual([
      'INIT',
      'TURN_RESULT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'TURN_RESULT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'MATCH_RESULT',
    ]);

    const xTurns = turnResults(x);
    const oTurns = turnResults(o);
    expect(xTurns).toHaveLength(4);
    expect(oTurns).toHaveLength(4);

    // The k-th TURN_RESULT is the same object value for both bots.
    for (let k = 0; k < 4; k += 1) {
      expect(xTurns[k]).toEqual(oTurns[k]);
    }

    expect(xTurns.map((message) => message.turnId)).toEqual([1, 2, 3, 4]);
    expect(xTurns.map((message) => message.actorSide)).toEqual(['X', 'O', 'X', 'O']);
    expect(xTurns.map((message) => message.revision)).toEqual([1, 2, 3, 4]);
    expect(xTurns.map((message) => message.outcome)).toEqual([
      'APPLIED',
      'APPLIED',
      'APPLIED',
      'APPLIED',
    ]);
    expect(xTurns.map((message) => message.errorCode)).toEqual([null, null, null, null]);
    expect(xTurns[0]?.action).toEqual(defaultActions().X);
    expect(xTurns[1]?.action).toEqual(defaultActions().O);
    expect(xTurns.map((message) => message.nextSide)).toEqual(['O', 'X', 'O', null]);
  });

  it('5. sends exactly one consistent MATCH_RESULT to both bots', async () => {
    const { ports, x, o, game } = makeHarness();

    const report = await runMatch(makeConfig(4), ports);

    const xResult = matchResultOf(x);
    const oResult = matchResultOf(o);
    expect(xResult).toEqual(oResult);
    expect(transcript(x).at(-1)).toBe('MATCH_RESULT');
    expect(transcript(o).at(-1)).toBe('MATCH_RESULT');

    const expected = game.result(report.finalState) as GameResult;
    expect(xResult).toEqual({
      type: 'MATCH_RESULT',
      protocolVersion: PROTOCOL_VERSION,
      matchId: MATCH_ID,
      winnerSide: expected.winnerSide,
      reason: 'TURN_LIMIT',
      turnCount: expected.turnCount,
      finalStateHash: expected.finalStateHash,
      faults: {
        X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
        O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      },
    } satisfies MatchResultMessage);
    expect(xResult.reason).toBe('TURN_LIMIT');
  });

  it('6. stops after a scripted win on turn 3 and never asks O for a fourth turn', async () => {
    const { ports, x, o } = makeHarness({
      finishAt: { turnCount: 3, winnerSide: 'X', reason: 'REACHED_GOAL' },
    });

    const report = await runMatch(makeConfig(4), ports);

    expect(report.result.reason).toBe('REACHED_GOAL');
    expect(report.result.winnerSide).toBe('X');
    expect(report.result.turnCount).toBe(3);
    expect(updates(x).map((update) => update.turnId)).toEqual([1, 3]);
    expect(updates(o).map((update) => update.turnId)).toEqual([2]);
    expect(turnResults(x)).toHaveLength(3);
    expect(turnResults(x).at(-1)?.nextSide).toBeNull();
    expect(matchResultOf(x).winnerSide).toBe('X');
    expect(matchResultOf(o).winnerSide).toBe('X');
  });

  it('7. sends STATE_UPDATE with empty legalActions and skips without waiting', async () => {
    // Bot Protocol v1 §5.2/§8: the active bot still receives the STATE_UPDATE with an empty
    // legalActions and sends no ACTION. Empty reply scripts prove requestAction is never
    // called — an exhausted ScriptedBot would answer BOT_EOF and the run would throw.
    const { ports, x, o } = makeHarness({ legalActions: [] }, 0);

    const report = await runMatch(makeConfig(4), ports);

    // Exactly one empty STATE_UPDATE per skipped turn, to the active bot only.
    expect(updates(x).map((update) => update.turnId)).toEqual([1, 3]);
    expect(updates(o).map((update) => update.turnId)).toEqual([2, 4]);
    for (const bot of [x, o]) {
      for (const update of updates(bot)) {
        expect(update.legalActions).toEqual([]);
        expect(update.state.turnNumber).toBe(update.turnId);
        expect(update.state.status).toBe('PLAYING');
        expect(update.state.turn).toBe(
          update.turnId % 2 === 1 ? 'X' : 'O',
        );
      }
      expect(bot.requestedTimeouts).toEqual([]);
    }

    expect(transcript(x)).toEqual([
      'INIT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'TURN_RESULT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'TURN_RESULT',
      'MATCH_RESULT',
    ]);
    expect(transcript(o)).toEqual([
      'INIT',
      'TURN_RESULT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'TURN_RESULT',
      'STATE_UPDATE',
      'TURN_RESULT',
      'MATCH_RESULT',
    ]);

    for (const bot of [x, o]) {
      expect(turnResults(bot)).toHaveLength(4);
      for (const message of turnResults(bot)) {
        expect(message.outcome).toBe('SKIPPED');
        expect(message.errorCode).toBe('NO_LEGAL_ACTION');
        expect(message.action).toBeNull();
      }
    }
    expect(report.result.reason).toBe('TURN_LIMIT');
    expect(report.result.winnerSide).toBeNull();
    expect(report.result.turnCount).toBe(4);
  });

  it('8. returns a report whose events are every transition event, in order', async () => {
    const { ports, game } = makeHarness();

    const report = await runMatch(makeConfig(4), ports);

    expect(report.matchId).toBe(MATCH_ID);
    expect(report.finalState.status).toBe('FINISHED');
    expect(report.result).toEqual(game.result(report.finalState));
    expect(report.events.map((event) => event.type)).toEqual([
      'ACTION_APPLIED',
      'ACTION_APPLIED',
      'ACTION_APPLIED',
      'ACTION_APPLIED',
      'MATCH_FINISHED',
    ]);
    for (let i = 1; i < report.events.length; i += 1) {
      expect(report.events[i]?.sequence).toBeGreaterThan(report.events[i - 1]?.sequence as number);
    }
    expect(report.events.at(-1)?.type).toBe('MATCH_FINISHED');
    expect(report.faults).toEqual({
      X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
    });
  });

  it('9. stops both bots exactly once on success', async () => {
    const { ports, x, o } = makeHarness();
    await runMatch(makeConfig(4), ports);

    expect(x.stopCalls).toBe(1);
    expect(o.stopCalls).toBe(1);
  });

  it('10. two identical runs produce identical reports and transcripts', async () => {
    const runOnce = async (): Promise<{
      readonly report: MatchReport;
      readonly x: readonly ProtocolMessage[];
      readonly o: readonly ProtocolMessage[];
    }> => {
      const { ports, x, o } = makeHarness();
      const report = await runMatch(makeConfig(4), ports);
      return { report, x: x.received, o: o.received };
    };

    const first = await runOnce();
    const second = await runOnce();

    expect(first.report).toEqual(second.report);
    expect(first.x).toEqual(second.x);
    expect(first.o).toEqual(second.o);
  });

  it('11. rejects a config whose maxTurns disagrees with the protocol limits', async () => {
    const { ports, x, o } = makeHarness();

    await expectRunnerError(runMatch(makeConfig(4, 9), ports), 'INVALID_CONFIG');

    expect(x.received).toHaveLength(0);
    expect(o.received).toHaveLength(0);
  });

  it('12. throws UNHANDLED_BOT_FAILURE for a bot error reply and still stops both bots', async () => {
    const game = new FakeGame();
    const x = new ScriptedBot({ replies: [{ kind: 'error', code: 'BOT_TIMEOUT' }] });
    const o = new ScriptedBot({ replies: actionReplies(4, 'O') });
    const ports: MatchPorts = { game, bots: { X: x, O: o } };

    await expectRunnerError(runMatch(makeConfig(4), ports), 'UNHANDLED_BOT_FAILURE');

    expect(x.stopCalls).toBe(1);
    expect(o.stopCalls).toBe(1);
    // The failing turn produced no TURN_RESULT and no MATCH_RESULT.
    expect(ofType(x.received, 'TURN_RESULT')).toHaveLength(0);
    expect(ofType(o.received, 'MATCH_RESULT')).toHaveLength(0);
  });

  it('13. keeps the module boundary: type-only game imports, no process, clock or random', () => {
    const read = (name: string): string =>
      readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

    // Whole import statements (see ports.test.ts test 16), exact counts so this can't
    // go vacuous.
    const ottImports = /^import\s+(?<kind>type\s+)?(?:[^;]*?)\bfrom\s+'(?<module>@ott\/[^']+)'/gm;
    const counts: Readonly<Record<string, number>> = {
      '../src/match-runner.ts': 3,
      '../src/types.ts': 2,
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
        // types.ts has no runtime imports at all; match-runner.ts may import
        // PROTOCOL_VERSION (a protocol constant, not game behaviour).
        if (file === '../src/types.ts') expect(match.groups?.['kind']).toBe('type ');
        else if (match.groups?.['module'] === '@ott/game-core') {
          expect(match.groups?.['kind']).toBe('type ');
        }
      }
    }

    const runner = read('../src/match-runner.ts');
    // Only runtime @ott import is PROTOCOL_VERSION from bot-protocol.
    const runtimeOtt = [...runner.matchAll(ottImports)].filter((m) => m.groups?.['kind'] === undefined);
    expect(runtimeOtt.map((m) => m.groups?.['module'])).toEqual(['@ott/bot-protocol']);
    for (const banned of [/\bDate\b/, /Math\.random/, /setTimeout/, /setInterval/, /node:crypto/]) {
      expect(runner).not.toMatch(banned);
    }
  });

  it('14. outbound messages share no mutable reference with the runner, config or the other bot', async () => {
    const { ports, x, o } = makeHarness();
    const config = makeConfig(4);
    const configBefore = structuredClone(config);

    const report = await runMatch(config, ports);

    // Mutate everything X received, the way a hostile or buggy bot double could.
    const xMessages = x.received as ProtocolMessage[];
    for (const message of xMessages) {
      if (message.type === 'INIT') {
        (message.map.spawns[0] as { position: { col: number; row: number } }).position = { col: 9, row: 9 };
        (message.limits as { maxTurns: number }).maxTurns = 999;
      }
      if (message.type === 'TURN_RESULT') (message as { revision: number }).revision = -1;
      if (message.type === 'MATCH_RESULT') {
        (message.faults.X as { recoverableTotal: number }).recoverableTotal = 42;
      }
    }

    // The report is unaffected …
    expect(report.faults).toEqual({
      X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
    });
    expect(report.faults.X).not.toBe(report.faults.O);
    // … O's copy of every message is unaffected …
    expect(matchResultOf(o).faults.X.recoverableTotal).toBe(0);
    expect(turnResults(o).map((message) => message.revision)).toEqual([1, 2, 3, 4]);
    const oInit = ofType(o.received, 'INIT')[0] as InitMessage;
    expect(oInit.map.spawns[0]?.position).toEqual({ col: 0, row: 0 });
    expect(oInit.limits.maxTurns).toBe(4);
    // … and the caller's config is untouched.
    expect(config).toEqual(configBefore);
  });
});
