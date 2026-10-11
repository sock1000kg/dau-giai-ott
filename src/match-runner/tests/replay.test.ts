/**
 * P1-D07 — Replay verifier tests: valid log replay, tampering detection, and determinism.
 *
 * AC coverage (tasks/todo.md → P1-D07):
 * - AC 3 (verifier catches missing/extra/out-of-order events and hash mismatches): tests 8, 9, 10.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import type { Limits } from '@ott/bot-protocol';
import type { GameAction, MapDefinition } from '@ott/game-core';

import {
  FakeGame,
  ScriptedBot,
  runMatch,
  verifyReplay,
} from '../src/index.ts';
import type {
  EventLogEntry,
  EventLogFooter,
  EventLogHeader,
  EventLogV1,
  MatchConfig,
  MatchPorts,
  ScriptedReply,
} from '../src/index.ts';

type MutableEventLog = {
  header: EventLogHeader;
  entries: EventLogEntry[];
  footer: EventLogFooter;
};

function cloneMutable(log: EventLogV1): MutableEventLog {
  return structuredClone(log) as unknown as MutableEventLog;
}

const MAP_CHECKSUM = 'f'.repeat(64);
const MATCH_ID = 'match-replay';
const SEED = 'seed-replay';
const ACTION_X: GameAction = { pieceId: 'X1', to: { col: 0, row: 0 } };
const ACTION_O: GameAction = { pieceId: 'O1', to: { col: 0, row: 0 } };
const UNLISTED_ACTION: GameAction = { pieceId: 'X1', to: { col: 4, row: 4 } };

function makeMap(): MapDefinition {
  return {
    schemaVersion: 1,
    mapId: 'replay-map',
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
}): { ports: MatchPorts; game: FakeGame } {
  const game = options.game ?? new FakeGame();
  const botX = new ScriptedBot({
    replies: options.xReplies ?? [],
    startResult: options.xStartOk === false ? { ok: false, code: options.xStartFault ?? 'BOT_SPAWN_FAILED' } : { ok: true },
  });
  const botO = new ScriptedBot({
    replies: options.oReplies ?? [],
  });
  return { ports: { game, bots: { X: botX, O: botO } }, game };
}

describe('P1-D07 — Replay verifier', () => {
  it('8. valid logs from happy and error scenarios replay with ok: true and matching state/result', async () => {
    // 8a. Happy path replay
    const configHappy = makeConfig(4);
    const { ports: portsHappy, game: gameHappy } = makePorts({
      game: new FakeGame(),
      xReplies: [{ kind: 'action', action: ACTION_X }, { kind: 'action', action: ACTION_X }],
      oReplies: [{ kind: 'action', action: ACTION_O }, { kind: 'action', action: ACTION_O }],
    });
    const reportHappy = await runMatch(configHappy, portsHappy);

    // Fresh FakeGame for replay
    const replayGameHappy = new FakeGame();
    const verdictHappy = verifyReplay(reportHappy.log, replayGameHappy);
    expect(verdictHappy.ok).toBe(true);
    if (verdictHappy.ok) {
      expect(verdictHappy.finalState).toEqual(reportHappy.finalState);
      expect(verdictHappy.result).toEqual(reportHappy.result);
    }

    // 8b. Recoverable skips + threshold forfeit replay
    const configRecoverable = makeConfig(10, { maxConsecutiveFaults: 3 });
    const { ports: portsRec } = makePorts({
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
    const reportRec = await runMatch(configRecoverable, portsRec);

    const replayGameRec = new FakeGame();
    const verdictRec = verifyReplay(reportRec.log, replayGameRec);
    expect(verdictRec.ok).toBe(true);
    if (verdictRec.ok) {
      expect(verdictRec.finalState).toEqual(reportRec.finalState);
      expect(verdictRec.result).toEqual(reportRec.result);
    }

    // 8c. Process fault forfeit replay
    const configCrash = makeConfig(4);
    const { ports: portsCrash } = makePorts({
      xReplies: [{ kind: 'error', code: 'BOT_CRASHED' }],
      oReplies: [],
    });
    const reportCrash = await runMatch(configCrash, portsCrash);

    const replayGameCrash = new FakeGame();
    const verdictCrash = verifyReplay(reportCrash.log, replayGameCrash);
    expect(verdictCrash.ok).toBe(true);
    if (verdictCrash.ok) {
      expect(verdictCrash.finalState).toEqual(reportCrash.finalState);
      expect(verdictCrash.result).toEqual(reportCrash.result);
    }

    // 8d. Start failure forfeit replay
    const configSpawn = makeConfig(4);
    const { ports: portsSpawn } = makePorts({
      xStartOk: false,
      xStartFault: 'BOT_SPAWN_FAILED',
      xReplies: [],
      oReplies: [],
    });
    const reportSpawn = await runMatch(configSpawn, portsSpawn);

    const replayGameSpawn = new FakeGame();
    const verdictSpawn = verifyReplay(reportSpawn.log, replayGameSpawn);
    expect(verdictSpawn.ok).toBe(true);
    if (verdictSpawn.ok) {
      expect(verdictSpawn.finalState).toEqual(reportSpawn.finalState);
      expect(verdictSpawn.result).toEqual(reportSpawn.result);
    }
  });

  it('9. each tamper is caught with the exact code and points at the tampered entry or null', async () => {
    // Generate a valid 4-turn log (2 turns X, 2 turns O)
    const config = makeConfig(4);
    const { ports } = makePorts({
      xReplies: [{ kind: 'action', action: ACTION_X }, { kind: 'action', action: ACTION_X }],
      oReplies: [{ kind: 'action', action: ACTION_O }, { kind: 'action', action: ACTION_O }],
    });
    const report = await runMatch(config, ports);
    const validLog = report.log;
    expect(validLog.entries.length).toBe(4);

    // 9a. Remove a middle entry without renumbering -> SEQUENCE_GAP at the gap
    {
      const tampered = cloneMutable(validLog);
      // Remove entry at index 2 (1-based index 2, 0-based array index 1)
      tampered.entries.splice(1, 1);
      // Now entries have indices [1, 3, 4]
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('SEQUENCE_GAP');
        expect(verdict.index).toBe(3);
      }
    }

    // 9b. Renumber after removal of middle entry -> EVENT_MISMATCH or ENGINE_REJECTED
    {
      const tampered = cloneMutable(validLog);
      tampered.entries.splice(1, 1); // remove O's turn
      // Renumber remaining entries to 1, 2, 3
      tampered.entries.forEach((e, idx) => {
        (e as { index: number }).index = idx + 1;
      });
      (tampered.footer as { entryCount: number }).entryCount = tampered.entries.length;
      // Entry 2 is now X's second turn, but the engine expects O's turn!
      // In FakeGame: state.turn is O, but entry 2 has side X -> FakeGame.apply returns NOT_YOUR_TURN -> ENGINE_REJECTED!
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('ENGINE_REJECTED');
        expect(verdict.index).toBe(2);
      }
    }

    // 9c. Swap two entries (renumbered) -> non-ok (ENGINE_REJECTED or EVENT_MISMATCH)
    {
      const tampered = cloneMutable(validLog);
      const temp = tampered.entries[0]!;
      tampered.entries[0] = tampered.entries[1]!;
      tampered.entries[1] = temp;
      tampered.entries.forEach((e, idx) => {
        (e as { index: number }).index = idx + 1;
      });
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(['ENGINE_REJECTED', 'EVENT_MISMATCH']).toContain(verdict.code);
        expect(verdict.index).toBe(1);
      }
    }

    // 9d. Duplicate the last entry (with renumber + entryCount fix) -> EXTRA_ENTRIES
    {
      const tampered = cloneMutable(validLog);
      const last = structuredClone(tampered.entries[tampered.entries.length - 1]!);
      tampered.entries.push(last);
      tampered.entries.forEach((e, idx) => {
        (e as { index: number }).index = idx + 1;
      });
      (tampered.footer as { entryCount: number }).entryCount = tampered.entries.length;
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('EXTRA_ENTRIES');
        expect(verdict.index).toBe(5);
      }
    }

    // 9e. Drop the last entry (renumber + entryCount fix) -> MISSING_ENTRIES
    {
      const tampered = cloneMutable(validLog);
      tampered.entries.pop();
      tampered.entries.forEach((e, idx) => {
        (e as { index: number }).index = idx + 1;
      });
      (tampered.footer as { entryCount: number }).entryCount = tampered.entries.length;
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('MISSING_ENTRIES');
        expect(verdict.index).toBeNull();
      }
    }

    // 9f. Edit one event's side / reason -> EVENT_MISMATCH
    {
      const tampered = structuredClone(validLog);
      // Mutate event side in entry 2
      const entry2 = tampered.entries[1]!;
      (entry2.events[0] as { side: string }).side = 'X'; // was O
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('EVENT_MISMATCH');
        expect(verdict.index).toBe(2);
      }
    }

    // 9g. Edit a stateHash -> STATE_HASH_MISMATCH
    {
      const tampered = structuredClone(validLog);
      (tampered.entries[2] as { stateHash: string }).stateHash = 'tampered-hash-000';
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('STATE_HASH_MISMATCH');
        expect(verdict.index).toBe(3);
      }
    }

    // 9h. Edit footer.result.winnerSide -> RESULT_MISMATCH
    {
      const tampered = structuredClone(validLog);
      (tampered.footer.result as { winnerSide: string | null }).winnerSide = 'X'; // was null (turn limit draw)
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('RESULT_MISMATCH');
        expect(verdict.index).toBeNull();
      }
    }

    // 9i. Edit footer.result.finalStateHash -> FINAL_HASH_MISMATCH
    {
      const tampered = structuredClone(validLog);
      (tampered.footer.result as { finalStateHash: string }).finalStateHash = 'fake-final-hash';
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('FINAL_HASH_MISMATCH');
        expect(verdict.index).toBeNull();
      }
    }

    // 9j. Change an apply input's action to an unlisted action -> ENGINE_REJECTED
    {
      const tampered = cloneMutable(validLog);
      tampered.entries[0] = {
        ...tampered.entries[0]!,
        input: { kind: 'apply', side: 'X', action: UNLISTED_ACTION },
      };
      const verdict = verifyReplay(tampered, new FakeGame());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.code).toBe('ENGINE_REJECTED');
        expect(verdict.index).toBe(1);
      }
    }
  });

  it('10. verification is deterministic and never mutates the input log', async () => {
    const config = makeConfig(4);
    const { ports } = makePorts({
      xReplies: [{ kind: 'action', action: ACTION_X }],
      oReplies: [{ kind: 'action', action: ACTION_O }],
    });
    const report = await runMatch(config, ports);
    const log = report.log;

    const snapshotBefore = structuredClone(log);

    const verdict1 = verifyReplay(log, new FakeGame());
    const verdict2 = verifyReplay(log, new FakeGame());

    // Determinism: same verdicts
    expect(verdict1).toEqual(verdict2);

    // Non-mutation: log was not touched
    expect(log).toEqual(snapshotBefore);
  });
});
