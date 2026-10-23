import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import type { TimeControlV2 } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import {
  CoreGameAdapter,
  EVENT_LOG_FORMAT,
  EVENT_LOG_FORMAT_VERSION,
  EVENT_LOG_FORMAT_VERSION_V2,
  FakeClock,
  ScriptedBot,
  parseAnyEventLog,
  runMatch,
  serializeEventLog,
  type EventLogV1,
  type EventLogV2,
} from '@ott/match-runner';

import { publicEventLog, ReplayApiError } from '../src/modules/replays/service.ts';

const MATCH_ID = '00000000-0000-4000-8000-000000000001';

const sampleTimeControl: TimeControlV2 = {
  startupMs: 5000,
  totalBotBudgetMs: 60000,
  matchWallClockMs: 120000,
  perTurn: { mode: 'FIXED', fixedMs: 3000 },
};

async function buildV1Log(): Promise<EventLogV1> {
  const game = new CoreGameAdapter();
  const gameConfig = { gameId: MATCH_ID, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 };
  const firstState = game.create(gameConfig);
  const firstAction = game.listLegalActions(firstState, 'X')[0]!;
  const report = await runMatch(
    { matchId: MATCH_ID, seed: 'PRIVATE-SEED-V1', game: gameConfig, limits: { ...DEFAULT_LIMITS, maxTurns: 1 } },
    { game, bots: { X: new ScriptedBot({ replies: [{ kind: 'action', action: firstAction }] }), O: new ScriptedBot({ replies: [] }) } },
  );
  return report.log;
}

async function buildV2Log(): Promise<EventLogV2> {
  const game = new CoreGameAdapter();
  const gameConfig = { gameId: MATCH_ID, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 };
  const firstState = game.create(gameConfig);
  const firstAction = game.listLegalActions(firstState, 'X')[0]!;
  const report = await runMatch(
    {
      matchId: MATCH_ID,
      seed: 'PRIVATE-SEED-V2',
      game: gameConfig,
      limits: { ...DEFAULT_LIMITS, maxTurns: 1 },
      protocolV2: {
        timeControl: sampleTimeControl,
        botSeeds: { X: 'BOT-SEED-X', O: 'BOT-SEED-O' },
      },
    },
    {
      game,
      bots: { X: new ScriptedBot({ replies: [{ kind: 'action', action: firstAction }] }), O: new ScriptedBot({ replies: [] }) },
      clock: new FakeClock(),
    },
  );
  return report.log as EventLogV2;
}

