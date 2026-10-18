/**
 * P3-L02 — Chess-clock timing policy, runner enforcement and replay verification.
 *
 * AC coverage (tasks/todo.md → P3-L02):
 * - AC 1 (Dynamic deterministic by turn and total budget, monotonic clock): policy + property tests,
 *   runner tests driven by `FakeClock`.
 * - AC 2 (exhausted budget uses the existing timeout/forfeit policy): runner tests 'timing runner: …'.
 * - AC 3 (same transcript/rule set ⇒ same timing events; replay verification): 'timing replay: …'.
 *
 * Only fakes are used: `FakeGame`, `ScriptedBot` and `FakeClock`; the system clock is never read.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import type {
  AnyProtocolMessage,
  InitMessageV2,
  PerTurnPolicyV2,
  StateUpdateMessageV2,
  TimeControlV2,
} from '@ott/bot-protocol';
import type { GameAction, MapDefinition, PlayerSide } from '@ott/game-core';

import {
  EVENT_LOG_FORMAT_VERSION_V2,
  FakeClock,
  FakeGame,
  MatchRunnerError,
  ScriptedBot,
  grantTurn,
  parseAnyEventLog,
  parseEventLog,
  perTurnLimitMs,
  runMatch,
  serializeEventLog,
  settleTurn,
  toDecision,
  validateTimingRules,
  verifyReplay,
  verifyTimingDecisions,
} from '../src/index.ts';
import type {
  EventLogV2,
  FakeGameOptions,
  MatchConfig,
  MatchConfigV2,
  MatchPorts,
  ScriptedReply,
  TimingDecision,
} from '../src/index.ts';

// --- policy fixtures ---------------------------------------------------------------------

const QUALIFICATION: PerTurnPolicyV2 = { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 };

function rules(overrides: Partial<TimeControlV2> = {}): TimeControlV2 {
  return {
    startupMs: 5000,
    totalBotBudgetMs: 60_000,
    matchWallClockMs: 150_000,
    perTurn: QUALIFICATION,
    ...overrides,
  };
}

describe('timing policy: per-turn schedule', () => {
  it('timing DYNAMIC steps every 40 turns and caps at maxMs (qualification example)', () => {
    const at = (index: number): number | null => perTurnLimitMs(QUALIFICATION, index);
    expect(at(0)).toBe(1000);
    expect(at(39)).toBe(1000);
    expect(at(40)).toBe(1500);
    expect(at(41)).toBe(1500);
    expect(at(79)).toBe(1500);
    expect(at(80)).toBe(2000);
    expect(at(159)).toBe(2500);
    expect(at(160)).toBe(3000);
    expect(at(10_000)).toBe(3000);
  });

  it('timing DYNAMIC with everyTurns=1 grows each turn until the cap', () => {
    const policy: PerTurnPolicyV2 = { mode: 'DYNAMIC', baseMs: 100, stepMs: 50, everyTurns: 1, maxMs: 300 };
    expect([0, 1, 2, 3, 4, 5].map((index) => perTurnLimitMs(policy, index))).toEqual([100, 150, 200, 250, 300, 300]);
  });

  it('timing DYNAMIC with stepMs=0 stays at baseMs', () => {
    const policy: PerTurnPolicyV2 = { mode: 'DYNAMIC', baseMs: 700, stepMs: 0, everyTurns: 10, maxMs: 900 };
    expect([0, 9, 10, 500].map((index) => perTurnLimitMs(policy, index))).toEqual([700, 700, 700, 700]);
  });

  it('timing FIXED is constant and NONE has no per-turn cap', () => {
    expect([0, 50, 5000].map((index) => perTurnLimitMs({ mode: 'FIXED', fixedMs: 1234 }, index))).toEqual([
      1234, 1234, 1234,
    ]);
    expect(perTurnLimitMs({ mode: 'NONE' }, 7)).toBeNull();
  });
});

describe('timing policy: grant and settlement arithmetic', () => {
  it('timing limit is min(perTurn, remaining budget) and the deadline never exceeds either', () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 2000 } });
    const roomy = grantTurn(tc, { turnIndex: 0, remainingBotBudgetMs: 60_000, wallElapsedMs: 0 });
    expect(roomy).toMatchObject({ turnLimitMs: 2000, deadlineMs: 2000, binding: 'TURN_LIMIT' });
    const tight = grantTurn(tc, { turnIndex: 0, remainingBotBudgetMs: 800, wallElapsedMs: 0 });
    expect(tight).toMatchObject({ turnLimitMs: 800, deadlineMs: 800, remainingBotBudgetMs: 800, binding: 'BOT_BUDGET' });
  });

  it('timing NONE sends turnLimitMs=null but still enforces the remaining budget', () => {
    const tc = rules({ perTurn: { mode: 'NONE' } });
    const grant = grantTurn(tc, { turnIndex: 3, remainingBotBudgetMs: 4200, wallElapsedMs: 0 });
    expect(grant).toMatchObject({ turnLimitMs: null, deadlineMs: 4200, binding: 'BOT_BUDGET' });
  });

  it('timing wall-clock cap binds before the bot budget when less time remains', () => {
    const tc = rules({ matchWallClockMs: 10_000 });
    const grant = grantTurn(tc, { turnIndex: 0, remainingBotBudgetMs: 60_000, wallElapsedMs: 9_600 });
    expect(grant).toMatchObject({ turnLimitMs: 1000, deadlineMs: 400, binding: 'WALL_CLOCK' });
  });

  it('timing a tie between limiters keeps the weaker one (plain turn timeout)', () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 500 } });
    expect(grantTurn(tc, { turnIndex: 0, remainingBotBudgetMs: 500, wallElapsedMs: 0 }).binding).toBe('TURN_LIMIT');
  });

  it('timing answering exactly at the deadline is on time and leaves the exact remainder', () => {
    const grant = grantTurn(rules({ perTurn: { mode: 'FIXED', fixedMs: 500 } }), {
      turnIndex: 0,
      remainingBotBudgetMs: 500,
      wallElapsedMs: 0,
    });
    const settled = settleTurn(grant, { elapsedMs: 500, timedOut: false });
    expect(settled).toEqual({ chargedMs: 500, remainingAfterMs: 0, wallElapsedAfterMs: 500, exhaustion: null });
    // The next turn has nothing to grant: the budget is exactly exhausted at 0.
    const next = grantTurn(rules(), { turnIndex: 1, remainingBotBudgetMs: 0, wallElapsedMs: 500 });
    expect(next).toMatchObject({ deadlineMs: 0, binding: 'BOT_BUDGET' });
    expect(settleTurn(next, { elapsedMs: 0, timedOut: false })).toMatchObject({ chargedMs: 0, exhaustion: 'BOT_BUDGET' });
  });

  it('timing exhaustion mid-turn charges at least the deadline and never goes negative', () => {
    const grant = grantTurn(rules({ perTurn: { mode: 'NONE' } }), {
      turnIndex: 0,
      remainingBotBudgetMs: 300,
      wallElapsedMs: 0,
    });
    const late = settleTurn(grant, { elapsedMs: 450, timedOut: false });
    expect(late).toMatchObject({ chargedMs: 450, remainingAfterMs: 0, exhaustion: 'BOT_BUDGET' });
    const transportTimeout = settleTurn(grant, { elapsedMs: 10, timedOut: true });
    expect(transportTimeout).toMatchObject({ chargedMs: 300, remainingAfterMs: 0, exhaustion: 'BOT_BUDGET' });
  });

  it('timing wall-clock exhaustion is reported when the wall cap, not the budget, was exceeded', () => {
    const grant = grantTurn(rules({ matchWallClockMs: 1000 }), { turnIndex: 0, remainingBotBudgetMs: 60_000, wallElapsedMs: 700 });
    expect(settleTurn(grant, { elapsedMs: 300, timedOut: false }).exhaustion).toBeNull();
    expect(settleTurn(grant, { elapsedMs: 301, timedOut: false }).exhaustion).toBe('WALL_CLOCK');
  });
});

describe('timing policy: rule validation', () => {
  it('timing accepts the qualification defaults', () => {
    expect(validateTimingRules(rules())).toEqual({ ok: true });
  });

  it.each([
    ['BASE_EXCEEDS_MAX', rules({ perTurn: { ...QUALIFICATION, baseMs: 4000 } })],
    ['MAX_EXCEEDS_TOTAL_BUDGET', rules({ totalBotBudgetMs: 2000 })],
    ['INVALID_MODE', rules({ perTurn: { mode: 'SLOW' } as unknown as PerTurnPolicyV2 })],
    ['INVALID_BUDGET', rules({ totalBotBudgetMs: Number.NaN })],
  ] as const)('timing rejects %s with the contract error code', (code, timeControl) => {
    expect(validateTimingRules(timeControl)).toMatchObject({ ok: false, code });
  });

  it.each([
    ['everyTurns=0', rules({ perTurn: { ...QUALIFICATION, everyTurns: 0 } })],
    ['fractional fixedMs', rules({ perTurn: { mode: 'FIXED', fixedMs: 10.5 } })],
    ['zero wall clock', rules({ matchWallClockMs: 0 })],
    ['negative stepMs', rules({ perTurn: { ...QUALIFICATION, stepMs: -1 } })],
  ] as const)('timing rejects %s as INVALID_TIME_CONTROL', (_name, timeControl) => {
    expect(validateTimingRules(timeControl)).toMatchObject({ ok: false, code: 'INVALID_TIME_CONTROL' });
  });
});

// --- property test -------------------------------------------------------------------------

/** Tiny deterministic PRNG (mulberry32) so the "random" cases are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomRules(random: () => number): TimeControlV2 {
  const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
  const total = int(500, 60_000);
  const maxMs = int(2, total);
  const mode = random();
  const perTurn: PerTurnPolicyV2 =
    mode < 0.2
      ? { mode: 'NONE' }
      : mode < 0.4
        ? { mode: 'FIXED', fixedMs: int(1, total) }
        : { mode: 'DYNAMIC', baseMs: int(1, maxMs), stepMs: int(0, 600), everyTurns: int(1, 60), maxMs };
  return { startupMs: 5000, totalBotBudgetMs: total, matchWallClockMs: int(total, total * 3), perTurn };
}

describe('timing policy: property test', () => {
  it('timing for random rules and elapsed sequences: remaining >= 0, DYNAMIC monotone, recomputation equals the record', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const random = prng(seed);
      const tc = randomRules(random);
      const remaining: Record<PlayerSide, number> = { X: tc.totalBotBudgetMs, O: tc.totalBotBudgetMs };
      const decisions: TimingDecision[] = [];
      let wall = 0;
      let previousLimit = -1;

      for (let turnId = 1; turnId <= 120; turnId++) {
        const side: PlayerSide = turnId % 2 === 1 ? 'X' : 'O';
        wall += Math.floor(random() * 40);
        const grant = grantTurn(tc, { turnIndex: turnId - 1, remainingBotBudgetMs: remaining[side], wallElapsedMs: wall });
        const elapsedMs = Math.floor(random() * (grant.deadlineMs * 1.3 + 5));
        const timedOut = random() < 0.05;
        const settlement = settleTurn(grant, { elapsedMs, timedOut });

        expect(settlement.remainingAfterMs).toBeGreaterThanOrEqual(0);
        expect(grant.deadlineMs).toBeGreaterThanOrEqual(0);
        if (grant.turnLimitMs !== null) expect(grant.turnLimitMs).toBeLessThanOrEqual(remaining[side]);
        if (tc.perTurn.mode === 'DYNAMIC') {
          const limit = perTurnLimitMs(tc.perTurn, turnId - 1) as number;
          expect(limit).toBeGreaterThanOrEqual(previousLimit);
          expect(limit).toBeLessThanOrEqual(tc.perTurn.maxMs);
          previousLimit = limit;
        }

        decisions.push(toDecision(grant, settlement, { turnId, side, elapsedMs, timedOut }));
        remaining[side] = settlement.remainingAfterMs;
        wall = settlement.wallElapsedAfterMs;
      }
      expect(verifyTimingDecisions(tc, decisions), `seed ${seed}`).toEqual({ ok: true });
    }
  });

  it('timing tampering with any derived field of a recorded decision is detected', () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 1000 } });
    const decisions: TimingDecision[] = [];
    let remainingX = tc.totalBotBudgetMs;
    let wall = 0;
    for (let turnId = 1; turnId <= 5; turnId += 2) {
      const grant = grantTurn(tc, { turnIndex: turnId - 1, remainingBotBudgetMs: remainingX, wallElapsedMs: wall });
      const settlement = settleTurn(grant, { elapsedMs: 400, timedOut: false });
      decisions.push(toDecision(grant, settlement, { turnId, side: 'X', elapsedMs: 400, timedOut: false }));
      remainingX = settlement.remainingAfterMs;
      wall = settlement.wallElapsedAfterMs + 10;
    }
    expect(verifyTimingDecisions(tc, decisions)).toEqual({ ok: true });

    for (const [field, value] of [
      ['turnLimitMs', 5000],
      ['deadlineMs', 999],
      ['remainingBeforeMs', 59_999],
      ['chargedMs', 1],
      ['remainingAfterMs', 59_999],
      ['exhaustion', 'BOT_BUDGET'],
    ] as const) {
      const tampered = decisions.map((decision, index) => (index === 1 ? { ...decision, [field]: value } : decision));
      const verdict = verifyTimingDecisions(tc, tampered);
      expect(verdict.ok, field).toBe(false);
      if (!verdict.ok) expect(verdict.detail).toContain(`timing[1] ${field} is`);
    }
  });
});

// --- runner integration ----------------------------------------------------------------------

const MAP_CHECKSUM = 'd'.repeat(64);
const MATCH_ID = 'match-timing';
const SEED = 'seed-timing';
const BOT_SEEDS = { X: 'bot-seed-x', O: 'bot-seed-o' } as const;

function makeMap(): MapDefinition {
  return {
    schemaVersion: 1,
    mapId: 'timing-map',
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

const ACTIONS: Record<PlayerSide, GameAction> = {
  X: { pieceId: 'X1', to: { col: 0, row: 0 } },
  O: { pieceId: 'O1', to: { col: 0, row: 0 } },
};

function configV1(maxTurns: number): MatchConfig {
  return {
    matchId: MATCH_ID,
    seed: SEED,
    game: { gameId: MATCH_ID, engineVersion: '1.0.0', map: makeMap(), maxTurns },
    limits: { ...DEFAULT_LIMITS, maxTurns },
  };
}

function configV2(maxTurns: number, timeControl: TimeControlV2): MatchConfigV2 {
  return { ...configV1(maxTurns), protocolV2: { timeControl, botSeeds: BOT_SEEDS } };
}

/** `count` valid actions that each take `elapsedMs` of fake time. */
function slowActions(side: PlayerSide, count: number, elapsedMs: number): ScriptedReply[] {
  return Array.from({ length: count }, () => ({ kind: 'action' as const, action: ACTIONS[side], elapsedMs }));
}

