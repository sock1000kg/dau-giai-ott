import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyRoundRatings,
  bootstrapBtcAdmin,
  createAuthApp,
  createDatabase,
  createPasswordHasher,
  createS3Storage,
  dispatchScheduledMatches,
  MatchQueue,
  runMigrations,
  scheduleRound,
  settleSeries,
  type Database,
  type ObjectStorage,
} from '@ott/platform-api';
import { createMatchWorker, preflightSubmission, runMatchJob } from '@ott/platform-worker';
import { createReplayTimeline } from '../../src/platform/web/src/features/spectator/replay-state.ts';
import { verifyReplayResponse } from '../../src/platform/web/src/features/spectator/verify-replay.ts';
import { assertQualificationPrerequisites } from './qualification-fixtures.ts';

interface CorpusFixture {
  readonly id: string;
  readonly archive: string;
  readonly archiveSha256: string;
  readonly ociManifestDigest: string;
  readonly ociConfigDigest: string;
  readonly entrypoint: readonly string[];
}
interface ProvisionedTeam {
  readonly id: string;
  readonly credential: { readonly username: string; readonly password: string };
}
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const requiredEnvironment = [databaseUrl, redisUrl, s3Endpoint, s3Bucket, s3AccessKeyId, s3SecretAccessKey];
const integration = requiredEnvironment.every((value) => value !== undefined && value.length > 0) ? describe : describe.skip;
const namespace = process.env.OTT_E2E_NAMESPACE;
if (namespace !== undefined && !/^[a-f0-9]{32}$/.test(namespace)) throw new Error('QUALIFICATION_NAMESPACE_INVALID');
const schemaName = `qualification_${namespace ?? randomUUID().replaceAll('-', '')}`;
const stage = 'QUALIFICATION';
const passwordHasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });

function sessionCookie(response: { readonly headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') throw new Error('QUALIFICATION_SESSION_COOKIE_MISSING');
  return value.split(';', 1)[0]!;
}

function fixtureById(fixtures: readonly CorpusFixture[], id: string): CorpusFixture {
  const fixture = fixtures.find((item) => item.id === id);
  if (fixture === undefined) throw new Error(`QUALIFICATION_FIXTURE_MISSING:${id}`);
  return fixture;
}

function replayResponse(response: {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Record<string, unknown>;
}): Response {
  return new Response(Buffer.from(response.body), {
    status: response.statusCode,
    headers: {
      'content-type': String(response.headers['content-type'] ?? ''),
      'x-replay-sha256': String(response.headers['x-replay-sha256'] ?? ''),
    },
  });
}

integration('P2-T29 qualification full flow', () => {
  let database: Database | undefined;
  let adminDatabase: Database | undefined;
  let redis: RedisClientType | undefined;
  let s3Client: S3Client | undefined;
  let app: ReturnType<typeof createAuthApp> | undefined;
  let matchQueue: MatchQueue | undefined;
  let worker: ReturnType<typeof createMatchWorker> | undefined;
  let inspector: Queue | undefined;
  let schemaCreated = false;
  let btcCookie: string | undefined;
  const teamCookies: string[] = [];
  const uploadedSubmissionIds: string[] = [];
  const createdMatchIds: string[] = [];
  const queueName = `ott-qualification-${namespace ?? randomUUID().replaceAll('-', '')}`;
  const deadLetterQueueName = `${queueName}-dead`;

  beforeAll(async () => {
    if (databaseUrl === undefined || redisUrl === undefined || s3Endpoint === undefined || s3Bucket === undefined
      || s3AccessKeyId === undefined || s3SecretAccessKey === undefined) throw new Error('QUALIFICATION_ENV_MISSING');
    adminDatabase = createDatabase({ connectionString: databaseUrl });
    await adminDatabase.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    const scopedUrl = new URL(databaseUrl);
    scopedUrl.searchParams.set('options', `-c search_path=${schemaName}`);
    database = createDatabase({ connectionString: scopedUrl.toString() });
    await runMigrations(database);

    redis = createClient({ url: redisUrl });
    await redis.connect();
    s3Client = new S3Client({ endpoint: s3Endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: s3AccessKeyId, secretAccessKey: s3SecretAccessKey } });
    const storage = createS3Storage({ client: s3Client, bucket: s3Bucket });
    const btcUsername = `qualification-btc-${namespace ?? randomUUID().replaceAll('-', '')}`;
    const btcPassword = randomUUID() + randomUUID();
    await bootstrapBtcAdmin({ database, passwordHasher, environment: { OTT_BOOTSTRAP_BTC_USERNAME: btcUsername, OTT_BOOTSTRAP_BTC_PASSWORD: btcPassword } });
    app = createAuthApp({ database, redis, passwordHasher, secureCookies: false, storage });
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: btcUsername, password: btcPassword } });
    if (login.statusCode !== 200) throw new Error('QUALIFICATION_BTC_LOGIN_FAILED');
    btcCookie = sessionCookie(login);
  }, 60_000);

  afterAll(async () => {
    if (worker !== undefined) await worker.close();
    if (matchQueue !== undefined) await matchQueue.close();
    if (inspector !== undefined) {
      await inspector.obliterate({ force: true }).catch(() => undefined);
      await inspector.close();
    }
    if (redisUrl !== undefined) {
      const deadLetterInspector = new Queue(deadLetterQueueName, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
      await deadLetterInspector.obliterate({ force: true }).catch(() => undefined);
      await deadLetterInspector.close();
    }
    if (app !== undefined) {
      if (btcCookie !== undefined) await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: btcCookie } });
      for (const cookie of teamCookies) await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
      await app.close();
    }
    if (database !== undefined && uploadedSubmissionIds.length > 0) {
      const objects = await database.query<{ readonly object_key: string }>(
        'SELECT object_key FROM submissions WHERE id = ANY($1::uuid[])', [uploadedSubmissionIds],
      ).catch(() => ({ rows: [] as { readonly object_key: string }[] }));
      const eventLogs = createdMatchIds.length === 0 ? { rows: [] as { readonly event_log_key: string }[] }
        : await database.query<{ readonly event_log_key: string }>(
          'SELECT event_log_key FROM match_results WHERE match_id = ANY($1::uuid[]) AND event_log_key IS NOT NULL', [createdMatchIds],
        ).catch(() => ({ rows: [] as { readonly event_log_key: string }[] }));
      if (s3Client !== undefined && s3Bucket !== undefined) {
        const storage = createS3Storage({ client: s3Client, bucket: s3Bucket });
        await Promise.all([
          ...objects.rows.map(({ object_key }) => storage.remove(object_key).catch(() => undefined)),
          ...eventLogs.rows.map(({ event_log_key }) => storage.remove(event_log_key).catch(() => undefined)),
        ]);
      }
    }
    s3Client?.destroy();
    if (redis !== undefined) await redis.quit();
    await database?.close();
    if (schemaCreated && adminDatabase !== undefined) await adminDatabase.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await adminDatabase?.close();
  }, 60_000);

  it('provisions teams, preflights OCI canaries, runs a replayable round and deduplicates retries', async () => {
    if (database === undefined || app === undefined || btcCookie === undefined || s3Client === undefined
      || s3Bucket === undefined || redisUrl === undefined || s3Endpoint === undefined) throw new Error('QUALIFICATION_SETUP_INCOMPLETE');
    const prerequisites = await assertQualificationPrerequisites(resolve('.'));
    const fixtures = prerequisites.fixtures as readonly CorpusFixture[];
    const canaryFixtures = [fixtureById(fixtures, 'first-legal-python'), fixtureById(fixtures, 'capture-first-python')];
    const storage: ObjectStorage = createS3Storage({ client: s3Client, bucket: s3Bucket });
    for (const [index, fixture] of canaryFixtures.entries()) {
      const created = await app.inject({
        method: 'POST', url: '/api/v1/admin/teams', headers: { cookie: btcCookie },
        payload: { name: `Qualification ${namespace} ${index === 0 ? 'X' : 'O'}` },
      });
      expect(created.statusCode).toBe(201);
      const team = created.json<{ data: ProvisionedTeam }>().data;
      const login = await app.inject({
        method: 'POST', url: '/api/v1/auth/login', payload: team.credential,
      });
      expect(login.statusCode).toBe(200);
      const cookie = sessionCookie(login);
      teamCookies.push(cookie);

      const archive = await readFile(join(resolve('.'), 'src/bots/sandbox-corpus/artifacts', fixture.archive));
      const uploaded = await app.inject({
        method: 'POST', url: '/api/v1/submissions',
        headers: { cookie, 'content-type': 'application/octet-stream' }, payload: archive,
      });
      expect(uploaded.statusCode, uploaded.body).toBe(201);
      const submission = uploaded.json<{ data: { id: string; status: string; archiveSha256: string; ociManifestDigest: string; ociConfigDigest: string } }>().data;
      expect(submission).toMatchObject({
        status: 'PREFLIGHT', archiveSha256: fixture.archiveSha256,
        ociManifestDigest: fixture.ociManifestDigest, ociConfigDigest: fixture.ociConfigDigest,
      });
      uploadedSubmissionIds.push(submission.id);
      const history = await app.inject({ method: 'GET', url: '/api/v1/submissions', headers: { cookie } });
      expect(history.json<{ data: readonly { id: string; status: string }[] }>().data).toContainEqual(expect.objectContaining({ id: submission.id, status: 'PREFLIGHT' }));

      expect(await preflightSubmission({ submissionId: submission.id, database, storage })).toEqual({
        submissionId: submission.id, status: 'ACTIVE', replayed: false,
      });
      expect(await preflightSubmission({ submissionId: submission.id, database, storage })).toEqual({
        submissionId: submission.id, status: 'ACTIVE', replayed: true,
      });
    }

    const scheduleInput = { tournamentStage: stage, idempotencyKey: `qualification-${namespace}` };
    const scheduled = await scheduleRound(database, scheduleInput);
    createdMatchIds.push(...scheduled.matchIds);
    expect(scheduled).toMatchObject({ replayed: false, seriesIds: [expect.any(String)], matchIds: [expect.any(String), expect.any(String)] });
    const retrySchedule = await scheduleRound(database, scheduleInput);
    expect(retrySchedule).toEqual({ ...scheduled, replayed: true });
    const jobs: Array<{ readonly matchId: string }> = [];
    matchQueue = new MatchQueue({ redisUrl, queueName });
    worker = createMatchWorker({
      redisUrl, queueName, deadLetterQueueName,
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      processMatch: async (job, attempt) => {
        await runMatchJob({ job, attempt, database: database!, storage: createS3Storage({ client: s3Client!, bucket: s3Bucket! }) });
      },
    });
    await worker.worker.waitUntilReady();
    inspector = new Queue(queueName, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });

    let completeCount = 0;
    let completeTimer: NodeJS.Timeout | undefined;
    const matchesFinished = new Promise<void>((resolveFinished, rejectFinished) => {
      completeTimer = setTimeout(() => rejectFinished(new Error('QUALIFICATION_WORKER_TIMEOUT')), 180_000);
      worker!.worker.on('completed', (job) => {
        if (job === undefined || !scheduled.matchIds.includes(job.data.matchId)) return;
        completeCount += 1;
        if (completeCount === scheduled.matchIds.length) resolveFinished();
      });
      worker!.worker.on('failed', (job, error) => {
        if (job !== undefined && scheduled.matchIds.includes(job.data.matchId) && job.attemptsMade >= 3) {
          rejectFinished(new Error(`QUALIFICATION_WORKER_FAILED:${error.message}`));
        }
      });
    });
    const dispatched = await dispatchScheduledMatches(database, {
      enqueue: async (job) => { jobs.push(job); return matchQueue!.enqueue(job); },
    });
    expect(dispatched).toBe(scheduled.matchIds.length);
    try { await matchesFinished; } finally { if (completeTimer !== undefined) clearTimeout(completeTimer); }
    expect(jobs.map(({ matchId }) => matchId).sort()).toEqual([...scheduled.matchIds].sort());
    expect(await dispatchScheduledMatches(database, matchQueue)).toBe(0);

    for (const matchId of scheduled.matchIds) {
      const job = jobs.find((item) => item.matchId === matchId);
      if (job === undefined) throw new Error('QUALIFICATION_SCHEDULED_JOB_MISSING');
      const stored = await database.query<{ readonly payload: unknown }>('SELECT payload FROM match_outbox WHERE match_id = $1 AND event_type = \'MATCH_SCHEDULED\'', [matchId]);
      const replayed = await runMatchJob({ job: stored.rows[0]!.payload as never, database, storage: createS3Storage({ client: s3Client, bucket: s3Bucket }) });
      expect(replayed.alreadyFinalized).toBe(true);
    }
    for (const seriesId of scheduled.seriesIds) {
      expect((await settleSeries(database, seriesId)).state).toBe('FINALIZED');
      const firstLedger = await database.query<{ readonly count: string }>('SELECT count(*)::text AS count FROM rating_ledger WHERE series_id = $1', [seriesId]);
      expect(firstLedger.rows[0]?.count).toBe('2');
      expect(await settleSeries(database, seriesId)).toMatchObject({ state: 'FINALIZED' });
      expect((await applyRoundRatings(database, scheduled.roundId)).replayed).toBe(true);
    }

    const matchResults = await app.inject({ method: 'GET', url: `/api/v1/results/matches?stage=${stage}`, headers: { cookie: teamCookies[0] } });
    expect(matchResults.statusCode).toBe(200);
    expect(matchResults.json().data.pagination.total).toBe(2);
    const seriesResults = await app.inject({ method: 'GET', url: `/api/v1/results/series?stage=${stage}`, headers: { cookie: btcCookie } });
    expect(seriesResults.statusCode).toBe(200);
    expect(seriesResults.json().data.items).toHaveLength(1);
    expect(seriesResults.json().data.items[0].status).toBe('FINALIZED');
    const leaderboard = await app.inject({ method: 'GET', url: `/api/v1/leaderboard?stage=${stage}` });
    expect(leaderboard.statusCode).toBe(200);
    expect(leaderboard.json().data.pagination.total).toBe(2);

    const matchId = scheduled.matchIds[0]!;
    const unavailable = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${matchId}` });
    expect(unavailable.statusCode).toBe(404);
    const stageKey = `qualification-stage-${namespace}`;
    const stageReplay = () => app!.inject({
      method: 'POST', url: `/api/v1/admin/replays/${matchId}/stage`,
      headers: { cookie: btcCookie!, 'idempotency-key': stageKey }, payload: { reason: 'Qualification replay review' },
    });
    const [staged, stagedRetry] = await Promise.all([stageReplay(), stageReplay()]);
    expect(staged.statusCode).toBe(200);
    expect(stagedRetry.json()).toEqual(staged.json());

    const artifact = await database.query<{ readonly event_log_key: string }>('SELECT event_log_key FROM match_results WHERE match_id = $1', [matchId]);
    const objectStorage = createS3Storage({ client: s3Client, bucket: s3Bucket });
    const originalBytes = await objectStorage.get(artifact.rows[0]!.event_log_key);
    const changedBytes = Buffer.from(originalBytes);
    changedBytes[0] = changedBytes[0]! ^ 1;
    await objectStorage.put(artifact.rows[0]!.event_log_key, changedBytes);
    const publishKey = `qualification-publish-${namespace}`;
    const publishReplay = () => app!.inject({
      method: 'POST', url: `/api/v1/admin/replays/${matchId}/publish`,
      headers: { cookie: btcCookie!, 'idempotency-key': publishKey }, payload: { reason: 'Qualification replay approved' },
    });
    const tamperedPublish = await publishReplay();
    expect(tamperedPublish.statusCode).toBe(409);
    expect(tamperedPublish.body).not.toContain('entries');
    const tamperedPublic = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${matchId}` });
    expect(tamperedPublic.statusCode).toBe(404);
    await objectStorage.put(artifact.rows[0]!.event_log_key, originalBytes);

    const [published, publishedRetry] = await Promise.all([publishReplay(), publishReplay()]);
    expect(published.statusCode).toBe(200);
    expect(publishedRetry.json()).toEqual(published.json());
    const publicReplay = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${matchId}` });
    expect(publicReplay.statusCode).toBe(200);
    expect(publicReplay.headers['content-type']).toBe('application/vnd.ott.spectator-replay+json; version="1"; charset=utf-8');
    const projected = await verifyReplayResponse(replayResponse(publicReplay));
    const timeline = createReplayTimeline(projected);
    expect(timeline.events.length).toBeGreaterThan(0);
    expect(timeline.frames.at(-1)?.finished).toBe(true);

    const dedupe = await database.query<{ readonly results: string; readonly finalizedEvents: string; readonly publicationEvents: string }>(`
      SELECT (SELECT count(*) FROM match_results WHERE match_id = ANY($1::uuid[]))::text AS results,
        (SELECT count(*) FROM match_outbox WHERE match_id = ANY($1::uuid[]) AND event_type = 'MATCH_FINALIZED')::text AS "finalizedEvents",
        (SELECT count(*) FROM replay_publication_events WHERE match_id = $2)::text AS "publicationEvents"`, [scheduled.matchIds, matchId]);
    expect(dedupe.rows[0]).toEqual({ results: '2', finalizedEvents: '2', publicationEvents: '2' });
    const pending = await inspector!.getJobCounts('waiting', 'active', 'delayed', 'failed');
    expect(pending).toMatchObject({ waiting: 0, active: 0, delayed: 0, failed: 0 });

    const storedLog = await database.query<{ readonly event_log_sha256: string }>('SELECT event_log_sha256 FROM match_results WHERE match_id = $1', [matchId]);
    expect(storedLog.rows[0]?.event_log_sha256).toBe(`sha256:${createHash('sha256').update(originalBytes).digest('hex')}`);
  }, 180_000);
});
