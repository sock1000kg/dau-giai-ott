/**
 * P1-D02 — `GamePort`/`BotPort` boundary and the fakes that implement them.
 *
 * These tests are the acceptance contract for the doubles: `FakeGame` follows
 * Engine API v1 section 5/6/8 semantics with no game rules, and `ScriptedBot`
 * is deterministic, in-memory and free of timers/child processes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  GameAction,
  GameConfig,
  GameEvent,
  GameState,
  MapDefinition,
  PlayerSide,
} from '@ott/game-core';
import type {
  ActionMessage,
  InitMessage,
  MatchResultMessage,
  ProtocolMessage,
  StateUpdateMessage,
  TurnResultMessage,
} from '@ott/bot-protocol';

import type { BotPort, BotReplyErrorCode, BotStartResult, GamePort } from '../src/ports.ts';
import { FakeGame, ScriptedBot } from '../src/fakes.ts';

const MAP_CHECKSUM = 'b'.repeat(64);

/** Fresh spawns per config so a test may mutate one config without touching the fixture. */
function makeSpawns(): MapDefinition['spawns'] {
  return [
    { id: 'X1', owner: 'X', type: 'ROCK', position: { col: 0, row: 0 } },
    { id: 'O1', owner: 'O', type: 'PAPER', position: { col: 8, row: 8 } },
  ];
}

const DEFAULT_LEGAL_ACTIONS: readonly GameAction[] = [
  { pieceId: 'X1', to: { col: 1, row: 0 } },
  { pieceId: 'O1', to: { col: 7, row: 8 } },
];

const OTHER_ACTION: GameAction = { pieceId: 'X1', to: { col: 5, row: 5 } };

function makeConfig(overrides: { maxTurns?: number; gameId?: string } = {}): GameConfig {
  const map: MapDefinition = {
    schemaVersion: 1,
    mapId: 'fake-map',
    version: 1,
    checksum: MAP_CHECKSUM,
    width: 9,
    height: 9,
    obstacles: [],
    spawns: makeSpawns(),
    goals: { X: { col: 8, row: 8 }, O: { col: 0, row: 0 } },
  };
  return {
    gameId: overrides.gameId ?? 'match-1',
    engineVersion: '1.0.0',
    map,
    maxTurns: overrides.maxTurns ?? 2,
  };
}

function other(side: PlayerSide): PlayerSide {
  return side === 'X' ? 'O' : 'X';
}

function mustApply(port: GamePort, state: GameState, side: PlayerSide, action: GameAction) {
  const transition = port.apply(state, side, action);
  if (!transition.ok) throw new Error(`expected apply to succeed, got ${transition.code}`);
  return transition;
}

function mustSkip(
  port: GamePort,
  state: GameState,
  side: PlayerSide,
  reason: 'NO_LEGAL_ACTION',
) {
  const transition = port.skip(state, side, reason);
  if (!transition.ok) throw new Error(`expected skip to succeed, got ${transition.code}`);
  return transition;
}

/** `sequence` is the event ordering key and must strictly increase within a transition. */
function expectStrictlyIncreasing(events: readonly GameEvent[]): void {
  for (let i = 1; i < events.length; i += 1) {
    expect(events[i]?.sequence).toBeGreaterThan(events[i - 1]?.sequence as number);
  }
}

function makeInit(): InitMessage {
  return {
    type: 'INIT',
    protocolVersion: 1,
    matchId: 'match-1',
    engineVersion: '1.0.0',
    side: 'X',
    seed: 'seed-1',
    map: makeConfig().map,
    limits: {
      startupTimeoutMs: 5000,
      turnTimeoutMs: 3000,
      maxTurns: 200,
      maxMessageBytes: 65536,
      maxStderrBytes: 1048576,
      maxConsecutiveFaults: 3,
      maxTotalFaults: 5,
    },
  };
}

