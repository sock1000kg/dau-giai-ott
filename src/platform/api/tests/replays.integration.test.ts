import { createHash, randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { S3Client } from '@aws-sdk/client-s3';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import { CoreGameAdapter, ScriptedBot, runMatch, serializeEventLog } from '@ott/match-runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthApp } from '../src/app.ts';
import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import type { PasswordHasher } from '../src/modules/auth/types.ts';
import { createS3Storage, type ObjectStorage } from '../src/storage/s3.ts';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3AccessKey = process.env.S3_ACCESS_KEY_ID;
const s3SecretKey = process.env.S3_SECRET_ACCESS_KEY;
const integration = databaseUrl && redisUrl ? describe : describe.skip;

function memoryStorage(): ObjectStorage {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key, value) { objects.set(key, Uint8Array.from(value)); },
    async get(key) {
      const value = objects.get(key);
      if (value === undefined) throw new Error('Object not found');
      return Uint8Array.from(value);
    },
    async copy(source, destination) {
      const value = objects.get(source);
      if (value === undefined) throw new Error('Object not found');
      objects.set(destination, Uint8Array.from(value));
    },
    async remove(key) { objects.delete(key); },
  };
}

function cookieHeader(value: string | string[] | undefined): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (cookie === undefined) throw new Error('Expected an auth session cookie');
  return cookie.split(';', 1)[0]!;
}