interface TimedHarness {
  readonly ports: MatchPorts;
  readonly clock: FakeClock;
  readonly x: ScriptedBot<AnyProtocolMessage>;
  readonly o: ScriptedBot<AnyProtocolMessage>;
}

function harness(x: ScriptedReply[], o: ScriptedReply[], gameOptions: FakeGameOptions = {}): TimedHarness {
  const clock = new FakeClock(1_000_000);
  const bx = new ScriptedBot<AnyProtocolMessage>({ replies: x, clock });
  const bo = new ScriptedBot<AnyProtocolMessage>({ replies: o, clock });
  return { ports: { game: new FakeGame(gameOptions), bots: { X: bx, O: bo }, clock }, clock, x: bx, o: bo };
}

function stateUpdates(bot: ScriptedBot<AnyProtocolMessage>): StateUpdateMessageV2[] {
  return bot.received.filter((message): message is StateUpdateMessageV2 => message.type === 'STATE_UPDATE');
}

describe('timing runner: v2 messages', () => {
  it('timing INIT carries the envelope and botSeed; STATE_UPDATE carries timeBudget', async () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 1000 }, totalBotBudgetMs: 5000 });
    const { ports, x, o } = harness(slowActions('X', 2, 100), slowActions('O', 2, 250));

    const report = await runMatch(configV2(4, tc), ports);

    const init = x.received[0] as InitMessageV2;
    expect(init).toMatchObject({ type: 'INIT', protocolVersion: 2, side: 'X', botSeed: 'bot-seed-x' });
    expect(init.limits.timeControl).toEqual(tc);
    expect(init.limits).not.toHaveProperty('turnTimeoutMs');
    expect(init).not.toHaveProperty('seed');
    expect((o.received[0] as InitMessageV2).botSeed).toBe('bot-seed-o');

    expect(stateUpdates(x).map((update) => update.timeBudget)).toEqual([
      { turnLimitMs: 1000, remainingBotBudgetMs: 5000 },
      { turnLimitMs: 1000, remainingBotBudgetMs: 4900 },
    ]);
    expect(stateUpdates(o).map((update) => update.timeBudget)).toEqual([
      { turnLimitMs: 1000, remainingBotBudgetMs: 5000 },
      { turnLimitMs: 1000, remainingBotBudgetMs: 4750 },
    ]);
    expect(x.requestedTimeouts).toEqual([1000, 1000]);
    expect(report.result.reason).toBe('TURN_LIMIT');
    expect(report.log.header.formatVersion).toBe(EVENT_LOG_FORMAT_VERSION_V2);
  });

  it('timing a bot answering within budget is never forfeited and each budget is independent', async () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 1000 }, totalBotBudgetMs: 10_000 });
    const { ports } = harness(slowActions('X', 3, 900), slowActions('O', 3, 10));

    const report = await runMatch(configV2(6, tc), ports);

    expect(report.log.timing.map((d) => [d.side, d.remainingBeforeMs, d.remainingAfterMs, d.exhaustion])).toEqual([
      ['X', 10_000, 9100, null],
      ['O', 10_000, 9990, null],
      ['X', 9100, 8200, null],
      ['O', 9990, 9980, null],
      ['X', 8200, 7300, null],
      ['O', 9980, 9970, null],
    ]);
    expect(report.faults.X.recoverableTotal).toBe(0);
    expect(report.result.reason).toBe('TURN_LIMIT');
  });

  it('timing a bot exceeding the per-turn limit gets the existing BOT_TIMEOUT skip, not a forfeit', async () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 500 }, totalBotBudgetMs: 10_000 });
    const { ports, x } = harness(
      [{ kind: 'action', action: ACTIONS.X, elapsedMs: 800 }, ...slowActions('X', 1, 10)],
      slowActions('O', 2, 10),
    );

    const report = await runMatch(configV2(4, tc), ports);

    const [first] = report.log.timing;
    expect(first).toMatchObject({ side: 'X', deadlineMs: 500, elapsedMs: 800, chargedMs: 800, exhaustion: 'TURN_LIMIT' });
    expect(report.log.entries[0]?.input).toEqual({ kind: 'skip', side: 'X', reason: 'BOT_TIMEOUT' });
    expect(report.faults.X).toEqual({ recoverableTotal: 1, recoverableConsecutive: 0, lastErrorCode: 'BOT_TIMEOUT' });
    expect(report.result.reason).toBe('TURN_LIMIT');
    // The late ACTION was discarded: the bot is told the turn was skipped for a timeout.
    const result = x.received.find((message) => message.type === 'TURN_RESULT');
    expect(result).toMatchObject({ protocolVersion: 2, outcome: 'SKIPPED', errorCode: 'BOT_TIMEOUT', action: null });
  });

  it('timing a transport BOT_TIMEOUT follows the same path as the v1 timeout policy', async () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 500 } });
    const { ports } = harness(
      [{ kind: 'error', code: 'BOT_TIMEOUT', elapsedMs: 500 }, ...slowActions('X', 1, 5)],
      slowActions('O', 2, 5),
    );
    const v2 = await runMatch(configV2(4, tc), ports);

    const v1Bots = {
      X: new ScriptedBot({ replies: [{ kind: 'error', code: 'BOT_TIMEOUT' }, { kind: 'action', action: ACTIONS.X }] }),
      O: new ScriptedBot({ replies: [{ kind: 'action', action: ACTIONS.O }, { kind: 'action', action: ACTIONS.O }] }),
    };
    const v1 = await runMatch(configV1(4), { game: new FakeGame(), bots: v1Bots });

    expect(v2.log.entries.map((e) => e.input)).toEqual(v1.log.entries.map((e) => e.input));
    expect(v2.faults).toEqual(v1.faults);
    expect(v2.result).toEqual(v1.result);
  });

  it('timing a bot draining the total budget over many turns is forfeited with BOT_TIMEOUT', async () => {
    // 1000 ms budget, 300 ms per answer: X answers at turns 1, 3, 5 (900 ms) and has 100 ms left
    // for turn 7, whose 300 ms answer overruns the 100 ms deadline.
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 400 }, totalBotBudgetMs: 1000 });
    const { ports, x, o } = harness(slowActions('X', 6, 300), slowActions('O', 6, 10));

    const report = await runMatch(configV2(20, tc), ports);

    expect(report.result).toMatchObject({ reason: 'FORFEIT', winnerSide: 'O', forfeitedSide: 'X' });
    const last = report.log.timing.at(-1);
    expect(last).toMatchObject({
      turnId: 7,
      side: 'X',
      turnLimitMs: 100,
      deadlineMs: 100,
      remainingBeforeMs: 100,
      chargedMs: 300,
      remainingAfterMs: 0,
      exhaustion: 'BOT_BUDGET',
    });
    expect(report.log.entries.at(-2)?.input).toEqual({ kind: 'skip', side: 'X', reason: 'BOT_TIMEOUT' });
    expect(report.log.entries.at(-1)?.input).toEqual({ kind: 'forfeit', side: 'X', fault: 'BOT_TIMEOUT' });
    expect(report.faults.X.lastErrorCode).toBe('BOT_TIMEOUT');
    // The forfeiting bot stays alive: it still gets the TURN_RESULT and the MATCH_RESULT.
    expect(x.received.at(-1)?.type).toBe('MATCH_RESULT');
    expect(o.received.at(-1)?.type).toBe('MATCH_RESULT');
    expect(verifyReplay(report.log, new FakeGame())).toMatchObject({ ok: true });
  });

  it('timing an already empty budget is not asked again and forfeits at once', async () => {
    // Exactly 300 ms budget and 300 ms answers: the budget hits exactly 0 on time at turn 1; the
    // bot's next turn has deadline 0, so it is not asked.
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 400 }, totalBotBudgetMs: 300 });
    const { ports, x } = harness(slowActions('X', 5, 300), slowActions('O', 5, 10));

    const report = await runMatch(configV2(20, tc), ports);

    expect(report.log.timing.map((d) => [d.turnId, d.side, d.remainingAfterMs, d.exhaustion])).toEqual([
      [1, 'X', 0, null],
      [2, 'O', 290, null],
      [3, 'X', 0, 'BOT_BUDGET'],
    ]);
    expect(report.log.timing[2]).toMatchObject({ deadlineMs: 0, elapsedMs: 0, chargedMs: 0, timedOut: false });
    expect(stateUpdates(x)).toHaveLength(1);
    expect(x.requestedTimeouts).toEqual([300]);
    expect(report.result).toMatchObject({ reason: 'FORFEIT', forfeitedSide: 'X' });
    expect(verifyReplay(report.log, new FakeGame())).toMatchObject({ ok: true });
  });

  it('timing the match wall-clock cap forfeits the side on move and binds before the bot budget', async () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 1000 }, totalBotBudgetMs: 50_000, matchWallClockMs: 2000 });
    const { ports } = harness(slowActions('X', 6, 900), slowActions('O', 6, 900));

    const report = await runMatch(configV2(20, tc), ports);

    // turn 1: 0→900, turn 2: 900→1800, turn 3: only 200 ms of wall-clock remain.
    const last = report.log.timing.at(-1);
    expect(last).toMatchObject({
      turnId: 3,
      side: 'X',
      wallElapsedBeforeMs: 1800,
      turnLimitMs: 1000,
      deadlineMs: 200,
      exhaustion: 'WALL_CLOCK',
    });
    expect(report.result).toMatchObject({ reason: 'FORFEIT', forfeitedSide: 'X' });
    expect(report.log.entries.at(-1)?.input).toEqual({ kind: 'forfeit', side: 'X', fault: 'BOT_TIMEOUT' });
    expect(verifyReplay(report.log, new FakeGame())).toMatchObject({ ok: true });
  });

  it('timing a process fault after the deadline is still a process fault forfeit', async () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 100 } });
    const { ports } = harness([{ kind: 'error', code: 'BOT_EOF', elapsedMs: 400 }], slowActions('O', 2, 1));

    const report = await runMatch(configV2(10, tc), ports);

    expect(report.faults.X.lastErrorCode).toBe('BOT_EOF');
    expect(report.log.entries.map((e) => e.input.kind)).toEqual(['forfeit']);
    expect(verifyReplay(report.log, new FakeGame())).toMatchObject({ ok: true });
  });

  it('timing DYNAMIC limits follow the global turn index in the messages the bots receive', async () => {
    const tc = rules({
      perTurn: { mode: 'DYNAMIC', baseMs: 100, stepMs: 50, everyTurns: 2, maxMs: 200 },
      totalBotBudgetMs: 10_000,
    });
    const { ports, x, o } = harness(slowActions('X', 4, 1), slowActions('O', 4, 1));

    await runMatch(configV2(8, tc), ports);

    // turns 1..8 → indices 0..7 → 100,100,150,150,200,200,200,200
    expect(stateUpdates(x).map((u) => u.timeBudget.turnLimitMs)).toEqual([100, 150, 200, 200]);
    expect(stateUpdates(o).map((u) => u.timeBudget.turnLimitMs)).toEqual([100, 150, 200, 200]);
    expect(x.requestedTimeouts).toEqual([100, 150, 200, 200]);
  });

  it('timing a turn without legal actions does not touch the clock and records no decision', async () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 100 } });
    const { ports, x } = harness([], [], { legalActions: [] });

    const report = await runMatch(configV2(2, tc), ports);

    expect(report.log.timing).toEqual([]);
    expect(x.requestedTimeouts).toEqual([]);
    expect(stateUpdates(x)[0]?.legalActions).toEqual([]);
    expect(stateUpdates(x)[0]?.timeBudget).toEqual({ turnLimitMs: 100, remainingBotBudgetMs: 60_000 });
  });

  it('timing the same transcript and rules give identical timing events (determinism)', async () => {
    const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 400 }, totalBotBudgetMs: 1000 });
    const run = async (): Promise<string> => {
      const { ports } = harness(slowActions('X', 6, 300), slowActions('O', 6, 10));
      return serializeEventLog((await runMatch(configV2(20, tc), ports)).log);
    };
    expect(await run()).toBe(await run());
  });

  it('timing rejects v2 without a clock and invalid rules before any bot starts', async () => {
    const { ports, x } = harness([], []);
    const noClock: MatchPorts = { game: ports.game, bots: ports.bots };
    await expect(runMatch(configV2(2, rules()), noClock)).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
    await expect(
      runMatch(configV2(2, rules({ perTurn: { ...QUALIFICATION, baseMs: 5000 } })), ports),
    ).rejects.toThrow('BASE_EXCEEDS_MAX');
    await expect(runMatch(configV2(2, rules({ totalBotBudgetMs: 100 })), ports)).rejects.toBeInstanceOf(MatchRunnerError);
    expect(x.received).toEqual([]);
  });

  it('timing the clock is only read through the injected port', async () => {
    // Move the system clock a long way during the match: the injected FakeClock decides alone.
    const realNow = Date.now;
    let fake = 0;
    Date.now = () => (fake += 10_000_000);
    try {
      const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 1000 }, totalBotBudgetMs: 5000 });
      const { ports } = harness(slowActions('X', 2, 100), slowActions('O', 2, 100));
      const report = await runMatch(configV2(4, tc), ports);
      expect(report.log.timing.every((d) => d.exhaustion === null && d.elapsedMs === 100)).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });
});