function makeStateUpdate(state: GameState, turnId = 7): StateUpdateMessage {
  return {
    type: 'STATE_UPDATE',
    protocolVersion: 1,
    matchId: 'match-1',
    turnId,
    state: {
      schemaVersion: 1,
      engineVersion: '1.0.0',
      map: state.map,
      status: 'PLAYING',
      turn: state.turn,
      turnNumber: state.turnNumber,
      turnCount: state.turnCount,
      revision: state.revision,
      maxTurns: state.maxTurns,
      pieces: state.pieces,
      outcome: null,
    },
    legalActions: DEFAULT_LEGAL_ACTIONS,
  };
}

function makeTurnResult(): TurnResultMessage {
  return {
    type: 'TURN_RESULT',
    protocolVersion: 1,
    matchId: 'match-1',
    turnId: 1,
    actorSide: 'X',
    outcome: 'APPLIED',
    action: DEFAULT_LEGAL_ACTIONS[0] ?? null,
    errorCode: null,
    revision: 1,
    nextSide: 'O',
  };
}

function makeMatchResult(): MatchResultMessage {
  return {
    type: 'MATCH_RESULT',
    protocolVersion: 1,
    matchId: 'match-1',
    winnerSide: 'X',
    reason: 'REACHED_GOAL',
    turnCount: 1,
    finalStateHash: 'c'.repeat(64),
    faults: {
      X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
    },
  };
}

