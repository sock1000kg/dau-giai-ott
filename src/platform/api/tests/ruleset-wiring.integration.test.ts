import { randomUUID } from 'node:crypto';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { MAP_REGISTRY } from '../src/modules/rounds/catalog.ts';
import { createRound, createRuleSet, executeTransition } from '../src/modules/rounds/service.ts';
import type { RoundRuleSetRulesV1 } from '../src/modules/rounds/types.ts';
import { scheduleRound } from '../src/modules/scheduling/service.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

function rules(overrides: Partial<RoundRuleSetRulesV1> = {}): RoundRuleSetRulesV1 {
  return {
    schemaVersion: 'ott.round-rules.v1',
    engineVersion: '1.0.0',
    mapSet: [{ mapId: DEFAULT_MAP.mapId, checksum: DEFAULT_MAP.checksum }],
    maxTurns: 123,
    faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: {
      startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000,
      perTurn: { mode: 'DYNAMIC', baseMs: 500, stepMs: 250, everyTurns: 20, maxMs: 2345 },
    },
    resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
    schedule: {
      submissionOpensAt: '2026-10-14T14:00:00.000Z', submissionDeadlineAt: '2026-10-17T23:59:00.000Z',
      graceEndsAt: '2026-10-18T12:00:00.000Z', runStartsAt: '2026-10-18T14:00:00.000Z',
      runMaxHours: 48, appealEndsAt: '2026-10-21T12:00:00.000Z',
    },
    testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE'] },
    ...overrides,
  };
}

const digest = () => `sha256:${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`;

interface MatchRow {
  readonly series_id: string;
  readonly engine_version: string;
  readonly max_turns: number;
  readonly turn_timeout_ms: number;
  readonly map_checksum: string;
  readonly map_definition: { readonly checksum: string };
}

