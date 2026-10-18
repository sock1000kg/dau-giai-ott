import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '@ott/game-core';
import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { scheduleRound } from '../src/modules/scheduling/service.ts';
import { computeRulesSha256 } from '../src/modules/rounds/types.ts';

const integration = process.env.DATABASE_URL ? describe : describe.skip;
integration('P3-L02 immutable timing snapshot', () => {
  let db: Database;
  let adminDb: Database;
  const stage = `L02_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const accountId = randomUUID(), ruleSetId = randomUUID(), qualificationRoundId = randomUUID();
  const timeControl = { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000,
    perTurn: { mode: 'DYNAMIC' as const, baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 } };
  beforeAll(async () => {
    adminDb = createDatabase({ connectionString: process.env.DATABASE_URL! });
    await adminDb.query(`CREATE SCHEMA ${stage.toLowerCase()}`);
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', `-c search_path=${stage.toLowerCase()}`);
    db = createDatabase({ connectionString: url.toString() });
    await runMigrations(db);
    await db.query("INSERT INTO accounts(id,username,password_hash,role) VALUES($1,$2,'fixture','BTC_ADMIN')", [accountId, stage]);
    const rules = {
      schemaVersion: 'ott.round-rules.v1' as const, engineVersion: '1.0.0',
      mapSet: [{ mapId: DEFAULT_MAP.mapId, checksum: DEFAULT_MAP.checksum }], maxTurns: 200,
      faultPolicyVersion: 'P2_BASELINE_V1', timeControl,
      resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
      schedule: { submissionOpensAt: '2026-10-14T00:00:00Z', submissionDeadlineAt: '2026-10-15T00:00:00Z',
        graceEndsAt: '2026-10-15T01:00:00Z', runStartsAt: '2026-10-16T00:00:00Z', runMaxHours: 48, appealEndsAt: '2026-10-20T00:00:00Z' },
      testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE' as const] },
    };
    await db.query('INSERT INTO round_rule_sets(id,tournament_stage,version,rules,rules_sha256,created_by,reason) VALUES($1,$2,1,$3,$4,$5,\'fixture\')',
      [ruleSetId, stage, rules, computeRulesSha256(rules), accountId]);
    await db.query("INSERT INTO qualification_rounds(id,tournament_stage,round_number,status,rule_set_id) VALUES($1,$2,1,'SUBMISSION_CLOSED',$3)",
      [qualificationRoundId, stage, ruleSetId]);
    for (let n = 0; n < 2; n++) {
      const team = randomUUID();
      await db.query('INSERT INTO teams(id,name) VALUES($1,$2)', [team, `${stage}-${n}`]);
      const digest = `sha256:${String(n).repeat(64)}`;
      await db.query(`INSERT INTO submissions(id,team_id,tournament_stage,archive_sha256,oci_manifest_digest,oci_config_digest,entrypoint,object_key,status)
        VALUES($1,$2,$3,$4,$4,$4,'["bot"]',$5,'ACTIVE')`, [randomUUID(), team, stage, digest, `${stage}/${n}`]);
    }
  });
  afterAll(async () => {
    await db?.close();
    await adminDb?.query(`DROP SCHEMA IF EXISTS ${stage.toLowerCase()} CASCADE`);
    await adminDb?.close();
  });
  it('pins the locked rule set, creates private distinct seeds and keeps retry identity', async () => {
    const input = { tournamentStage: stage, idempotencyKey: 'snapshot', qualificationRoundId };
    const result = await scheduleRound(db, input);
    const rows = await db.query<{ id: string; protocol_v2: { timeControl: unknown; botSeeds: { X: string; O: string } }; rule_set_id: string }>(
      'SELECT id,protocol_v2,rule_set_id FROM matches WHERE id = ANY($1::uuid[]) ORDER BY id', [result.matchIds]);
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.rule_set_id).toBe(ruleSetId);
      expect(row.protocol_v2.timeControl).toEqual(timeControl);
      expect(row.protocol_v2.botSeeds.X).toMatch(/^[0-9a-f]{64}$/);
      expect(row.protocol_v2.botSeeds.X).not.toBe(row.protocol_v2.botSeeds.O);
      await expect(db.query("UPDATE matches SET protocol_v2 = NULL WHERE id = $1", [row.id])).rejects.toMatchObject({ code: 'P0001' });
    }
    expect(new Set(rows.rows.flatMap(({ protocol_v2 }) => Object.values(protocol_v2.botSeeds))).size).toBe(4);
    expect(await scheduleRound(db, input)).toEqual({ ...result, replayed: true });
    expect((await db.query('SELECT id,protocol_v2,rule_set_id FROM matches WHERE id = ANY($1::uuid[]) ORDER BY id', [result.matchIds])).rows).toEqual(rows.rows);
    const jobs = await db.query<{ payload: unknown }>('SELECT payload FROM match_outbox WHERE match_id = ANY($1::uuid[])', [result.matchIds]);
    expect(JSON.stringify(jobs.rows)).not.toContain('botSeeds');
  });
});