integration('P2-T24 replay publication and public artifact API', () => {
  let database: Database;
  let adminDatabase: Database;
  let redis: RedisClientType;
  let objectStorage: ObjectStorage;
  let s3Client: S3Client;
  let app: ReturnType<typeof createAuthApp>;
  let btcCookie: string;
  let teamCookie: string;
  const suffix = randomUUID();
  const schemaName = `replays_api_${suffix.replaceAll('-', '')}`;
  const stageName = `REPLAY_API_${suffix.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
  const teamIds = [randomUUID(), randomUUID()];
  const accountIds = [randomUUID(), randomUUID(), randomUUID()];
  const submissionIds = [randomUUID(), randomUUID()];
  const seriesId = randomUUID();
  const matchIds = [randomUUID(), randomUUID()];
  const eventLogs = new Map<string, Buffer>();
  const objectKeys: string[] = [];
  const usernames = [`btc-${suffix}`, `team-${suffix}`];

  beforeAll(async () => {
    adminDatabase = createDatabase({ connectionString: databaseUrl! });
    await adminDatabase.query(`CREATE SCHEMA "${schemaName}"`);
    const isolatedUrl = new URL(databaseUrl!);
    isolatedUrl.searchParams.set('options', `-c search_path=${schemaName}`);
    database = createDatabase({ connectionString: isolatedUrl.toString() });
    redis = createClient({ url: redisUrl! });
    await redis.connect();
    if (s3Endpoint && s3Bucket && s3AccessKey && s3SecretKey) {
      s3Client = new S3Client({ endpoint: s3Endpoint, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false', credentials: { accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey } });
      objectStorage = createS3Storage({ client: s3Client, bucket: s3Bucket });
    } else {
      objectStorage = memoryStorage();
    }
    await runMigrations(database);

    await database.query('INSERT INTO teams (id,name) VALUES ($1,$2),($3,$4)', [teamIds[0], `${stageName}-X`, teamIds[1], `${stageName}-O`]);
    await database.query(
      "INSERT INTO accounts (id,username,password_hash,role) VALUES ($1,$2,'test-hash','BTC_ADMIN')",
      [accountIds[0], usernames[0]],
    );
    await database.query(
      "INSERT INTO accounts (id,username,password_hash,role,team_id) VALUES ($1,$2,'test-hash','TEAM_ACCOUNT',$3)",
      [accountIds[1], usernames[1], teamIds[0]],
    );
    for (const [index, submissionId] of submissionIds.entries()) {
      await database.query(
        "INSERT INTO submissions (id,team_id,tournament_stage,archive_sha256,oci_manifest_digest,oci_config_digest,object_key,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'VALID')",
        [submissionId, teamIds[index], stageName, `sha256:${String(index + 1).repeat(64)}`, `sha256:${String(index + 3).repeat(64)}`, `sha256:${String(index + 5).repeat(64)}`, `private/${submissionId}`],
      );
    }
    await database.query(
      "INSERT INTO series (id,tournament_stage,status,team_a_id,team_b_id) VALUES ($1,$2,'FINALIZED',$3,$4)",
      [seriesId, stageName, teamIds[0], teamIds[1]],
    );

    const game = new CoreGameAdapter();
    for (const [index, matchId] of matchIds.entries()) {
      const gameConfig = { gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 };
      const firstState = game.create(gameConfig);
      const firstAction = game.listLegalActions(firstState, 'X')[0];
      if (firstAction === undefined) throw new Error('Expected a legal X action for replay fixture');
      const report = await runMatch(
        { matchId, seed: `PRIVATE-SEED-${suffix}-${index}`, game: gameConfig, limits: { ...DEFAULT_LIMITS, maxTurns: 1 } },
        { game, bots: { X: new ScriptedBot({ replies: [{ kind: 'action', action: firstAction }] }), O: new ScriptedBot({ replies: [] }) } },
      );
      const bytes = Buffer.from(serializeEventLog(report.log), 'utf8');
      const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const objectKey = `match-results/${matchId}/event-log/${checksum}.json`;
      await objectStorage.put(objectKey, bytes);
      objectKeys.push(objectKey);
      eventLogs.set(matchId, bytes);
      await database.query(
        "INSERT INTO matches (id,series_id,x_submission_id,o_submission_id,status,game_number,seed) VALUES ($1,$2,$3,$4,'FINALIZED',$5,$6)",
        [matchId, seriesId, submissionIds[0], submissionIds[1], index + 1, `PRIVATE-SEED-${index}`],
      );
      await database.query(
        "INSERT INTO match_results (match_id,winner_side,reason,turn_count,final_state_hash,event_log_key,event_log_sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [matchId, report.result.winnerSide, report.result.reason, report.result.turnCount, report.result.finalStateHash, objectKey, checksum],
      );
    }

    const passwordHasher: PasswordHasher = { hash: async () => 'test-hash', verify: async () => true };
    app = createAuthApp({ database, redis, passwordHasher, secureCookies: false, storage: objectStorage });
    await app.ready();
    btcCookie = cookieHeader((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: usernames[0], password: 'test-password' } })).headers['set-cookie']);
    teamCookie = cookieHeader((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: usernames[1], password: 'test-password' } })).headers['set-cookie']);
  });

  afterAll(async () => {
    if (app !== undefined) {
      if (btcCookie !== undefined) await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: btcCookie } });
      if (teamCookie !== undefined) await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: teamCookie } });
      await app.close();
    }
    if (objectStorage !== undefined) await Promise.all(objectKeys.map((key) => objectStorage.remove(key).catch(() => undefined)));
    s3Client?.destroy();
    if (redis !== undefined) {
      await Promise.all(accountIds.map((accountId) => {
        const digest = createHash('sha256').update(accountId).digest('base64url');
        return redis.del(`auth:account:${digest}`);
      }));
      await redis.quit();
    }
    if (database !== undefined) await database.close();
    if (adminDatabase !== undefined) {
      await adminDatabase.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminDatabase.close();
    }
  });

  it('restricts transitions to BTC, hides private matches, verifies storage bytes, and returns a seed-free checksummed replay', async () => {
    const privateMatchId = matchIds[0]!;
    const publishMatchId = matchIds[1]!;
    const privateRead = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${privateMatchId}` });
    expect(privateRead.statusCode).toBe(404);
    expect(privateRead.json()).toEqual({ error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' } });

    const anonymousTransition = await app.inject({
      method: 'POST', url: `/api/v1/admin/replays/${publishMatchId}/stage`,
      headers: { 'idempotency-key': `anon-${suffix}` }, payload: { reason: 'reviewed' },
    });
    expect(anonymousTransition.statusCode).toBe(401);
    const teamTransition = await app.inject({
      method: 'POST', url: `/api/v1/admin/replays/${publishMatchId}/stage`,
      headers: { cookie: teamCookie, 'idempotency-key': `team-${suffix}` }, payload: { reason: 'reviewed' },
    });
    expect(teamTransition.statusCode).toBe(403);

    const catalog = await app.inject({ method: 'GET', url: '/api/v1/admin/replays/catalog', headers: { cookie: btcCookie } });
    expect(catalog.statusCode).toBe(200);
    const catalogItem = catalog.json<{ data: { items: readonly Record<string, unknown>[] } }>().data.items.find((item) => item.matchId === publishMatchId);
    expect(catalogItem).toMatchObject({ matchId: publishMatchId, state: 'PRIVATE' });
    expect(catalogItem).not.toHaveProperty('eventLogKey');
    expect(catalog.body).not.toContain('PRIVATE-SEED');

    const stageKey = `stage-${suffix}`;
    const stageRequest = () => app.inject({
      method: 'POST', url: `/api/v1/admin/replays/${publishMatchId}/stage`,
      headers: { cookie: btcCookie, 'idempotency-key': stageKey }, payload: { reason: 'Reviewed for audience' },
    });
    const [staged, stagedRetry] = await Promise.all([stageRequest(), stageRequest()]);
    expect(staged.statusCode).toBe(200);
    expect(stagedRetry.json()).toEqual(staged.json());
    expect(staged.json().data).toMatchObject({ matchId: publishMatchId, state: 'STAGED' });

    const identity = await database.query<{ readonly event_log_key: string }>('SELECT event_log_key FROM match_results WHERE match_id=$1', [publishMatchId]);
    const tampered = Buffer.from(eventLogs.get(publishMatchId)!);
    tampered[0] = tampered[0]! ^ 1;
    await objectStorage.put(identity.rows[0]!.event_log_key, tampered);
    const rejectedTamper = await app.inject({
      method: 'POST', url: `/api/v1/admin/replays/${publishMatchId}/publish`,
      headers: { cookie: btcCookie, 'idempotency-key': `publish-tampered-${suffix}` }, payload: { reason: 'Approve' },
    });
    expect(rejectedTamper.statusCode).toBe(409);
    expect(rejectedTamper.json()).toEqual({ error: { code: 'REPLAY_INTEGRITY_FAILED', message: 'Replay integrity verification failed' } });
    expect(rejectedTamper.body).not.toContain('entries');

    await objectStorage.put(identity.rows[0]!.event_log_key, eventLogs.get(publishMatchId)!);
    const publishKey = `publish-${suffix}`;
    const publishRequest = () => app.inject({
      method: 'POST', url: `/api/v1/admin/replays/${publishMatchId}/publish`,
      headers: { cookie: btcCookie, 'idempotency-key': publishKey }, payload: { reason: 'Approved for audience' },
    });
    const [published, publishedRetry] = await Promise.all([publishRequest(), publishRequest()]);
    expect(published.statusCode).toBe(200);
    expect(publishedRetry.json()).toEqual(published.json());
    expect(published.json().data).toMatchObject({ matchId: publishMatchId, state: 'PUBLISHED' });

    const publicReplay = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${publishMatchId}` });
    expect(publicReplay.statusCode).toBe(200);
    expect(publicReplay.headers['content-type']).toContain('application/vnd.ott.spectator-replay+json');
    const checksum = `sha256:${createHash('sha256').update(publicReplay.rawPayload).digest('hex')}`;
    expect(publicReplay.headers['x-replay-sha256']).toBe(checksum);
    const publicData = JSON.parse(publicReplay.body) as Record<string, unknown>;
    expect(publicData).toMatchObject({ schema: 'ott.spectator-replay', schemaVersion: 1, matchId: publishMatchId });
    expect(JSON.stringify(publicData)).not.toContain('PRIVATE-SEED');
    expect(JSON.stringify(publicData)).not.toContain('eventLogKey');
    expect(publicData).toHaveProperty('entries');
    expect(publicData).toHaveProperty('result.finalStateHash');

    await objectStorage.put(identity.rows[0]!.event_log_key, tampered);
    const rejectedPublicTamper = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${publishMatchId}` });
    expect(rejectedPublicTamper.statusCode).toBe(409);
    expect(rejectedPublicTamper.json()).toEqual({ error: { code: 'REPLAY_INTEGRITY_FAILED', message: 'Replay integrity verification failed' } });
    expect(rejectedPublicTamper.body).not.toContain('entries');
  });
});
