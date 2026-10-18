import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MatchJobV1 } from '@ott/job-contract';
import { createDatabase, runMigrations, type Database } from '@ott/platform-api';
import { routeJob, startWorker, type WorkerRuntime } from '../src/runtime/server.ts';

/**
 * Worker Runtime Host Integration Suite (P3-D32)
 *
 * NOTE FOR CODER/REVIEWER:
 * Per plan.md rules, this test requires live infrastructure:
 * PostgreSQL (pg-loop26), Redis (redis-loop26), SeaweedFS/S3 (s3-loop26), and the Docker socket.
 * This suite is skipped during uncredentialed sandbox test runs and executed by the Reviewer.
 */

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

const isIntegrationConfigured = Boolean(
  databaseUrl &&
  redisUrl &&
  s3Endpoint &&
  s3Bucket &&
  s3AccessKeyId &&
  s3SecretAccessKey,
);

const integration = isIntegrationConfigured ? describe : describe.skip;

integration('Worker Runtime Integration (P3-D32)', () => {
  const schemaName = `worker_test_${randomUUID().replaceAll('-', '')}`;
  const testRunId = randomUUID().slice(0, 8);
  const queueName = `ott-test-match-${testRunId}`;
  const dlqName = `ott-test-dlq-${testRunId}`;
  const dockerSocket = process.env.OTT_DOCKER_SOCKET ?? '/var/run/docker.sock';

  let adminDb: Database;
  let scopedDbUrl: string;
  let redisClient: Redis;
  let sharedRuntime: WorkerRuntime;
  let metricsOrigin: string;

  const getBaseEnv = (): Record<string, string> => ({
    DATABASE_URL: scopedDbUrl,
    REDIS_URL: redisUrl!,
    S3_ENDPOINT: s3Endpoint!,
    S3_BUCKET: s3Bucket!,
    S3_ACCESS_KEY_ID: s3AccessKeyId!,
    S3_SECRET_ACCESS_KEY: s3SecretAccessKey!,
    OTT_MATCH_QUEUE: queueName,
    OTT_DEAD_LETTER_QUEUE: dlqName,
    OTT_WORKER_METRICS_HOST: '127.0.0.1',
    OTT_WORKER_METRICS_PORT: '0',
    OTT_WORKER_HEARTBEAT_MS: '2000',
    OTT_WORKER_HEARTBEAT_TTL_SECONDS: '10',
    OTT_DOCKER_SOCKET: dockerSocket,
    OTT_WORKER_REQUIRE_DOCKER: 'true',
    OTT_SHUTDOWN_TIMEOUT_MS: '10000',
  });

  beforeAll(async () => {
    adminDb = createDatabase({ connectionString: databaseUrl! });
    await adminDb.query(`CREATE SCHEMA "${schemaName}"`);

    const url = new URL(databaseUrl!);
    url.searchParams.set('options', `-c search_path=${schemaName}`);
    scopedDbUrl = url.toString();

    const scopedMigrationDb = createDatabase({ connectionString: scopedDbUrl });
    await runMigrations(scopedMigrationDb);
    await scopedMigrationDb.close();

    redisClient = new Redis(redisUrl!, { maxRetriesPerRequest: null });

    // Start shared worker host
    sharedRuntime = await startWorker(getBaseEnv());
    const metricsServer = sharedRuntime.metricsServer!;
    metricsOrigin = `http://${metricsServer.host}:${metricsServer.port}`;
  }, 30000);

  afterAll(async () => {
    if (sharedRuntime !== undefined) {
      await sharedRuntime.stop().catch(() => undefined);
    }

    // Clean up BullMQ queue keys
    if (redisClient !== undefined) {
      const queue = new Queue(queueName, { connection: new Redis(redisUrl!, { maxRetriesPerRequest: null }) });
      const dlq = new Queue(dlqName, { connection: new Redis(redisUrl!, { maxRetriesPerRequest: null }) });
      await queue.obliterate({ force: true }).catch(() => undefined);
      await dlq.obliterate({ force: true }).catch(() => undefined);
      await queue.close().catch(() => undefined);
      await dlq.close().catch(() => undefined);
      await redisClient.quit().catch(() => undefined);
    }

    if (adminDb !== undefined) {
      await adminDb.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
      await adminDb.close().catch(() => undefined);
    }
  });

  it('probes report healthy on running instance (GET /health/ready, /health/live, /metrics)', async () => {
    const readyRes = await fetch(`${metricsOrigin}/health/ready`);
    expect(readyRes.status).toBe(200);
    expect(readyRes.headers.get('cache-control')).toBe('no-store');
    const readyBody = (await readyRes.json()) as any;
    expect(readyBody).toEqual({ status: 'ready' });

    const liveRes = await fetch(`${metricsOrigin}/health/live`);
    expect(liveRes.status).toBe(200);
    expect(liveRes.headers.get('cache-control')).toBe('no-store');
    const liveBody = (await liveRes.json()) as any;
    expect(liveBody).toEqual({ status: 'ok' });

    const metricsRes = await fetch(`${metricsOrigin}/metrics`);
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.headers.get('content-type')).toBe('text/plain; version=0.0.4');
    const metricsText = await metricsRes.text();
    expect(metricsText).toContain('ott_match_attempts_total');
  });

  it('registers heartbeat key and active-set entry in Redis within 2 heartbeats', async () => {
    const workerId = sharedRuntime.pool.getWorkerId();
    expect(workerId).toBeTruthy();

    const heartbeatKey = `ott:worker:heartbeat:${workerId}`;
    const maxWait = Date.now() + 5000;
    let heartbeatExists = false;
    let inActiveSet = false;

    while (Date.now() < maxWait) {
      const [rawPayload, isMember] = await Promise.all([
        redisClient.get(heartbeatKey),
        redisClient.sismember('ott:worker:active-set', workerId),
      ]);

      if (rawPayload !== null && isMember === 1) {
        heartbeatExists = true;
        inActiveSet = true;
        const parsed = JSON.parse(rawPayload);
        expect(parsed.workerId).toBe(workerId);
        expect(parsed.paused).toBe(false);
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(heartbeatExists).toBe(true);
    expect(inActiveSet).toBe(true);
  });

  it('enqueues an invalid job payload, routes to DLQ and process keeps running healthy', async () => {
    const producerQueue = new Queue(queueName, {
      connection: new Redis(redisUrl!, { maxRetriesPerRequest: null }),
    });

    try {
      await producerQueue.add('run-match', { corrupted: 'payload_not_valid_job' });

      // Check DLQ receives the dead letter
      const dlqQueue = new Queue(dlqName, {
        connection: new Redis(redisUrl!, { maxRetriesPerRequest: null }),
      });

      try {
        const maxWait = Date.now() + 6000;
        let deadLetterFound = false;

        while (Date.now() < maxWait) {
          const count = await dlqQueue.getJobCounts('completed', 'waiting');
          if ((count.completed ?? 0) > 0 || (count.waiting ?? 0) > 0) {
            deadLetterFound = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }

        expect(deadLetterFound).toBe(true);
      } finally {
        await dlqQueue.close();
      }

      // Check worker is still alive
      const liveRes = await fetch(`${metricsOrigin}/health/live`);
      expect(liveRes.status).toBe(200);
    } finally {
      await producerQueue.close();
    }
  });

  it('stop() cleanly removes heartbeat key and active-set entry and refuses connections', async () => {
    const tempQueueName = `ott-temp-queue-${randomUUID().slice(0, 8)}`;
    const tempRuntime = await startWorker({
      ...getBaseEnv(),
      OTT_MATCH_QUEUE: tempQueueName,
      OTT_WORKER_HEARTBEAT_MS: '1000',
    });
    const tempOrigin = `http://${tempRuntime.metricsServer!.host}:${tempRuntime.metricsServer!.port}`;
    const tempWorkerId = tempRuntime.pool.getWorkerId();

    const liveRes = await fetch(`${tempOrigin}/health/live`);
    expect(liveRes.status).toBe(200);

    const tempHeartbeatKey = `ott:worker:heartbeat:${tempWorkerId}`;
    await tempRuntime.stop();

    // Check heartbeat key deleted and removed from active-set
    const [rawPayload, isMember] = await Promise.all([
      redisClient.get(tempHeartbeatKey),
      redisClient.sismember('ott:worker:active-set', tempWorkerId),
    ]);
    expect(rawPayload).toBeNull();
    expect(isMember).toBe(0);

    // Port refuses connections
    await expect(fetch(`${tempOrigin}/health/live`)).rejects.toThrow();

    // Clean temp queue
    const tq = new Queue(tempQueueName, { connection: new Redis(redisUrl!, { maxRetriesPerRequest: null }) });
    await tq.obliterate({ force: true }).catch(() => undefined);
    await tq.close().catch(() => undefined);
  });

  it('fails fast on dead REDIS_URL during startup (< 8s) and closes DB pool sessions', { timeout: 10000 }, async () => {
    const badAppName = `ott_d32_badredis_${randomUUID().slice(0, 8)}`;
    const badUrl = new URL(scopedDbUrl);
    badUrl.searchParams.set('application_name', badAppName);

    const badRedisEnv = {
      ...getBaseEnv(),
      DATABASE_URL: badUrl.toString(),
      REDIS_URL: 'redis://127.0.0.1:1',
    };

    const startFailFast = Date.now();
    await expect(startWorker(badRedisEnv)).rejects.toThrow();
    const elapsed = Date.now() - startFailFast;
    expect(elapsed).toBeLessThan(8000);

    // Verify DB sessions closed
    const maxWait = Date.now() + 2000;
    let sessionCount = 0;
    while (Date.now() < maxWait) {
      const res = await adminDb.query<{ count: number }>(
        'SELECT count(*)::int as count FROM pg_stat_activity WHERE application_name = $1',
        [badAppName],
      );
      sessionCount = res.rows[0]?.count ?? 0;
      if (sessionCount === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(sessionCount).toBe(0);
  });

  it('rejects at startup when OTT_DOCKER_SOCKET does not exist and requireDocker=true', async () => {
    const badDockerEnv = {
      ...getBaseEnv(),
      OTT_DOCKER_SOCKET: '/nonexistent/docker.sock',
      OTT_WORKER_REQUIRE_DOCKER: 'true',
    };

    await expect(startWorker(badDockerEnv)).rejects.toThrow('DOCKER_UNAVAILABLE');
  });

  it('routeJob returns test-run for existing test_runs row and match for unknown UUID', async () => {
    const teamId = randomUUID();
    const submissionId = randomUUID();
    const testRunId = randomUUID();
    const digest = `sha256:${'a'.repeat(64)}`;

    await sharedRuntime.database.query(
      'INSERT INTO teams(id, name) VALUES ($1, $2)',
      [teamId, `Team ${testRunId.slice(0, 8)}`],
    );
    await sharedRuntime.database.query(
      `INSERT INTO submissions(id, team_id, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, status)
       VALUES ($1, $2, $3, $3, $3, $4, 'ACTIVE')`,
      [submissionId, teamId, digest, `secret/${submissionId}`],
    );
    await sharedRuntime.database.query(
      `INSERT INTO test_runs(id, team_id, submission_id, opponent_type, opponent_reference_bot, map_checksum, seed, status)
       VALUES ($1, $2, $3, 'BTC_REFERENCE', 'default-bot', $4, 'seed-123', 'QUEUED')`,
      [testRunId, teamId, submissionId, digest],
    );

    const testJob: MatchJobV1 = {
      schemaVersion: 'ott.match-job.v1',
      matchId: testRunId,
      idempotencyKey: randomUUID(),
      policyVersion: 'P2_BASELINE_V1',
      x: {
        submissionId,
        archiveSha256: digest,
        manifestDigest: digest,
        configDigest: digest,
        policyVersion: 'P2_BASELINE_V1',
      },
      o: {
        submissionId,
        archiveSha256: digest,
        manifestDigest: digest,
        configDigest: digest,
        policyVersion: 'P2_BASELINE_V1',
      },
    };

    const routedAsTest = await routeJob(testJob, { database: sharedRuntime.database });
    expect(routedAsTest).toBe('test-run');

    const randomMatchId = randomUUID();
    const matchJob: MatchJobV1 = {
      ...testJob,
      matchId: randomMatchId,
    };
    const routedAsMatch = await routeJob(matchJob, { database: sharedRuntime.database });
    expect(routedAsMatch).toBe('match');

    // Clean up deletable test_runs row
    await sharedRuntime.database.query('DELETE FROM test_runs WHERE id = $1', [testRunId]);
  });
});