describe('FakeGame', () => {
  it('1. create matches Engine API v1 section 5 and deep-copies spawns', () => {
    const config = makeConfig();
    const state = new FakeGame().create(config);

    expect(state).toEqual({
      schemaVersion: 1,
      engineVersion: '1.0.0',
      gameId: 'match-1',
      map: { mapId: 'fake-map', version: 1, checksum: MAP_CHECKSUM },
      status: 'PLAYING',
      turn: 'X',
      turnNumber: 1,
      turnCount: 0,
      revision: 0,
      maxTurns: 2,
      pieces: [...makeSpawns()].sort((a, b) => (a.id < b.id ? -1 : 1)),
      outcome: null,
    });

    // Mutating the config afterwards must not reach the created state.
    const mutableSpawns = config.map.spawns as GameState['pieces'];
    (mutableSpawns[0] as { position: { col: number; row: number } }).position = { col: 7, row: 7 };
    expect(state.pieces).not.toBe(config.map.spawns);
    expect(state.pieces.map((piece) => piece.position)).toEqual([
      { col: 8, row: 8 },
      { col: 0, row: 0 },
    ]);
  });

  it('2. a legal apply advances the counters, swaps the turn and never mutates the input', () => {
    const game = new FakeGame();
    const state = game.create(makeConfig());
    const before = structuredClone(state);
    const side = state.turn;
    const action = game.listLegalActions(state, side)[0] as GameAction;

    const transition = mustApply(game, state, side, action);

    expect(transition.state.turnCount).toBe(1);
    expect(transition.state.revision).toBe(1);
    expect(transition.state.turnNumber).toBe(2);
    expect(transition.state.turn).toBe(other(side));
    expect(transition.state.status).toBe('PLAYING');
    expect(transition.result).toBeNull();
    expect(transition.events).toEqual([
      {
        sequence: 1,
        revision: 1,
        turnId: 1,
        type: 'ACTION_APPLIED',
        side,
        action,
        reason: null,
      },
    ] satisfies readonly GameEvent[]);
    expect(state).toEqual(before);
    expect(game.result(transition.state)).toBeNull();
  });

  it('3. validation order is GAME_NOT_PLAYING, NOT_YOUR_TURN, ILLEGAL_MOVE', () => {
    const game = new FakeGame();
    const state = game.create(makeConfig({ maxTurns: 1 }));
    const action = game.listLegalActions(state, 'X')[0] as GameAction;

    const wrongSide = game.apply(state, other(state.turn), action);
    expect(wrongSide.ok).toBe(false);
    expect(wrongSide.ok === false && wrongSide.code).toBe('NOT_YOUR_TURN');

    const illegal = game.apply(state, state.turn, OTHER_ACTION);
    expect(illegal.ok).toBe(false);
    expect(illegal.ok === false && illegal.code).toBe('ILLEGAL_MOVE');
    expect(illegal.ok === false && 'state' in illegal).toBe(false);

    const played = mustApply(game, state, state.turn, action);
    const finishedBefore = structuredClone(played.state);

    // Precedence: on a FINISHED state, GAME_NOT_PLAYING wins over NOT_YOUR_TURN.
    const finishedWrongSide = game.apply(played.state, other(played.state.turn), action);
    expect(finishedWrongSide.ok).toBe(false);
    expect(finishedWrongSide.ok === false && finishedWrongSide.code).toBe('GAME_NOT_PLAYING');

    const finished = game.apply(played.state, played.state.turn, action);
    expect(finished.ok).toBe(false);
    expect(finished.ok === false && finished.code).toBe('GAME_NOT_PLAYING');
    expect(played.state).toEqual(finishedBefore);

    // A rejected action changes nothing.
    expect(state.revision).toBe(0);
    expect(state.turnCount).toBe(0);
  });

  it('4. skip with NO_LEGAL_ACTION emits TURN_SKIPPED and advances the turn', () => {
    const game = new FakeGame();
    const state = game.create(makeConfig());
    const side = state.turn;

    const transition = mustSkip(game, state, side, 'NO_LEGAL_ACTION');

    expect(transition.state.turnCount).toBe(1);
    expect(transition.state.revision).toBe(1);
    expect(transition.state.turnNumber).toBe(2);
    expect(transition.state.turn).toBe(other(side));
    expect(transition.state.status).toBe('PLAYING');
    expect(transition.events).toEqual([
      {
        sequence: 1,
        revision: 1,
        turnId: 1,
        type: 'TURN_SKIPPED',
        side,
        action: null,
        reason: 'NO_LEGAL_ACTION',
      },
    ] satisfies readonly GameEvent[]);
  });

  it('5. maxTurns finishes the match as a TURN_LIMIT draw and holds turn/turnNumber', () => {
    const game = new FakeGame();
    let state = game.create(makeConfig({ maxTurns: 2 }));

    const first = mustApply(game, state, state.turn, game.listLegalActions(state, state.turn)[0] as GameAction);
    expect(first.state.status).toBe('PLAYING');

    const second = mustApply(
      game,
      first.state,
      first.state.turn,
      game.listLegalActions(first.state, first.state.turn)[0] as GameAction,
    );

    expect(second.state.status).toBe('FINISHED');
    expect(second.state.turn).toBe(first.state.turn);
    expect(second.state.turnNumber).toBe(first.state.turnNumber);
    expect(second.state.outcome).toEqual({
      winnerSide: null,
      reason: 'TURN_LIMIT',
      turnCount: 2,
      forfeitedSide: null,
    });
    expect(second.events.map((event) => event.type)).toEqual(['ACTION_APPLIED', 'MATCH_FINISHED']);
    expect(second.events[1]?.reason).toBe('TURN_LIMIT');
    // Every event names the revision of the state this transition produced, and the
    // sequence values are strictly increasing.
    expect(second.events.map((event) => event.revision)).toEqual([
      second.state.revision,
      second.state.revision,
    ]);
    expectStrictlyIncreasing(second.events);
    expect(second.result).toEqual({
      winnerSide: null,
      reason: 'TURN_LIMIT',
      turnCount: 2,
      forfeitedSide: null,
      finalStateHash: game.hash(second.state),
    });

    state = second.state;
    const after = game.apply(state, state.turn, game.listLegalActions(state, state.turn)[0] as GameAction);
    expect(after.ok).toBe(false);
    expect(after.ok === false && after.code).toBe('GAME_NOT_PLAYING');
  });

  it('6. a scripted win on the last turn wins instead of drawing', () => {
    const game = new FakeGame({
      finishAt: { turnCount: 2, winnerSide: 'O', reason: 'REACHED_GOAL' },
    });
    const initial = game.create(makeConfig({ maxTurns: 2 }));
    const first = mustApply(
      game,
      initial,
      initial.turn,
      game.listLegalActions(initial, initial.turn)[0] as GameAction,
    );
    const second = mustApply(
      game,
      first.state,
      first.state.turn,
      game.listLegalActions(first.state, first.state.turn)[0] as GameAction,
    );

    expect(second.state.status).toBe('FINISHED');
    expect(second.state.outcome).toEqual({
      winnerSide: 'O',
      reason: 'REACHED_GOAL',
      turnCount: 2,
      forfeitedSide: null,
    });
    expect(second.result?.winnerSide).toBe('O');
    expect(second.events.map((event) => event.revision)).toEqual([
      second.state.revision,
      second.state.revision,
    ]);
    expectStrictlyIncreasing(second.events);
  });

  it('7. forfeit only bumps revision and hands the win to the other side', () => {
    const game = new FakeGame();
    const state = game.create(makeConfig());

    const transition = game.forfeit(state, 'O', 'BOT_CRASHED');
    expect(transition.ok).toBe(true);
    if (!transition.ok) return;

    expect(transition.state.revision).toBe(1);
    expect(transition.state.turnCount).toBe(0);
    expect(transition.state.turnNumber).toBe(1);
    expect(transition.state.turn).toBe('X');
    expect(transition.state.status).toBe('FINISHED');
    expect(transition.state.outcome).toEqual({
      winnerSide: 'X',
      reason: 'FORFEIT',
      turnCount: 0,
      forfeitedSide: 'O',
    });
    expect(transition.events.map((event) => event.type)).toEqual(['MATCH_FINISHED']);
    expect(transition.events.map((event) => event.revision)).toEqual([transition.state.revision]);
    expectStrictlyIncreasing(transition.events);
    expect(transition.result?.winnerSide).toBe('X');

    const alreadyFinished = game.forfeit(transition.state, 'O', 'BOT_CRASHED');
    expect(alreadyFinished.ok).toBe(false);
    expect(alreadyFinished.ok === false && alreadyFinished.code).toBe('GAME_NOT_PLAYING');
  });

  it('8. hash is lowercase SHA-256 hex, ignores gameId and feeds GameResult', () => {
    const game = new FakeGame();
    const a = game.create(makeConfig({ gameId: 'match-a' }));
    const b = game.create(makeConfig({ gameId: 'match-b' }));

    expect(a.gameId).not.toBe(b.gameId);
    expect(game.hash(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(game.hash(a)).toBe(game.hash(b));
    expect(game.hash(a)).toBe(game.hash(structuredClone(a)));

    const played = mustApply(game, a, a.turn, game.listLegalActions(a, a.turn)[0] as GameAction);
    expect(game.hash(played.state)).not.toBe(game.hash(a));
    expect(game.result(played.state)).toBeNull();

    const finished = new FakeGame();
    const oneTurn = finished.create(makeConfig({ maxTurns: 1 }));
    const done = mustApply(
      finished,
      oneTurn,
      oneTurn.turn,
      finished.listLegalActions(oneTurn, oneTurn.turn)[0] as GameAction,
    );
    expect(finished.result(done.state)?.finalStateHash).toBe(finished.hash(done.state));
  });

  it('9. two identical scripted runs produce equal states, events and hashes', () => {
    const script = (): { readonly state: GameState; readonly events: readonly GameEvent[] } => {
      const game = new FakeGame();
      let state = game.create(makeConfig({ maxTurns: 10 }));
      const events: GameEvent[] = [];
      for (let i = 0; i < 3; i += 1) {
        const action = game.listLegalActions(state, state.turn)[0] as GameAction;
        const transition = mustApply(game, state, state.turn, action);
        state = transition.state;
        events.push(...transition.events);
      }
      return { state, events };
    };

    const first = script();
    const second = script();
    expect(first.state).toEqual(second.state);
    expect(first.events).toEqual(second.events);
    expect(new FakeGame().hash(first.state)).toBe(new FakeGame().hash(second.state));

    // Event sequences stay strictly increasing across a whole scripted run.
    expectStrictlyIncreasing(first.events);
    expect(first.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('9b. a finishing turn keeps sequences increasing across the whole run', () => {
    const game = new FakeGame();
    let state = game.create(makeConfig({ maxTurns: 3 }));
    const events: GameEvent[] = [];

    for (let i = 0; i < 3; i += 1) {
      const transition = mustApply(
        game,
        state,
        state.turn,
        game.listLegalActions(state, state.turn)[0] as GameAction,
      );
      state = transition.state;
      events.push(...transition.events);
    }

    expect(state.status).toBe('FINISHED');
    expect(events.map((event) => event.type)).toEqual([
      'ACTION_APPLIED',
      'ACTION_APPLIED',
      'ACTION_APPLIED',
      'MATCH_FINISHED',
    ]);
    expectStrictlyIncreasing(events);
    // Every event names a revision the game actually produced.
    expect(new Set(events.map((event) => event.revision))).toEqual(new Set([1, 2, 3]));
  });

  it('records a typed call log', () => {
    const game = new FakeGame();
    const state = game.create(makeConfig());
    mustApply(game, state, state.turn, game.listLegalActions(state, state.turn)[0] as GameAction);
    expect(game.calls).toEqual(['create', 'listLegalActions', 'apply', 'result']);
  });
});

describe('ScriptedBot', () => {
  it('10. serves replies in order and echoes matchId/turnId for action replies', async () => {
    const update = makeStateUpdate(new FakeGame().create(makeConfig()), 42);
    const raw: ActionMessage = {
      type: 'ACTION',
      protocolVersion: 1,
      matchId: 'other-match',
      turnId: 99,
      action: DEFAULT_LEGAL_ACTIONS[0] as GameAction,
    };
    const bot = new ScriptedBot({
      replies: [
        { kind: 'action', action: DEFAULT_LEGAL_ACTIONS[0] as GameAction },
        { kind: 'raw', message: raw },
      ],
    });

    const first = await bot.requestAction(update, 3000);
    expect(first).toEqual({
      ok: true,
      message: {
        type: 'ACTION',
        protocolVersion: 1,
        matchId: 'match-1',
        turnId: 42,
        action: DEFAULT_LEGAL_ACTIONS[0],
      },
    });

    const second = await bot.requestAction(update, 3000);
    expect(second).toEqual({ ok: true, message: raw });
  });

  it('11. error replies are values and throw replies reject', async () => {
    const update = makeStateUpdate(new FakeGame().create(makeConfig()));
    const bot = new ScriptedBot({
      replies: [{ kind: 'error', code: 'BOT_TIMEOUT' }],
    });
    expect(await bot.requestAction(update, 3000)).toEqual({ ok: false, code: 'BOT_TIMEOUT' });

    const boom = new Error('adapter bug');
    const throwing = new ScriptedBot({ replies: [{ kind: 'throw', error: boom }] });
    await expect(throwing.requestAction(update, 3000)).rejects.toBe(boom);
  });

  it('12. an exhausted script reports BOT_EOF', async () => {
    const update = makeStateUpdate(new FakeGame().create(makeConfig()));
    const bot = new ScriptedBot({ replies: [{ kind: 'action', action: DEFAULT_LEGAL_ACTIONS[0] as GameAction }] });

    expect((await bot.requestAction(update, 3000)).ok).toBe(true);
    expect(await bot.requestAction(update, 3000)).toEqual({ ok: false, code: 'BOT_EOF' });
  });

  it('13. records every received message in call order', async () => {
    const state = new FakeGame().create(makeConfig());
    const update = makeStateUpdate(state);
    const turnResult = makeTurnResult();
    const matchResult = makeMatchResult();
    const bot = new ScriptedBot({ replies: [{ kind: 'action', action: DEFAULT_LEGAL_ACTIONS[0] as GameAction }] });

    await bot.start(makeInit());
    await bot.requestAction(update, 3000);
    await bot.sendTurnResult(turnResult);
    await bot.finish(matchResult);

    expect(bot.received).toEqual([
      makeInit(),
      update,
      turnResult,
      matchResult,
    ] satisfies readonly ProtocolMessage[]);
  });

  it('14. stop is idempotent and post-stop calls are deterministic', async () => {
    const state = new FakeGame().create(makeConfig());
    const update = makeStateUpdate(state);
    const bot = new ScriptedBot({ replies: [{ kind: 'action', action: DEFAULT_LEGAL_ACTIONS[0] as GameAction }] });

    await bot.start(makeInit());
    await bot.stop();
    await bot.stop();
    expect(bot.stopCalls).toBe(2);

    expect(await bot.requestAction(update, 3000)).toEqual({ ok: false, code: 'BOT_EOF' });
    expect(await bot.start(makeInit())).toEqual({ ok: false, code: 'BOT_EOF' });
    await expect(bot.sendTurnResult(makeTurnResult())).resolves.toBeUndefined();
    await expect(bot.finish(makeMatchResult())).resolves.toBeUndefined();

    // Nothing received after stop() is recorded.
    expect(bot.received).toEqual([makeInit()]);
  });

  it('15. a scripted start failure is returned, not thrown', async () => {
    const failure: BotStartResult = { ok: false, code: 'BOT_SPAWN_FAILED' };
    const bot = new ScriptedBot({ replies: [], startResult: failure });
    expect(await bot.start(makeInit())).toEqual(failure);

    const healthy = new ScriptedBot({ replies: [] });
    expect(await healthy.start(makeInit())).toEqual({ ok: true });
  });
});

describe('boundaries', () => {
  /** `src/ports.ts` imports `@ott/game-core` + `@ott/bot-protocol`; same for `src/fakes.ts`. */
  const EXPECTED_OTT_IMPORTS: Readonly<Record<string, number>> = {
    '../src/ports.ts': 2,
    '../src/fakes.ts': 2,
  };

  const read = (name: string): string =>
    readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

  it('16. ports and fakes import domain modules type-only and spawn no processes', () => {
    // Complete import statements, not lines: `[^;]*?` spans newlines because the class
    // excludes only `;`, so a multi-line `import type { ... } from '@ott/...'` is matched.
    const ottImports = /^import\s+(?<kind>type\s+)?(?:[^;]*?)\bfrom\s+'(?<module>@ott\/[^']+)'/gm;

    for (const file of ['../src/ports.ts', '../src/fakes.ts']) {
      const source = read(file);
      expect(source).not.toMatch(/child_process/);

      // No side-effect import and no runtime re-export of a workspace module.
      expect(source).not.toMatch(/^import\s+'@ott\//m);
      expect(source).not.toMatch(/^export\s+(?!type)[^;]*from\s+'@ott\//m);

      const matches = [...source.matchAll(ottImports)];
      // Guard against the check going vacuous: this file must contain exactly the
      // expected number of `@ott` import statements.
      expect(matches).toHaveLength(EXPECTED_OTT_IMPORTS[file] as number);
      for (const match of matches) {
        expect(match.groups?.['module']).toMatch(/^@ott\/(game-core|bot-protocol)$/);
        expect(match.groups?.['kind']).toBe('type ');
      }
    }
  });

  it('17. the fakes satisfy the port types', () => {
    const g: GamePort = new FakeGame();
    const b: BotPort = new ScriptedBot({ replies: [] });
    const codes: readonly BotReplyErrorCode[] = ['BOT_TIMEOUT', 'MALFORMED_JSON', 'BOT_EOF'];
    expect(typeof g.create).toBe('function');
    expect(typeof b.stop).toBe('function');
    expect(codes).toHaveLength(3);
  });
});
