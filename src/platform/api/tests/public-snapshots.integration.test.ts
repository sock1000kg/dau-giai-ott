import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { computeRulesSha256, type RoundRuleSetRulesV1 } from '../src/modules/rounds/types.ts';
import { scheduleRound } from '../src/modules/scheduling/service.ts';
import { collectQualificationSnapshot, publishQualificationSnapshot, type PublicEditorial } from '../src/modules/public-snapshots/source.ts';

const integration = process.env.DATABASE_URL ? describe : describe.skip;
integration('public snapshot live PostgreSQL producer', () => {
  let database: Database, admin: Database, directory: string;
  let matches: readonly string[];
  const schema = `public_l05_${randomUUID().replaceAll('-', '')}`;
  const editorial: PublicEditorial = { announcements: [], faq: [], status: { message: 'Running', incidentEta: null }, changelog: 'Initial rules', minimumSeries: 5 };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    admin = createDatabase({ connectionString: url.toString() });
    await admin.query(`CREATE SCHEMA ${schema}`);
    url.searchParams.set('options', `-c search_path=${schema}`);
    database = createDatabase({ connectionString: url.toString() });
    await runMigrations(database);
    directory = await mkdtemp(join(tmpdir(), 'ott-l05-live-'));
    const account = randomUUID(), rulesId = randomUUID();
    await database.query("INSERT INTO accounts (id,username,password_hash,role) VALUES ($1,'snapshot-admin','hash','BTC_ADMIN')", [account]);
    const rules: RoundRuleSetRulesV1 = {
      schemaVersion: 'ott.round-rules.v1', engineVersion: '1.0.0', mapSet: [{ mapId: 'map-v1', checksum: 'a'.repeat(64) }], maxTurns: 200, faultPolicyVersion: 'P2_BASELINE_V1',
      timeControl: { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000, perTurn: { mode: 'FIXED', fixedMs: 1000 } },
      resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
      schedule: { submissionOpensAt: '2026-10-14T00:00:00Z', submissionDeadlineAt: '2026-10-15T00:00:00Z', graceEndsAt: '2026-10-15T12:00:00Z', runStartsAt: '2026-10-16T00:00:00Z', runMaxHours: 48, appealEndsAt: '2026-10-19T00:00:00Z' },
      testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE'] },
    };
    await database.query("INSERT INTO round_rule_sets(id,tournament_stage,version,rules,rules_sha256,created_by,reason) VALUES ($1,'QUALIFICATION',1,$2,$3,$4,'fixture')", [rulesId, JSON.stringify(rules), computeRulesSha256(rules), account]);
    for (let i = 0; i < 2; i++) {
      const team = randomUUID(), submission = randomUUID(), digest = `sha256:${String(i + 1).repeat(64)}`;
      await database.query('INSERT INTO teams(id,name) VALUES ($1,$2)', [team, `Team ${i}`]);
      await database.query("INSERT INTO submissions(id,team_id,archive_sha256,oci_manifest_digest,oci_config_digest,object_key,status) VALUES ($1,$2,$3,$3,$3,$4,'ACTIVE')", [submission, team, digest, `secret/${submission}`]);
    }
    const scheduled = await scheduleRound(database, { tournamentStage: 'QUALIFICATION', idempotencyKey: randomUUID() });
    matches = scheduled.matchIds;
    await database.query("INSERT INTO qualification_rounds(id,tournament_stage,round_number,status,rule_set_id,schedule_round_id) VALUES ($1,'QUALIFICATION',1,'RUNNING',$2,$3)", [randomUUID(), rulesId, scheduled.roundId]);
    await database.query("UPDATE matches SET status = 'FINALIZED' WHERE id = $1", [matches[0]]);
    await database.query("INSERT INTO match_results(match_id,winner_side,reason,turn_count,final_state_hash) VALUES ($1,'X','REACHED_GOAL',1,$2)", [matches[0], 'b'.repeat(64)]);
  });
  afterAll(async () => {
    if (database) await database.close();
    if (admin) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.close(); }
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  it('collects locked rules, official ranks/results and only the supplied execution queue order', async () => {
    const snapshot = await collectQualificationSnapshot(database, editorial, [...matches].reverse());
    expect(snapshot.queue).toEqual([{ position: 1, teams: expect.any(String), etaSeconds: null }]);
    expect(snapshot.results).toHaveLength(1);
    expect(snapshot.results[0]).toMatchObject({ score: '1–0', replayPublished: false });
    expect(snapshot.leaderboard).toHaveLength(2);
    expect(snapshot.leaderboard.every((row) => !row.eligible)).toBe(true);
    expect(snapshot.rules.version).toMatch(/sha256:/);
    expect(JSON.stringify(snapshot)).not.toMatch(/secret\/|schedule_seed|object_key|archive_sha256/);
  });
  it('publishes from live data and keeps that pointer on a producer failure', async () => {
    const pointer = await publishQualificationSnapshot(database, directory, editorial, matches);
    await expect(publishQualificationSnapshot(database, directory, { ...editorial, minimumSeries: 0 }, matches)).rejects.toThrow();
    expect(JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'))).toEqual(pointer);
  });
});
