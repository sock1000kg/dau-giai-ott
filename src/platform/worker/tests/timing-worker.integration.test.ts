import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '@ott/game-core';
import type { InitMessage, InitMessageV2 } from '@ott/bot-protocol';
import { BotProcess, CoreGameAdapter, parseAnyEventLog, verifyReplay } from '@ott/match-runner';
import { compileProtocolValidator } from '@ott/bot-protocol';
import { readFileSync } from 'node:fs';
import { createDatabase, runMigrations, scheduleRound, computeRulesSha256, type Database, type ObjectStorage } from '@ott/platform-api';
import { runMatchJob } from '../src/run-match-job.ts';
import { claimMatch } from '../src/result-repository.ts';
import type { MatchJobV1 } from '@ott/job-contract';

const integration = process.env.DATABASE_URL ? describe : describe.skip;
integration('P3-L02 worker timing snapshot to real bot process and verified replay', () => {
  let database: Database;
  let adminDatabase: Database;
  const stage = `L02W_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const objects = new Map<string, Uint8Array>();
  const storage: ObjectStorage = {
    async get(key) { const bytes = objects.get(key); if (!bytes) throw new Error('OBJECT_NOT_FOUND'); return bytes; },
    async put(key, bytes) { objects.set(key, bytes); }, async remove(key) { objects.delete(key); },
    async copy(from, to) { objects.set(to, await this.get(from)); },
  };
  const inits: (InitMessage | InitMessageV2)[] = [];
  let jobs: MatchJobV1[];
  beforeAll(async () => {
    adminDatabase = createDatabase({ connectionString: process.env.DATABASE_URL! });
    await adminDatabase.query(`CREATE SCHEMA ${stage.toLowerCase()}`);
    const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', `-c search_path=${stage.toLowerCase()}`);
    database = createDatabase({ connectionString: url.toString() }); await runMigrations(database);
    const admin = randomUUID(), rule = randomUUID(), round = randomUUID();
    await database.query("INSERT INTO accounts(id,username,password_hash,role) VALUES($1,$2,'fixture','BTC_ADMIN')", [admin, stage]);
    const rules = { schemaVersion: 'ott.round-rules.v1' as const, engineVersion: '1.0.0', maxTurns: 12,
      mapSet: [{ mapId: DEFAULT_MAP.mapId, checksum: DEFAULT_MAP.checksum }], faultPolicyVersion: 'P2_BASELINE_V1',
      timeControl: { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000,
        perTurn: { mode: 'DYNAMIC' as const, baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 } },
      resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
      schedule: { submissionOpensAt: '2026-10-14T00:00:00Z', submissionDeadlineAt: '2026-10-15T00:00:00Z', graceEndsAt: '2026-10-15T01:00:00Z',
        runStartsAt: '2026-10-16T00:00:00Z', runMaxHours: 48, appealEndsAt: '2026-10-20T00:00:00Z' },
      testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE' as const] } };
    await database.query("INSERT INTO round_rule_sets(id,tournament_stage,version,rules,rules_sha256,created_by,reason) VALUES($1,$2,1,$3,$4,$5,'fixture')",
      [rule, stage, rules, computeRulesSha256(rules), admin]);
    await database.query("INSERT INTO qualification_rounds(id,tournament_stage,round_number,status,rule_set_id) VALUES($1,$2,1,'SUBMISSION_CLOSED',$3)", [round, stage, rule]);
    for (let n = 0; n < 2; n++) {
      const team = randomUUID(), submission = randomUUID(), key = `${stage}/${n}`;
      const archive = Buffer.from(`worker-fixture-${n}`); objects.set(key, archive);
      const digest = 'sha256:' + createHash('sha256').update(archive).digest('hex');
      await database.query('INSERT INTO teams(id,name) VALUES($1,$2)', [team, key]);
      await database.query(`INSERT INTO submissions(id,team_id,tournament_stage,archive_sha256,oci_manifest_digest,oci_config_digest,entrypoint,object_key,status)
        VALUES($1,$2,$3,$4,$4,$4,'["bot"]',$5,'ACTIVE')`, [submission, team, stage, digest, key]);
    }
    const scheduled = await scheduleRound(database, { tournamentStage: stage, idempotencyKey: stage, qualificationRoundId: round });
    jobs = (await database.query<{ payload: MatchJobV1 }>('SELECT payload FROM match_outbox WHERE match_id = ANY($1::uuid[]) ORDER BY match_id', [scheduled.matchIds])).rows.map((row) => row.payload);
  });
  afterAll(async () => {
    await database?.close();
    await adminDatabase?.query(`DROP SCHEMA IF EXISTS ${stage.toLowerCase()} CASCADE`);
    await adminDatabase?.close();
  });
  it('pins v2 in both processes, persists timing, rejects timing mutation and finalizes idempotently', async () => {
    const result = await runMatchJob({ job: jobs[0]!, database, storage, createBotPort: () => {
      const validator = compileProtocolValidator(JSON.parse(readFileSync(new URL('../../../../docs/contracts/bot-protocol-v2.schema.json', import.meta.url), 'utf8')));
      const bot = new BotProcess({ executable: process.execPath, args: ['--input-type=module', '-e', `
        import readline from 'node:readline';
        readline.createInterface({input:process.stdin}).on('line', l => {
          const m=JSON.parse(l); if(m.type==='STATE_UPDATE' && m.legalActions.length) setTimeout(()=>process.stdout.write(JSON.stringify({
            type:'ACTION',protocolVersion:m.protocolVersion,matchId:m.matchId,turnId:m.turnId,action:m.legalActions[0]})+'\\n'),5);
          if(m.type==='MATCH_RESULT') process.exit(0);
        });`], validator, maxMessageBytes: 65536, stopGraceMs: 30 });
      const start = bot.start.bind(bot); bot.start = async (init) => { inits.push(init); return start(init); }; return bot;
    } });
    expect(inits).toHaveLength(2);
    expect(inits.every((init) => init.protocolVersion === 2 && !('seed' in init))).toBe(true);
    expect((inits[0] as InitMessageV2).botSeed).not.toBe((inits[1] as InitMessageV2).botSeed);
    const log = parseAnyEventLog(Buffer.from(await storage.get(result.eventLogKey!)).toString('utf8'));
    expect(log.header.formatVersion).toBe(2);
    expect(log.header).toMatchObject({ ruleSet: { version: 1, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(verifyReplay(log, new CoreGameAdapter()).ok).toBe(true);
    const historical = structuredClone(log);
    if (historical.header.formatVersion === 2) delete (historical.header as { ruleSet?: unknown }).ruleSet;
    expect(verifyReplay(parseAnyEventLog(JSON.stringify(historical)), new CoreGameAdapter()).ok).toBe(true);
    for (const ruleSet of [{ id: randomUUID(), version: 0, sha256: 'a'.repeat(64) },
      { id: randomUUID(), version: 1, sha256: 'tampered' }]) {
      expect(() => parseAnyEventLog(JSON.stringify({ ...log, header: { ...log.header, ruleSet } }))).toThrow();
    }
    if ('timing' in log) {
      expect(log.timing.length).toBeGreaterThan(0);
      const changed = structuredClone(log); (changed.timing[0] as { chargedMs: number }).chargedMs += 1;
      expect(verifyReplay(changed, new CoreGameAdapter())).toMatchObject({ ok: false, code: 'TIMING_MISMATCH' });
    }
    expect(await runMatchJob({ job: jobs[0]!, database, storage })).toMatchObject({ alreadyFinalized: true });
    expect((await database.query('SELECT match_id FROM match_results WHERE match_id=$1', [jobs[0]!.matchId])).rowCount).toBe(1);
  });
  it('rejects an invalid stored snapshot before acquiring a lease', async () => {
    // Database mutation triggers separately guard real rows. This adapter fault injects corrupt read data.
    const corrupt = { ...database, query: database.query.bind(database), close: database.close.bind(database),
      transaction: async <T>(work: (tx: Database) => Promise<T>) => database.transaction(async (tx) => work({ ...tx,
        close: tx.close.bind(tx), transaction: tx.transaction.bind(tx), query: async (sql, values) => {
          const result = await tx.query(sql, values);
          if (sql.includes('SELECT m.id, m.status')) return { ...result, rows: result.rows.map((row) => ({ ...row, protocol_v2: { timeControl: {}, botSeeds: {} } })) } as typeof result;
          return result;
        },
      } as Database)),
    } as Database;
    await expect(claimMatch(corrupt, jobs[1]!)).rejects.toThrow('MATCH_PROTOCOL_SNAPSHOT_INVALID');
    expect((await database.query('SELECT id FROM match_attempts WHERE match_id=$1', [jobs[1]!.matchId])).rowCount).toBe(0);
  });
});