// --- replay ------------------------------------------------------------------------------------

async function drainedMatch(): Promise<{ log: EventLogV2; text: string }> {
  const tc = rules({ perTurn: { mode: 'FIXED', fixedMs: 400 }, totalBotBudgetMs: 1000 });
  const { ports } = harness(slowActions('X', 6, 300), slowActions('O', 6, 10));
  const report = await runMatch(configV2(20, tc), ports);
  return { log: report.log, text: serializeEventLog(report.log) };
}

function tamper(log: EventLogV2, edit: (decisions: TimingDecision[]) => void): EventLogV2 {
  const copy = structuredClone(log) as { -readonly [K in keyof EventLogV2]: EventLogV2[K] } & { timing: TimingDecision[] };
  edit(copy.timing);
  return copy;
}

describe('timing replay: verification', () => {
  it('timing a v2 log round-trips through serialize/parse and verifies', async () => {
    const { log, text } = await drainedMatch();
    const parsed = parseAnyEventLog(text);
    expect(parsed).toEqual(log);
    expect(serializeEventLog(parsed)).toBe(text);
    expect(verifyReplay(parsed, new FakeGame())).toMatchObject({ ok: true });
    // v1-only consumers fail closed instead of silently dropping the timing section.
    expect(() => parseEventLog(text)).toThrow('UNSUPPORTED_EVENT_LOG_FORMAT');
  });

  it('timing tampering with a recorded limit fails verification with the offending field', async () => {
    const { log } = await drainedMatch();
    const verdict = verifyReplay(tamper(log, (t) => { t[1] = { ...t[1]!, turnLimitMs: 9999 }; }), new FakeGame());
    expect(verdict).toEqual({
      ok: false,
      code: 'TIMING_MISMATCH',
      index: null,
      detail: 'timing[1] turnLimitMs is 9999 but the rules give 400',
    });
  });

  it('timing tampering with a recorded remaining total fails verification', async () => {
    const { log } = await drainedMatch();
    const verdict = verifyReplay(tamper(log, (t) => { t[2] = { ...t[2]!, remainingAfterMs: 5000 }; }), new FakeGame());
    expect(verdict).toMatchObject({ ok: false, code: 'TIMING_MISMATCH' });
    expect(verdict.ok ? '' : verdict.detail).toBe('timing[2] remainingAfterMs is 5000 but the rules give 400');
  });

  it('timing tampering with recorded elapsed (to hide an overrun) fails verification', async () => {
    const { log } = await drainedMatch();
    const lastIndex = log.timing.length - 1;
    const verdict = verifyReplay(tamper(log, (t) => { t[lastIndex] = { ...t[lastIndex]!, elapsedMs: 50 }; }), new FakeGame());
    expect(verdict).toMatchObject({ ok: false, code: 'TIMING_MISMATCH' });
  });

  it('timing a deleted, reordered or relabelled decision fails verification', async () => {
    const { log } = await drainedMatch();
    const game = new FakeGame();
    expect(verifyReplay(tamper(log, (t) => { t.splice(1, 1); }), game)).toMatchObject({ ok: false, code: 'TIMING_MISMATCH' });
    expect(verifyReplay(tamper(log, (t) => { t.reverse(); }), game)).toMatchObject({ ok: false, code: 'TIMING_MISMATCH' });
    expect(verifyReplay(tamper(log, (t) => { t[0] = { ...t[0]!, side: 'O' }; }), game)).toMatchObject({ ok: false, code: 'TIMING_MISMATCH' });
  });

  it('timing changing the pinned rules after the fact makes the recorded decisions fail', async () => {
    const { log } = await drainedMatch();
    const copy = structuredClone(log) as unknown as { header: { limits: { timeControl: TimeControlV2 } } };
    copy.header.limits.timeControl = rules({ perTurn: { mode: 'FIXED', fixedMs: 400 }, totalBotBudgetMs: 5000 });
    expect(verifyReplay(copy as unknown as EventLogV2, new FakeGame())).toMatchObject({ ok: false, code: 'TIMING_MISMATCH' });
  });

  it('timing a recorded exhaustion without the matching forfeit fails verification', async () => {
    const { log } = await drainedMatch();
    const lastIndex = log.timing.length - 1;
    const verdict = verifyReplay(tamper(log, (t) => { t[lastIndex] = { ...t[lastIndex]!, exhaustion: 'WALL_CLOCK' }; }), new FakeGame());
    expect(verdict).toMatchObject({ ok: false, code: 'TIMING_MISMATCH' });
  });

  it('timing a v2 log still goes through the engine checks (state hash tamper is caught)', async () => {
    const { log } = await drainedMatch();
    const copy = structuredClone(log) as unknown as { entries: { stateHash: string }[] };
    copy.entries[0]!.stateHash = 'f'.repeat(64);
    expect(verifyReplay(copy as unknown as EventLogV2, new FakeGame())).toMatchObject({ ok: false, code: 'STATE_HASH_MISMATCH' });
  });

  it('timing parseAnyEventLog rejects a v2 log without the timing section or timeControl', async () => {
    const { text } = await drainedMatch();
    const noTiming = JSON.parse(text) as Record<string, unknown>;
    delete noTiming['timing'];
    expect(() => parseAnyEventLog(JSON.stringify(noTiming))).toThrow('timing must be an array');
    const noControl = JSON.parse(text) as { header: { limits: Record<string, unknown> } };
    delete noControl.header.limits['timeControl'];
    expect(() => parseAnyEventLog(JSON.stringify(noControl))).toThrow('header.limits.timeControl must be an object');
  });
});

