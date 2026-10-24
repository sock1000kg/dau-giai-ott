import { randomUUID } from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateOciSubmission } from '@ott/job-contract';
import {
  bootstrapBtcAdmin,
  createAuthApp,
  createDatabase,
  createPasswordHasher,
  createRound,
  createRuleSet,
  createS3Storage,
  executeTransition,
  runMigrations,
  type Database,
  type ObjectStorage,
} from '@ott/platform-api';
import {
  createCoordinatorRuntime,
  createMatchWorker,
  loadCoordinatorConfig,
  runMatchJob,
} from '../src/index.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const firstLegalFixturePath = join(repoRoot, 'src/bots/sandbox-corpus/artifacts/oci-fixtures/v2-first-legal.oci.tar');
const captureFirstFixturePath = join(repoRoot, 'src/bots/sandbox-corpus/artifacts/oci-fixtures/v2-capture-first.oci.tar');
const fixturesPresent = fsSync.existsSync(firstLegalFixturePath) && fsSync.existsSync(captureFirstFixturePath);
// The bad-socket test uploads a *different* archive than the e2e test: object keys are content-addressed
// (`submissions/<sha256>.oci.tar`, UNIQUE in the database), so a second upload of identical bytes — in the same
// database — returns 500 and removes the stored object (known API defect, tracked separately).
const nodeActionFixturePath = join(repoRoot, 'src/bots/sandbox-corpus/artifacts/oci-fixtures/node-action.oci.tar');
const badSocketFixturesPresent = fsSync.existsSync(nodeActionFixturePath);

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
const dockerSocket = process.env.OTT_DOCKER_SOCKET ?? '/var/run/docker.sock';

const requiredEnvironment = [databaseUrl, redisUrl, s3Endpoint, s3Bucket, s3AccessKeyId, s3SecretAccessKey];
const integration = requiredEnvironment.every((value) => value !== undefined && value.length > 0)
  ? describe
  : describe.skip;

const runId = randomUUID().replaceAll('-', '').slice(0, 16);
const schemaName = `coord_int_${runId}`;
const queueName = `ott-coord-int-queue-${runId}`;
const deadLetterQueueName = `${queueName}-dlq`;
const stage = 'QUALIFICATION';
const passwordHasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });

function sessionCookie(response: { readonly headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') throw new Error('SESSION_COOKIE_MISSING');
  return value.split(';', 1)[0]!;
}

integration('Coordinator Integration (P2-T32 - Reviewer Run)', () => {
  let adminDatabase: Database | undefined;
  let database: Database | undefined;
  let redis: RedisClientType | undefined;
  let s3Client: S3Client | undefined;
  let storage: ObjectStorage | undefined;
  let app: ReturnType<typeof createAuthApp> | undefined;
  let worker: ReturnType<typeof createMatchWorker> | undefined;
  let inspector: Queue | undefined;
  let snapshotDir: string | undefined;

  let adminAccountId: string = '';
  let ruleSet: any;
  let btcUsername: string = '';
  let btcCookie: string | undefined;
  const teamCookies: string[] = [];
  const uploadedSubmissionIds: string[] = [];
  let scheduledSeriesIds: readonly string[] = [];
  let scheduledMatchIds: readonly string[] = [];
  let scopedDbUrl: string = '';

  beforeAll(async () => {
    if (
      databaseUrl === undefined ||
      redisUrl === undefined ||
      s3Endpoint === undefined ||
      s3Bucket === undefined ||
      s3AccessKeyId === undefined ||
      s3SecretAccessKey === undefined
    ) {
      throw new Error('INTEGRATION_ENV_MISSING');
    }

    snapshotDir = await fs.mkdtemp(join(tmpdir(), `ott-coord-int-${runId}-`));

    // 1. Database schema
    adminDatabase = createDatabase({ connectionString: databaseUrl });
    await adminDatabase.query(`CREATE SCHEMA "${schemaName}"`);

    const parsed = new URL(databaseUrl);
    parsed.searchParams.set('options', `-c search_path=${schemaName}`);
    scopedDbUrl = parsed.toString();

    database = createDatabase({ connectionString: scopedDbUrl });
    await runMigrations(database);

    // 2. Storage & Redis
    redis = createClient({ url: redisUrl });
    await redis.connect();

    s3Client = new S3Client({
      endpoint: s3Endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
    });
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: s3Bucket }));
    } catch {
      // Bucket already exists or BucketAlreadyOwnedByYou
    }
    storage = createS3Storage({ client: s3Client, bucket: s3Bucket });

    // 3. App & Admin
    btcUsername = `btc-${runId}`;
    const btcPassword = `P@ss-${randomUUID()}`;
    await bootstrapBtcAdmin({
      database,
      passwordHasher,
      environment: {
        OTT_BOOTSTRAP_BTC_USERNAME: btcUsername,
        OTT_BOOTSTRAP_BTC_PASSWORD: btcPassword,
      },
    });

    const adminAccount = await database.query<{ id: string }>(
      'SELECT id FROM accounts WHERE username = $1',
      [btcUsername],
    );
    adminAccountId = adminAccount.rows[0]!.id;

    ruleSet = await createRuleSet(database, {
      tournamentStage: stage,
      rules: {
        schemaVersion: 'ott.round-rules.v1',
        engineVersion: '1.0.0',
        mapSet: [{ mapId: 'default', checksum: 'a'.repeat(64) }],
        maxTurns: 100,
        faultPolicyVersion: 'P2_BASELINE_V1',
        timeControl: {
          startupMs: 5000,
          totalBotBudgetMs: 60000,
          matchWallClockMs: 150000,
          perTurn: { mode: 'FIXED', fixedMs: 2500 },
        },
        resources: {
          memoryMiB: 256,
          milliCpu: 1000,
          pids: 64,
          tmpfsMiB: 64,
          archiveMiB: 512,
          unpackedMiB: 1024,
          maxLayers: 20,
        },
        schedule: {
          submissionOpensAt: '2026-10-14T00:00:00.000Z',
          submissionDeadlineAt: '2026-10-15T00:00:00.000Z',
          graceEndsAt: '2026-10-16T00:00:00.000Z',
          runStartsAt: '2026-10-16T12:00:00.000Z',
          runMaxHours: 24,
          appealEndsAt: '2026-10-18T00:00:00.000Z',
        },
        testRun: {
          quotaPerTeamPerDay: 5,
          opponents: ['BTC_REFERENCE'],
        },
      },
      reason: 'qualification rules for coordinator integration',
      actorAccountId: adminAccountId,
    });

    app = createAuthApp({
      database,
      redis,
      passwordHasher,
      secureCookies: false,
      storage,
      now: () => new Date('2026-10-14T12:00:00.000Z'),
    });
    await app.ready();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: btcUsername, password: btcPassword },
    });
    expect(loginRes.statusCode).toBe(200);
    btcCookie = sessionCookie(loginRes);
  }, 120_000);

  afterAll(async () => {
    if (worker !== undefined) await worker.close();
    if (inspector !== undefined) {
      await inspector.obliterate({ force: true }).catch(() => undefined);
      await inspector.close();
    }
    if (redisUrl !== undefined) {
      try {
        const cleanupRedis = new Redis(redisUrl, { maxRetriesPerRequest: null });
        let cursor = '0';
        do {
          const [nextCursor, keys] = await cleanupRedis.scan(cursor, 'MATCH', `bull:*${runId}*`, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            await cleanupRedis.del(...keys);
          }
        } while (cursor !== '0');
        await cleanupRedis.quit();
      } catch {
        // ignore
      }
    }
    if (app !== undefined) {
      if (btcCookie) await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: btcCookie } });
      for (const cookie of teamCookies) {
        await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
      }
      await app.close();
    }
    if (database !== undefined && uploadedSubmissionIds.length > 0) {
      const objects = await database.query<{ readonly object_key: string }>(
        'SELECT object_key FROM submissions WHERE id = ANY($1::uuid[])',
        [uploadedSubmissionIds],
      );
      for (const { object_key } of objects.rows) {
        await storage?.remove(object_key).catch(() => undefined);
      }
    }
    if (database !== undefined) await database.close();
    if (adminDatabase !== undefined) {
      await adminDatabase.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminDatabase.close();
    }
    if (redis !== undefined) await redis.quit();
    if (s3Client !== undefined) s3Client.destroy();
    try {
      const baseTmp = process.env.TMPDIR || tmpdir();
      const entries = await fs.readdir(baseTmp);
      for (const entry of entries) {
        if (entry.startsWith('ott-coord-int-')) {
          await fs.rm(join(baseTmp, entry), { recursive: true, force: true }).catch(() => undefined);
        }
      }
    } catch {
      // ignore
    }
  });

  it.skipIf(!fixturesPresent)(
    'runs a real round through the coordinator end-to-end without manual dispatch or settle calls (requires src/bots/sandbox-corpus/artifacts/oci-fixtures/{v2-first-legal,v2-capture-first}.oci.tar; run npm run build:corpus --workspace @ott/sandbox-corpus)',
    async () => {
      const firstLegalBytes = await fs.readFile(firstLegalFixturePath);
      const captureFirstBytes = await fs.readFile(captureFirstFixturePath);

      const limits = { maxArchiveBytes: 256 * 1024 * 1024, maxUncompressedBytes: 512 * 1024 * 1024 };
      const val1 = validateOciSubmission(firstLegalBytes, limits);
      const val2 = validateOciSubmission(captureFirstBytes, limits);
      expect(val1.ok).toBe(true);
      expect(val2.ok).toBe(true);

      const fixtures = [
        { name: 'v2-first-legal', bytes: firstLegalBytes },
        { name: 'v2-capture-first', bytes: captureFirstBytes },
      ];

      let createdRound: any;
      let coordinator: Awaited<ReturnType<typeof createCoordinatorRuntime>> | undefined;
      let coordinatorRestart: Awaited<ReturnType<typeof createCoordinatorRuntime>> | undefined;

      try {
        // 1. Create round and execute OPEN transition before any upload
        createdRound = await createRound(database!, {
        tournamentStage: stage,
        reason: 'create round for coordinator test',
        actorAccountId: adminAccountId,
      });

      await executeTransition(database!, {
        roundId: createdRound.id,
        action: { type: 'open', ruleSetId: ruleSet.id },
        reason: 'open qualification submissions',
        actorAccountId: adminAccountId,
      });

      // 2. Provision 2 teams and upload submissions in PREFLIGHT
      for (const [idx, fixture] of fixtures.entries()) {
        const teamRes = await app!.inject({
          method: 'POST',
          url: '/api/v1/admin/teams',
          headers: { cookie: btcCookie! },
          payload: { name: `CoordTeam ${runId} ${idx === 0 ? 'X' : 'O'}` },
        });
        expect(teamRes.statusCode).toBe(201);
        const team = teamRes.json<{ data: ProvisionedTeam }>().data;

        const teamLogin = await app!.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: team.credential,
        });
        expect(teamLogin.statusCode).toBe(200);
        const cookie = sessionCookie(teamLogin);
        teamCookies.push(cookie);

        const uploadRes = await app!.inject({
          method: 'POST',
          url: '/api/v1/submissions',
          headers: { cookie, 'content-type': 'application/octet-stream' },
          payload: fixture.bytes,
        });
        expect(uploadRes.statusCode, uploadRes.body).toBe(201);
        const submission = uploadRes.json<{ data: { id: string; status: string } }>().data;
        expect(submission.status).toBe('PREFLIGHT');
        uploadedSubmissionIds.push(submission.id);
      }

      // 3. Start worker host to execute match jobs
      worker = createMatchWorker({
        redisUrl: redisUrl!,
        queueName,
        deadLetterQueueName,
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        processMatch: async (job, attempt) => {
          await runMatchJob({ job, attempt, database: database!, storage: storage! });
        },
      });
      await worker.worker.waitUntilReady();
      inspector = new Queue(queueName, {
        connection: new Redis(redisUrl!, { maxRetriesPerRequest: null }),
      });

      // 4. Start coordinator with fast intervals
      const coordConfig = loadCoordinatorConfig({
        DATABASE_URL: scopedDbUrl,
        REDIS_URL: redisUrl!,
        S3_ENDPOINT: s3Endpoint!,
        S3_BUCKET: s3Bucket!,
        S3_ACCESS_KEY_ID: s3AccessKeyId!,
        S3_SECRET_ACCESS_KEY: s3SecretAccessKey!,
        OTT_MATCH_QUEUE: queueName,
        OTT_DOCKER_SOCKET: dockerSocket,
        OTT_COORD_REQUIRE_DOCKER: 'true',
        OTT_COORD_PREFLIGHT_INTERVAL_MS: '500',
        OTT_COORD_DISPATCH_INTERVAL_MS: '500',
        OTT_COORD_SETTLE_INTERVAL_MS: '1000',
        OTT_COORD_SNAPSHOT_INTERVAL_MS: '2000',
        OTT_SNAPSHOT_DIR: snapshotDir!,
        OTT_COORD_METRICS_PORT: '0',
      });

        coordinator = await createCoordinatorRuntime(coordConfig);
        expect(coordinator.getRole()).toBe('active');

        // 5. Wait for both submissions to become ACTIVE (automated by coordinator preflight loop)
        const deadlinePreflight = Date.now() + 60_000;
        while (Date.now() < deadlinePreflight) {
          const activeRows = await database!.query<{ count: string }>(
            "SELECT count(*)::text as count FROM submissions WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'",
            [uploadedSubmissionIds],
          );
          if (activeRows.rows[0]?.count === '2') break;
          await new Promise((r) => setTimeout(r, 500));
        }

        const auditDetails = await database!.query<{ id: string; status: string; fail_reason: string | null }>(
          `SELECT s.id, s.status, a.reason as fail_reason
           FROM submissions s
           LEFT JOIN LATERAL (
             SELECT reason FROM audit_events
             WHERE target_id = s.id AND action = 'SUBMISSION_PREFLIGHT_FAILED'
             ORDER BY created_at DESC LIMIT 1
           ) a ON true
           WHERE s.id = ANY($1::uuid[])`,
          [uploadedSubmissionIds],
        );

        const preflightCheck = await database!.query<{ count: string }>(
          "SELECT count(*)::text as count FROM submissions WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'",
          [uploadedSubmissionIds],
        );
        expect(preflightCheck.rows[0]?.count, JSON.stringify(auditDetails.rows)).toBe('2');

      // 6. Close -> Start round after submissions are ACTIVE
      await executeTransition(
        database!,
        {
          roundId: createdRound.id,
          action: { type: 'close' },
          reason: 'close qualification submissions',
          actorAccountId: adminAccountId,
        },
        { now: () => new Date('2026-10-17T00:00:00.000Z') },
      );

      const startedRound = await executeTransition(database!, {
        roundId: createdRound.id,
        action: { type: 'start', ruleSetId: ruleSet.id, idempotencyKey: `coord-round-${runId}` },
        reason: 'start qualification round',
        actorAccountId: adminAccountId,
      });

      expect(startedRound.status).toBe('RUNNING');
    expect(startedRound.scheduleRoundId).toBeTruthy();

    const seriesResult = await database!.query<{ id: string }>(
      'SELECT id FROM series WHERE round_id = $1 ORDER BY created_at',
      [startedRound.scheduleRoundId],
    );
    scheduledSeriesIds = seriesResult.rows.map((r) => r.id);
    expect(scheduledSeriesIds.length).toBe(1);

    const matchesResult = await database!.query<{ id: string }>(
      'SELECT id FROM matches WHERE series_id = ANY($1::uuid[]) ORDER BY created_at, id',
      [scheduledSeriesIds],
    );
    scheduledMatchIds = matchesResult.rows.map((r) => r.id);
    expect(scheduledMatchIds.length).toBe(2);

    // 6. Wait for matches to reach FINALIZED (dispatched by coordinator dispatch loop, executed by worker)
    const deadlineMatches = Date.now() + 180_000;
    while (Date.now() < deadlineMatches) {
      const finalized = await database!.query<{ count: string }>(
        "SELECT count(*)::text as count FROM matches WHERE id = ANY($1::uuid[]) AND status = 'FINALIZED'",
        [scheduledMatchIds],
      );
      if (finalized.rows[0]?.count === '2') break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const matchRows = await database!.query<{ count: string }>(
      "SELECT count(*)::text as count FROM matches WHERE id = ANY($1::uuid[]) AND status = 'FINALIZED'",
      [scheduledMatchIds],
    );
    expect(matchRows.rows[0]?.count).toBe('2');

    // 7. Wait for series to be FINALIZED (settled by coordinator settle loop) and Elo rating applied
    const deadlineSettle = Date.now() + 60_000;
    while (Date.now() < deadlineSettle) {
      const seriesRows = await database!.query<{ count: string }>(
        "SELECT count(*)::text as count FROM series WHERE id = ANY($1::uuid[]) AND status = 'FINALIZED'",
        [scheduledSeriesIds],
      );
      const ledgerRows = await database!.query<{ count: string }>(
        'SELECT count(*)::text as count FROM rating_ledger WHERE series_id = ANY($1::uuid[])',
        [scheduledSeriesIds],
      );
      // settleSeries commits the series first and applies Elo in a second transaction: wait for both.
      if (seriesRows.rows[0]?.count === '1' && ledgerRows.rows[0]?.count === '2') break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const finalizedSeries = await database!.query<{ count: string }>(
      "SELECT count(*)::text as count FROM series WHERE id = ANY($1::uuid[]) AND status = 'FINALIZED'",
      [scheduledSeriesIds],
    );
    expect(finalizedSeries.rows[0]?.count).toBe('1');

    // Assert rating ledger rows = 2 (Elo applied once)
    const ledger = await database!.query<{ count: string }>(
      'SELECT count(*)::text as count FROM rating_ledger WHERE series_id = ANY($1::uuid[])',
      [scheduledSeriesIds],
    );
    expect(ledger.rows[0]?.count).toBe('2');

    // 8. Assert latest.json snapshot exists, parses, and lists results + standings
    const latestPath = join(snapshotDir!, 'latest.json');
    // The snapshot loop publishes asynchronously: poll until a snapshot that already lists the finished round exists.
    let latestJson: { schemaVersion?: number; file?: string } = {};
    let snapshotBody: Record<string, any> = {};
    const deadlineSnapshot = Date.now() + 60_000;
    while (Date.now() < deadlineSnapshot) {
      try {
        latestJson = JSON.parse(await fs.readFile(latestPath, 'utf8'));
        snapshotBody = JSON.parse(await fs.readFile(join(snapshotDir!, String(latestJson.file)), 'utf8'));
        if ((snapshotBody.results?.length ?? 0) > 0 && snapshotBody.leaderboard?.length === 2) break;
      } catch {
        // latest.json (or the snapshot it points to) is not published yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(latestJson.schemaVersion).toBe(1);
    expect(latestJson.file).toMatch(/^snapshot-[a-f0-9]+\.json$/);
    expect(snapshotBody.stage).toBe('QUALIFICATION');
    expect(snapshotBody.round?.name).toMatch(/^Round \d+/);
    expect(snapshotBody.results.length).toBeGreaterThan(0);
    expect(snapshotBody.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matchId: expect.any(String),
          teams: expect.any(String),
          score: expect.any(String),
        }),
      ]),
    );
    expect(snapshotBody.leaderboard.length).toBe(2);

    // 9. Stop and restart coordinator: verify no duplicate ledgers and match_outbox rows dispatched once
    await coordinator.stop();
    coordinator = undefined;

    coordinatorRestart = await createCoordinatorRuntime(coordConfig);
    expect(coordinatorRestart.getRole()).toBe('active');
    await new Promise((r) => setTimeout(r, 2000));
    await coordinatorRestart.stop();
    coordinatorRestart = undefined;

    const ledgerAfterRestart = await database!.query<{ count: string }>(
      'SELECT count(*)::text as count FROM rating_ledger WHERE series_id = ANY($1::uuid[])',
      [scheduledSeriesIds],
    );
    expect(ledgerAfterRestart.rows[0]?.count).toBe('2');

    // Verify all match_outbox rows for the round were dispatched exactly once
    const outboxCounts = await database!.query<{ total: string; dispatched: string }>(
      `SELECT count(*)::text as total, count(*) FILTER (WHERE dispatched_at IS NOT NULL)::text as dispatched
       FROM match_outbox
       WHERE match_id = ANY($1::uuid[]) AND event_type = 'MATCH_SCHEDULED'`,
      [scheduledMatchIds],
    );
    expect(outboxCounts.rows[0]?.total).toBe('2');
    expect(outboxCounts.rows[0]?.dispatched).toBe('2');

    // And verify BullMQ inspector has jobs with non-null name and valid opts.jobId
    for (const matchId of scheduledMatchIds) {
      const job = await inspector.getJob(`match-${matchId}`);
      expect(job).not.toBeNull();
      expect(job!.name).toBeTruthy();
      expect(job!.opts.jobId).toBe(`match-${matchId}`);
    }
    const jobCounts = await inspector.getJobCounts('completed', 'active', 'delayed', 'failed', 'waiting');
    expect((jobCounts.completed ?? 0) + (jobCounts.active ?? 0) + (jobCounts.waiting ?? 0)).toBe(2);
  } finally {
    if (coordinatorRestart) await coordinatorRestart.stop().catch(() => undefined);
    if (coordinator) await coordinator.stop().catch(() => undefined);
    if (worker) {
      await worker.close().catch(() => undefined);
      worker = undefined;
    }
    if (inspector) {
      await inspector.close().catch(() => undefined);
      inspector = undefined;
    }
    if (createdRound?.id) {
      await database!.query(
        "UPDATE qualification_rounds SET status = 'SUBMISSION_CLOSED' WHERE id = $1 AND status = 'SUBMISSION_OPEN'",
        [createdRound.id],
      ).catch((cleanupError: unknown) => { console.error('test cleanup: could not close round', createdRound.id, cleanupError instanceof Error ? cleanupError.name : 'unknown'); });
    }
  }
  }, 300_000);

  it('runs two coordinators on the same database: exactly one active, the other standby', async () => {
    const coordConfig = loadCoordinatorConfig({
      DATABASE_URL: scopedDbUrl,
      OTT_SNAPSHOT_DIR: snapshotDir!,
      REDIS_URL: redisUrl!,
      S3_ENDPOINT: s3Endpoint!,
      S3_BUCKET: s3Bucket!,
      S3_ACCESS_KEY_ID: s3AccessKeyId!,
      S3_SECRET_ACCESS_KEY: s3SecretAccessKey!,
      OTT_MATCH_QUEUE: `${queueName}-two-coord`,
      OTT_DOCKER_SOCKET: dockerSocket,
      OTT_COORD_REQUIRE_DOCKER: 'true',
      OTT_COORD_METRICS_PORT: '0',
    });

    let c1: Awaited<ReturnType<typeof createCoordinatorRuntime>> | undefined;
    let c2: Awaited<ReturnType<typeof createCoordinatorRuntime>> | undefined;
    try {
      c1 = await createCoordinatorRuntime(coordConfig);
      c2 = await createCoordinatorRuntime(coordConfig);

      expect(c1.getRole()).toBe('active');
      expect(c2.getRole()).toBe('standby');

      // Stop active coordinator and assert standby promotes to active within ~6 s, active transitions to standby
      await c1.stop();
      expect(c1.getRole()).toBe('standby');

      const promoteDeadline = Date.now() + 6000;
      while (Date.now() < promoteDeadline) {
        if (c2.getRole() === 'active') break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(c2.getRole()).toBe('active');

      await c2.stop();
      expect(c2.getRole()).toBe('standby');
    } finally {
      if (c2) await c2.stop().catch(() => undefined);
      if (c1) await c1.stop().catch(() => undefined);
    }
  }, 60_000);

  it('rejects startup when Docker is down and requireDocker=true', async () => {
    const invalidSocketConfig = loadCoordinatorConfig({
      DATABASE_URL: scopedDbUrl,
      OTT_SNAPSHOT_DIR: snapshotDir!,
      REDIS_URL: redisUrl!,
      S3_ENDPOINT: s3Endpoint!,
      S3_BUCKET: s3Bucket!,
      S3_ACCESS_KEY_ID: s3AccessKeyId!,
      S3_SECRET_ACCESS_KEY: s3SecretAccessKey!,
      OTT_MATCH_QUEUE: queueName,
      OTT_DOCKER_SOCKET: '/tmp/nonexistent-docker-socket.sock',
      OTT_COORD_REQUIRE_DOCKER: 'true',
      OTT_COORD_METRICS_PORT: '0',
    });

    await expect(createCoordinatorRuntime(invalidSocketConfig)).rejects.toThrow('DOCKER_UNAVAILABLE');
  }, 30_000);

  it.skipIf(!badSocketFixturesPresent)(
    'defers preflight when Docker socket is invalid: submission remains in PREFLIGHT and no audit failure row is written (requires src/bots/sandbox-corpus/artifacts/oci-fixtures/node-action.oci.tar; run npm run build:corpus --workspace @ott/sandbox-corpus)',
    async () => {
      let coordinator: Awaited<ReturnType<typeof createCoordinatorRuntime>> | undefined;
      let badSocketRound: any;

      try {
        // 1. Create and open a stage and round for bad-socket test before upload
        const badSocketStage = `BAD_SOCK_${runId}`.toUpperCase().slice(0, 32);
        const badRuleSet = await createRuleSet(database!, {
          tournamentStage: badSocketStage,
          rules: {
            schemaVersion: 'ott.round-rules.v1',
            engineVersion: '1.0.0',
            mapSet: [{ mapId: 'default', checksum: 'a'.repeat(64) }],
            maxTurns: 100,
            faultPolicyVersion: 'P2_BASELINE_V1',
            timeControl: {
              startupMs: 5000,
              totalBotBudgetMs: 60000,
              matchWallClockMs: 150000,
              perTurn: { mode: 'FIXED', fixedMs: 2500 },
            },
            resources: {
              memoryMiB: 256,
              milliCpu: 1000,
              pids: 64,
              tmpfsMiB: 64,
              archiveMiB: 512,
              unpackedMiB: 1024,
              maxLayers: 20,
            },
            schedule: {
              submissionOpensAt: '2026-10-14T00:00:00.000Z',
              submissionDeadlineAt: '2026-10-15T00:00:00.000Z',
              graceEndsAt: '2026-10-16T00:00:00.000Z',
              runStartsAt: '2026-10-16T12:00:00.000Z',
              runMaxHours: 24,
              appealEndsAt: '2026-10-18T00:00:00.000Z',
            },
            testRun: {
              quotaPerTeamPerDay: 5,
              opponents: ['BTC_REFERENCE'],
            },
          },
          reason: 'bad socket test rules',
          actorAccountId: adminAccountId,
        });

        badSocketRound = await createRound(database!, {
          tournamentStage: badSocketStage,
          reason: 'create round for bad-socket coordinator test',
          actorAccountId: adminAccountId,
        });

        await executeTransition(database!, {
          roundId: badSocketRound.id,
          action: { type: 'open', ruleSetId: badRuleSet.id },
          reason: 'open bad-socket submissions',
          actorAccountId: adminAccountId,
        });

        // 2. Provision a team and upload a submission
        const teamRes = await app!.inject({
          method: 'POST',
          url: '/api/v1/admin/teams',
          headers: { cookie: btcCookie! },
          payload: { name: `CoordTeam BadSocket ${runId}` },
        });
        expect(teamRes.statusCode).toBe(201);
        const team = teamRes.json<{ data: ProvisionedTeam }>().data;

        const teamLogin = await app!.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: team.credential,
        });
        const cookie = sessionCookie(teamLogin);
        teamCookies.push(cookie);

        const firstLegalBytes = await fs.readFile(nodeActionFixturePath);

        const uploadRes = await app!.inject({
          method: 'POST',
          url: '/api/v1/submissions',
          headers: { cookie, 'content-type': 'application/octet-stream' },
          payload: firstLegalBytes,
        });
        expect(uploadRes.statusCode, uploadRes.body).toBe(201);
        const submissionId = uploadRes.json<{ data: { id: string; status: string } }>().data.id;
        uploadedSubmissionIds.push(submissionId);

        // 3. Start a coordinator with requireDocker=false (so startup succeeds) but pointing to a bad Docker socket
        const badDockerConfig = loadCoordinatorConfig({
          DATABASE_URL: scopedDbUrl,
          OTT_SNAPSHOT_DIR: snapshotDir!,
          REDIS_URL: redisUrl!,
          S3_ENDPOINT: s3Endpoint!,
          S3_BUCKET: s3Bucket!,
          S3_ACCESS_KEY_ID: s3AccessKeyId!,
          S3_SECRET_ACCESS_KEY: s3SecretAccessKey!,
          OTT_MATCH_QUEUE: `${queueName}-badsocket`,
          OTT_DOCKER_SOCKET: '/tmp/nonexistent-bad-docker.sock',
          OTT_COORD_REQUIRE_DOCKER: 'false',
          OTT_COORD_PREFLIGHT_INTERVAL_MS: '200',
          OTT_COORD_METRICS_PORT: '0',
        });

        coordinator = await createCoordinatorRuntime(badDockerConfig);
        expect(coordinator.getRole()).toBe('active');

        // Allow the preflight loop to run a few times
        await new Promise((r) => setTimeout(r, 1500));

        const coordinatorMetrics = coordinator.metrics;
        await coordinator.stop();
        coordinator = undefined;

        // 4. Verify submission is still PREFLIGHT (not INVALID)
        const subCheck = await database!.query<{ status: string }>(
          'SELECT status FROM submissions WHERE id = $1',
          [submissionId],
        );
        expect(subCheck.rows[0]?.status).toBe('PREFLIGHT');

        // 5. Verify no SUBMISSION_PREFLIGHT_FAILED audit row was written
        const auditCheck = await database!.query<{ count: string }>(
          "SELECT count(*)::text as count FROM audit_events WHERE target_id = $1 AND action = 'SUBMISSION_PREFLIGHT_FAILED'",
          [submissionId],
        );
        expect(auditCheck.rows[0]?.count).toBe('0');

        // 6. Verify coordinator metric kind="infra" >= 1 (deferred path fired)
        expect(coordinatorMetrics.getErrors('preflight', { kind: 'infra' })).toBeGreaterThanOrEqual(1);
        expect(coordinatorMetrics.scrape()).toMatch(/ott_coordinator_loop_errors_total\{[^}]*loop="preflight"[^}]*kind="infra"[^}]*\}\s+[1-9]\d*/);
      } finally {
        if (coordinator) await coordinator.stop().catch(() => undefined);
        if (badSocketRound?.id) {
          await database!.query(
        "UPDATE qualification_rounds SET status = 'SUBMISSION_CLOSED' WHERE id = $1 AND status = 'SUBMISSION_OPEN'",
        [badSocketRound.id],
      ).catch((cleanupError: unknown) => { console.error('test cleanup: could not close round', badSocketRound.id, cleanupError instanceof Error ? cleanupError.name : 'unknown'); });
        }
      }
    },
    30_000,
  );
});