integration('P3-D25 rule set wiring (PostgreSQL)', () => {
  let database: Database;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
  const accountId = randomUUID();
  const teamIds: string[] = [];
  const submissionIds: string[] = [];
  const scheduledRoundIds: string[] = [];

  async function seedStage(name: string, teams: number): Promise<string> {
    const stage = `P3D25${name}_${suffix}`;
    for (let index = 0; index < teams; index += 1) {
      const teamId = randomUUID();
      const submissionId = randomUUID();
      teamIds.push(teamId);
      submissionIds.push(submissionId);
      await database.query('INSERT INTO teams (id, name) VALUES ($1,$2)', [teamId, `P3D25 ${suffix} ${name} ${index}`]);
      await database.query(
        "INSERT INTO submissions (id, team_id, tournament_stage, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, policy_version, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'P2_BASELINE_V1','ACTIVE')",
        [submissionId, teamId, stage, digest(), digest(), digest(), `p3d25/${submissionId}`],
      );
    }
    return stage;
  }

  async function matchesOf(roundId: string): Promise<MatchRow[]> {
    const result = await database.query<MatchRow>(
      `SELECT m.series_id, m.engine_version, m.max_turns, m.turn_timeout_ms, m.map_checksum, m.map_definition
       FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1 ORDER BY m.series_id, m.game_number`, [roundId]);
    return result.rows;
  }

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
    await database.query("INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, $2, $3, 'BTC_ADMIN')", [accountId, `p3d25-${suffix}`, 'hash']);
  });

  // dispatchScheduledMatches is global across parallel test files, so a fixture must never leave
  // (or expose) undispatched outbox rows. Assertions below read matches from the DB, not from the
  // queue, so a row dispatched by a concurrent file in the tiny window before this runs changes nothing.
  async function quarantineFixtureMatches(roundId: string): Promise<void> {
    await database.query(
      `UPDATE match_outbox SET dispatched_at = now() WHERE dispatched_at IS NULL AND match_id IN (
         SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)`, [roundId]);
  }

  async function removeFixtureMatches(roundId: string): Promise<void> {
    const owned = 'SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1';
    await database.query(`DELETE FROM match_outbox WHERE match_id IN (${owned})`, [roundId]);
    await database.query(`DELETE FROM match_results WHERE match_id IN (${owned})`, [roundId]);
    await database.query(`DELETE FROM match_events WHERE match_id IN (${owned})`, [roundId]);
    await database.query(`DELETE FROM match_attempts WHERE match_id IN (${owned})`, [roundId]);
    await database.query('DELETE FROM matches WHERE series_id IN (SELECT id FROM series WHERE round_id = $1)', [roundId]);
  }

  afterEach(async () => {
    // Only matches and their outbox are removed. series, round_participants, rounds and
    // qualification_rounds stay: qualification_rounds.schedule_round_id references rounds and is locked
    // by immutability triggers, so those rows are left inert (every fixture uses a run-unique stage).
    const roundIds = scheduledRoundIds.splice(0);
    for (const roundId of roundIds) await removeFixtureMatches(roundId);
  });

  afterAll(async () => {
    await database.close();
  });

  it('start writes the locked engine, map, maxTurns and per-turn maximum into every match', async () => {
    const stage = await seedStage('A', 4);
    const created = await createRuleSet(database, { tournamentStage: stage, rules: rules(), reason: 'wiring rules', actorAccountId: accountId });
    const round = await createRound(database, { tournamentStage: stage, reason: 'wiring', actorAccountId: accountId });
    await executeTransition(database, { roundId: round.id, action: { type: 'open', ruleSetId: created.id }, reason: 'open', actorAccountId: accountId });
    await executeTransition(database, { roundId: round.id, action: { type: 'close' }, reason: 'close', actorAccountId: accountId }, { now: () => new Date('2026-10-18T13:00:00.000Z') });
    const started = await executeTransition(database, { roundId: round.id, action: { type: 'start', ruleSetId: created.id, idempotencyKey: 'wiring-start' }, reason: 'start', actorAccountId: accountId });
    scheduledRoundIds.push(started.scheduleRoundId!);
    await quarantineFixtureMatches(started.scheduleRoundId!);
    const replay = await executeTransition(database, { roundId: round.id, action: { type: 'start', ruleSetId: created.id, idempotencyKey: 'wiring-start' }, reason: 'retry', actorAccountId: accountId });
    await quarantineFixtureMatches(started.scheduleRoundId!);
    expect(replay.scheduleRoundId).toBe(started.scheduleRoundId);

    const rows = await matchesOf(started.scheduleRoundId!);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.engine_version).toBe('1.0.0');
      expect(row.max_turns).toBe(123);
      expect(row.turn_timeout_ms).toBe(2345);
      expect(row.map_checksum).toBe(row.map_definition.checksum);
      expect(row.map_checksum).toBe(MAP_REGISTRY[0]!.checksum);
      // Same predicates as the worker's claimMatch snapshot guard (MATCH_EXECUTION_SNAPSHOT_INVALID).
      expect(row.max_turns).toBeGreaterThan(0);
      expect(row.max_turns).toBeLessThanOrEqual(DEFAULT_LIMITS.maxTurns);
      expect(row.turn_timeout_ms).toBeGreaterThan(0);
      expect(row.turn_timeout_ms).toBeLessThanOrEqual(DEFAULT_LIMITS.turnTimeoutMs);
    }
  });

  it('uses one map per series and varies maps across series', async () => {
    const stage = await seedStage('B', 16);
    const maps = Array.from({ length: 2 }, (_, index) => {
      const checksum = String(index + 1).repeat(64);
      return { mapId: `m${index}`, version: 1, checksum, definition: { ...DEFAULT_MAP, mapId: `m${index}`, checksum } };
    });
    const scheduled = await scheduleRound(database, {
      tournamentStage: stage, idempotencyKey: 'two-maps',
      matchRules: { engineVersion: '1.0.0', maxTurns: 100, turnTimeoutMs: 1000, maps },
    });
    scheduledRoundIds.push(scheduled.roundId);
    await quarantineFixtureMatches(scheduled.roundId);
    expect(scheduled.seriesIds).toHaveLength(8);
    const rows = await matchesOf(scheduled.roundId);
    const bySeries = new Map<string, Set<string>>();
    for (const row of rows) bySeries.set(row.series_id, (bySeries.get(row.series_id) ?? new Set()).add(row.map_checksum));
    for (const set of bySeries.values()) expect(set.size).toBe(1);
    expect(new Set(rows.map(({ map_checksum }) => map_checksum)).size).toBe(2);
    rows.forEach((row) => expect(row.map_checksum).toBe(row.map_definition.checksum));

    expect(await scheduleRound(database, {
      tournamentStage: stage, idempotencyKey: 'two-maps',
      matchRules: { engineVersion: '1.0.0', maxTurns: 100, turnTimeoutMs: 1000, maps },
    })).toMatchObject({ roundId: scheduled.roundId, replayed: true });
    await expect(scheduleRound(database, {
      tournamentStage: stage, idempotencyKey: 'two-maps',
      matchRules: { engineVersion: '1.0.0', maxTurns: 101, turnTimeoutMs: 1000, maps },
    })).rejects.toThrow('SCHEDULE_IDEMPOTENCY_CONFLICT');
  });

  it('rejects a rule set with an unknown map before storing it', async () => {
    const stage = `P3D25C_${suffix}`;
    await expect(createRuleSet(database, {
      tournamentStage: stage, rules: rules({ mapSet: [{ mapId: 'ghost', checksum: 'a'.repeat(64) }] }), reason: 'unknown map', actorAccountId: accountId,
    })).rejects.toMatchObject({ details: [{ path: 'mapSet[0].mapId', code: 'UNKNOWN_MAP' }] });
    await expect(createRuleSet(database, {
      tournamentStage: stage, rules: rules({ maxTurns: 1 }), reason: 'ok', actorAccountId: accountId,
    })).resolves.toMatchObject({ version: 1 });
  });
});