describe('timing backward compatibility', () => {
  it('timing without protocolV2 produces the unchanged v1 log, messages and timeouts', async () => {
    const clockLessBots = {
      X: new ScriptedBot({ replies: [{ kind: 'action', action: ACTIONS.X }, { kind: 'action', action: ACTIONS.X }] }),
      O: new ScriptedBot({ replies: [{ kind: 'action', action: ACTIONS.O }, { kind: 'action', action: ACTIONS.O }] }),
    };
    const config = configV1(4);
    const report = await runMatch(config, { game: new FakeGame(), bots: clockLessBots });

    expect(report.log.header).toMatchObject({ formatVersion: 1, protocolVersion: 1, limits: config.limits });
    expect(report.log).not.toHaveProperty('timing');
    expect(clockLessBots.X.requestedTimeouts).toEqual([config.limits.turnTimeoutMs, config.limits.turnTimeoutMs]);
    expect(clockLessBots.X.received.every((m) => m.protocolVersion === 1)).toBe(true);
    expect(parseEventLog(serializeEventLog(report.log))).toEqual(report.log);
    expect(parseAnyEventLog(serializeEventLog(report.log))).toEqual(report.log);
    expect(verifyReplay(report.log, new FakeGame())).toMatchObject({ ok: true });
    // A clock handed to a v1 match is ignored: it is never read.
    const sha = createHash('sha256').update(serializeEventLog(report.log)).digest('hex');
    const withClock = await runMatch(config, {
      game: new FakeGame(),
      clock: new FakeClock(),
      bots: {
        X: new ScriptedBot({ replies: [{ kind: 'action', action: ACTIONS.X }, { kind: 'action', action: ACTIONS.X }] }),
        O: new ScriptedBot({ replies: [{ kind: 'action', action: ACTIONS.O }, { kind: 'action', action: ACTIONS.O }] }),
      },
    });
    expect(createHash('sha256').update(serializeEventLog(withClock.log)).digest('hex')).toBe(sha);
  });

  it('timing a no-timeControl match keeps the golden v1 log hash recorded from the pre-L02 runner', async () => {
    // Hash produced by the HEAD (pre-P3-L02) sources for this exact scenario; see report.
    const config: MatchConfig = {
      ...configV1(6),
      matchId: 'g1',
      seed: 's',
      game: { gameId: 'g1', engineVersion: '1.0.0', map: { ...makeMap(), mapId: 'g', checksum: 'c'.repeat(64) }, maxTurns: 6 },
    };
    const report = await runMatch(config, {
      game: new FakeGame(),
      bots: {
        X: new ScriptedBot({
          replies: [{ kind: 'action', action: ACTIONS.X }, { kind: 'error', code: 'BOT_TIMEOUT' }, { kind: 'action', action: ACTIONS.X }],
        }),
        O: new ScriptedBot({ replies: [1, 2, 3].map(() => ({ kind: 'action' as const, action: ACTIONS.O })) }),
      },
    });
    expect(createHash('sha256').update(serializeEventLog(report.log)).digest('hex')).toBe(
      'e9a916229842c4a582bd7ab2dc08a8f5241369bd89c1a343fe69966b9dd36de5',
    );
  });
});