describe('spectator replay projection', () => {
  it('projects v1 log byte-identically with schemaVersion 1 and no seed', async () => {
    const v1Log = await buildV1Log();
    const finalHash = v1Log.footer.result.finalStateHash;
    const projected = publicEventLog(v1Log, MATCH_ID, finalHash);

    expect(projected.schema).toBe('ott.spectator-replay');
    expect(projected.schemaVersion).toBe(1);
    expect(projected.matchId).toBe(MATCH_ID);
    expect(projected.header).toEqual({
      format: 'ott.match-event-log',
      formatVersion: 1,
      matchId: MATCH_ID,
      protocolVersion: 1,
      engineVersion: '1.0.0',
      game: {
        engineVersion: '1.0.0',
        maxTurns: 1,
        map: {
          schemaVersion: 1,
          mapId: DEFAULT_MAP.mapId,
          version: DEFAULT_MAP.version,
          checksum: DEFAULT_MAP.checksum,
          width: 9,
          height: 9,
          obstacles: DEFAULT_MAP.obstacles,
          spawns: DEFAULT_MAP.spawns,
          goals: DEFAULT_MAP.goals,
        },
      },
    });
    expect((projected.header as any).seed).toBeUndefined();
    expect((projected as any).timing).toBeUndefined();
    expect(projected.entries).toHaveLength(1);
    expect(projected.result.reason).toBe('TURN_LIMIT');
    expect(projected.result.winnerSide).toBeNull();

    // Golden check: serializing produces exact expected json byte-identically
    const body = `${JSON.stringify(projected, null, 2)}\n`;
    const fs = await import('node:fs');
    const golden = fs.readFileSync(new URL('./fixtures/spectator-replay-v1.golden.json', import.meta.url), 'utf8');
    expect(body).toBe(golden);
    expect(body).not.toContain('PRIVATE-SEED');
    expect(body).toContain('"schemaVersion": 1');
  });

  it('adds sanitized team names to v2 only; v1 stays byte-identical', async () => {
    const v2Log = await buildV2Log();
    const names = { X: 'Đội <b>Đỏ</b>\n\u0007', O: 'N'.repeat(300) };
    const projected = publicEventLog(v2Log, MATCH_ID, v2Log.footer.result.finalStateHash, names) as any;
    expect(projected.teams.X).toEqual({ name: 'Đội <b>Đỏ</b>' });
    expect(Array.from(projected.teams.O.name)).toHaveLength(128);
    expect(Object.keys(projected.teams)).toEqual(['X', 'O']);
    expect(Object.keys(projected.teams.X)).toEqual(['name']);
    const without = publicEventLog(v2Log, MATCH_ID, v2Log.footer.result.finalStateHash) as any;
    expect(without.teams).toBeUndefined();

    const v1Log = await buildV1Log();
    const v1 = publicEventLog(v1Log, MATCH_ID, v1Log.footer.result.finalStateHash, names) as any;
    expect(v1.teams).toBeUndefined();
  });

  it('projects v2 log to schemaVersion 2 with truthful versions, timeControl and timing array', async () => {
    const v2Log = await buildV2Log();
    const finalHash = v2Log.footer.result.finalStateHash;
    const projected = publicEventLog(v2Log, MATCH_ID, finalHash) as any;

    expect(projected.schema).toBe('ott.spectator-replay');
    expect(projected.schemaVersion).toBe(2);
    expect(projected.matchId).toBe(MATCH_ID);
    expect(projected.header.format).toBe('ott.match-event-log');
    expect(projected.header.formatVersion).toBe(2);
    expect(projected.header.protocolVersion).toBe(2);
    expect(projected.header.engineVersion).toBe('1.0.0');
    expect(projected.header.limits).toEqual({
      timeControl: sampleTimeControl,
    });
    expect(projected.header.seed).toBeUndefined();
    expect(projected.header.limits.maxTurns).toBeUndefined();
    expect(projected.header.limits.maxMessageBytes).toBeUndefined();

    expect(Array.isArray(projected.timing)).toBe(true);
    expect(projected.timing.length).toBeGreaterThan(0);
    const firstDecision = projected.timing[0];
    expect(firstDecision.turnId).toBe(1);
    expect(firstDecision.side).toBe('X');
    expect(firstDecision.turnLimitMs).toBe(3000);
    expect(firstDecision.deadlineMs).toBe(3000);
    expect(firstDecision.remainingBeforeMs).toBe(60000);
    expect(typeof firstDecision.elapsedMs).toBe('number');
    expect(typeof firstDecision.timedOut).toBe('boolean');

    const body = `${JSON.stringify(projected, null, 2)}\n`;
    expect(body).not.toContain('PRIVATE-SEED');
    expect(body).not.toContain('BOT-SEED');
  });

  it('strips unknown extra fields from v2 event-log', async () => {
    const v2Log = await buildV2Log();
    const finalHash = v2Log.footer.result.finalStateHash;
    const augmentedLog = {
      ...v2Log,
      extraFieldAtRoot: 'drop-me',
      header: {
        ...v2Log.header,
        extraHeaderField: 'drop-me-too',
        limits: {
          ...v2Log.header.limits,
          extraLimitsField: 'drop-me-three',
        },
      },
      timing: v2Log.timing.map((t) => ({ ...t, internalDiagnostics: 'private-data' })),
    };

    const projected = publicEventLog(augmentedLog as any, MATCH_ID, finalHash) as any;
    expect(projected.extraFieldAtRoot).toBeUndefined();
    expect(projected.header.extraHeaderField).toBeUndefined();
    expect(projected.header.limits.extraLimitsField).toBeUndefined();
    expect(projected.timing[0].internalDiagnostics).toBeUndefined();

    const body = JSON.stringify(projected);
    expect(body).not.toContain('drop-me');
    expect(body).not.toContain('private-data');
  });

  it('fails with 409 REPLAY_INTEGRITY_FAILED when v2 timing is not an array', async () => {
    const v2Log = await buildV2Log();
    const finalHash = v2Log.footer.result.finalStateHash;
    const malformed = { ...v2Log, timing: 'not-an-array' };

    expect(() => publicEventLog(malformed as any, MATCH_ID, finalHash)).toThrow(ReplayApiError);
    try {
      publicEventLog(malformed as any, MATCH_ID, finalHash);
    } catch (err: any) {
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('REPLAY_INTEGRITY_FAILED');
    }
  });

  it('fails with 409 REPLAY_INTEGRITY_FAILED when v2 timeControl is invalid', async () => {
    const v2Log = await buildV2Log();
    const finalHash = v2Log.footer.result.finalStateHash;
    const malformed = {
      ...v2Log,
      header: {
        ...v2Log.header,
        limits: {
          ...v2Log.header.limits,
          timeControl: { ...sampleTimeControl, startupMs: -1 },
        },
      },
    };

    expect(() => publicEventLog(malformed as any, MATCH_ID, finalHash)).toThrow(ReplayApiError);
    try {
      publicEventLog(malformed as any, MATCH_ID, finalHash);
    } catch (err: any) {
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('REPLAY_INTEGRITY_FAILED');
    }
  });

  it('fails with 409 REPLAY_INTEGRITY_FAILED when matchId or finalStateHash mismatches', async () => {
    const v2Log = await buildV2Log();
    const finalHash = v2Log.footer.result.finalStateHash;

    expect(() => publicEventLog(v2Log, '00000000-0000-4000-8000-000000000002', finalHash)).toThrow(ReplayApiError);
    expect(() => publicEventLog(v2Log, MATCH_ID, '0'.repeat(64))).toThrow(ReplayApiError);
  });
});
