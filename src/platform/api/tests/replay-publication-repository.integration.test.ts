import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import {
  listReplayCatalog,
  publishReplay,
  stageReplay,
} from '../src/modules/replays/repository.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('P2-T23 replay publication repository', () => {
  let database: Database;
  let adminDatabase: Database;
  const suffix = randomUUID();
  const schemaName = `replay_test_${suffix.replaceAll('-', '')}`;
  const btcId = randomUUID();
  const teamId = randomUUID();
  const teamAccountId = randomUUID();
  const submissionIds = [randomUUID(), randomUUID()];
  const seriesId = randomUUID();
  const finalizedMatchId = randomUUID();
  const runningMatchId = randomUUID();
  const checksum = `sha256:${'a'.repeat(64)}`;
  const stageCommand = { matchId: finalizedMatchId, actorAccountId: btcId, idempotencyKey: `stage-${suffix}`, reason: 'Finale reviewed', verifiedEventLogSha256: checksum };
  const publishCommand = { matchId: finalizedMatchId, actorAccountId: btcId, idempotencyKey: `publish-${suffix}`, reason: 'Approved for audience', verifiedEventLogSha256: checksum };

  beforeAll(async () => {
    adminDatabase = createDatabase({ connectionString: databaseUrl! });
    await adminDatabase.query(`CREATE SCHEMA "${schemaName}"`);
    const isolatedUrl = new URL(databaseUrl!);
    isolatedUrl.searchParams.set('options', `-c search_path=${schemaName}`);
    database = createDatabase({ connectionString: isolatedUrl.toString() });
    await runMigrations(database);
    await database.query('INSERT INTO teams (id,name) VALUES ($1,$2)', [teamId, `Replay-${suffix}`]);
    await database.query(
      "INSERT INTO accounts (id,username,password_hash,role) VALUES ($1,$2,'test-hash','BTC_ADMIN')",
      [btcId, `replay-btc-${suffix}`],
    );
    await database.query(
      "INSERT INTO accounts (id,username,password_hash,role,team_id) VALUES ($1,$2,'test-hash','TEAM_ACCOUNT',$3)",
      [teamAccountId, `replay-team-${suffix}`, teamId],
    );
    for (const [index, submissionId] of submissionIds.entries()) {
      await database.query(
        "INSERT INTO submissions (id,team_id,tournament_stage,archive_sha256,oci_manifest_digest,oci_config_digest,object_key,status) VALUES ($1,$2,'REPLAY_TEST',$3,$4,$5,$6,'VALID')",
        [submissionId, teamId, `sha256:${String(index + 1).repeat(64)}`, `sha256:${String(index + 3).repeat(64)}`, `sha256:${String(index + 5).repeat(64)}`, `private/${submissionId}`],
      );
    }
    await database.query("INSERT INTO series (id,tournament_stage,status) VALUES ($1,'REPLAY_TEST','FINALIZED')", [seriesId]);
    await database.query(
      "INSERT INTO matches (id,series_id,x_submission_id,o_submission_id,status,game_number,seed) VALUES ($1,$2,$3,$4,'FINALIZED',1,'private-seed'),($5,$2,$3,$4,'RUNNING',2,'private-seed')",
      [finalizedMatchId, seriesId, submissionIds[0], submissionIds[1], runningMatchId],
    );
    await database.query(
      "INSERT INTO match_results (match_id,winner_side,reason,turn_count,final_state_hash,event_log_key,event_log_sha256) VALUES ($1,'X','TURN_LIMIT',4,$2,$3,$4)",
      [finalizedMatchId, 'b'.repeat(64), `match-results/${finalizedMatchId}/event-log/${checksum}.json`, checksum],
    );
  });

  afterAll(async () => {
    if (database !== undefined) await database.close();
    if (adminDatabase !== undefined) {
      await adminDatabase.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminDatabase.close();
    }
  });

  it('lists only eligible finalized matches without private object key or seed', async () => {
    const catalog = await listReplayCatalog(database, { page: 1, pageSize: 10 });
    const entry = catalog.items.find((item) => item.matchId === finalizedMatchId);
    expect(entry).toMatchObject({ matchId: finalizedMatchId, state: 'PRIVATE', eventLogSha256: checksum });
    expect(entry).not.toHaveProperty('eventLogKey');
    expect(entry).not.toHaveProperty('seed');
    expect(catalog.items.some((item) => item.matchId === runningMatchId)).toBe(false);
    const emptyPage = await listReplayCatalog(database, { page: 2, pageSize: 1 });
    expect(emptyPage.items).toEqual([]);
    expect(emptyPage.total).toBe(1);
  });

  it('stages once, records a minimal audit trail, and returns the same result on retry', async () => {
    const [staged, retried] = await Promise.all([
      stageReplay(database, stageCommand),
      stageReplay(database, stageCommand),
    ]);
    expect(staged).toMatchObject({ matchId: finalizedMatchId, state: 'STAGED', eventLogSha256: checksum });
    expect(retried).toEqual(staged);
    const counts = await database.query<{ readonly publications: string; readonly events: string }>(
      'SELECT (SELECT count(*)::text FROM replay_publications WHERE match_id=$1) AS publications, (SELECT count(*)::text FROM replay_publication_events WHERE match_id=$1) AS events',
      [finalizedMatchId],
    );
    expect(counts.rows[0]).toEqual({ publications: '1', events: '1' });
    const audit = await database.query<{ readonly action: string; readonly actor_account_id: string; readonly reason: string; readonly created_at: Date }>(
      'SELECT action,actor_account_id,reason,created_at FROM replay_publication_events WHERE match_id=$1', [finalizedMatchId],
    );
    expect(audit.rows[0]).toMatchObject({ action: 'STAGE', actor_account_id: btcId, reason: stageCommand.reason });
    expect(audit.rows[0]?.created_at).toBeInstanceOf(Date);
    expect(JSON.stringify(audit.rows)).not.toContain('password');
  });

  it('publishes only from staged with the same verified checksum and is idempotent', async () => {
    expect(await publishReplay(database, publishCommand)).toMatchObject({ state: 'PUBLISHED' });
    expect(await publishReplay(database, publishCommand)).toMatchObject({ state: 'PUBLISHED' });
    await expect(publishReplay(database, { ...publishCommand, idempotencyKey: `publish-bad-${suffix}`, verifiedEventLogSha256: `sha256:${'c'.repeat(64)}` })).rejects.toThrow('REPLAY_CHECKSUM_MISMATCH');
  });

  it('rejects non-terminal matches, non-BTC actors, invalid checksums, and idempotency-key reuse', async () => {
    await expect(stageReplay(database, { ...stageCommand, matchId: runningMatchId, idempotencyKey: `running-${suffix}` })).rejects.toThrow('REPLAY_NOT_ELIGIBLE');
    await expect(stageReplay(database, { ...stageCommand, actorAccountId: teamAccountId, idempotencyKey: `team-${suffix}` })).rejects.toThrow('BTC_ADMIN_REQUIRED');
    await expect(stageReplay(database, { ...stageCommand, verifiedEventLogSha256: `sha256:${'d'.repeat(64)}`, idempotencyKey: `checksum-${suffix}` })).rejects.toThrow('REPLAY_CHECKSUM_MISMATCH');
    await expect(stageReplay(database, { ...stageCommand, reason: 'Different intent' })).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
    await expect(stageReplay(database, { ...stageCommand, idempotencyKey: `too-long-${'x'.repeat(210)}` })).rejects.toThrow('INVALID_IDEMPOTENCY_KEY');
  });

  it('enforces immutable state, replay identity, and audit history in PostgreSQL', async () => {
    await stageReplay(database, stageCommand);
    await expect(database.query("UPDATE replay_publications SET state='PRIVATE' WHERE match_id=$1", [finalizedMatchId])).rejects.toThrow(/invalid replay publication transition/);
    await expect(database.query("UPDATE replay_publications SET event_log_sha256=$2 WHERE match_id=$1", [finalizedMatchId, `sha256:${'e'.repeat(64)}`])).rejects.toThrow(/replay identity is immutable/);
    await expect(database.query('DELETE FROM replay_publication_events WHERE match_id=$1', [finalizedMatchId])).rejects.toThrow(/replay publication audit is immutable/);
  });
});
