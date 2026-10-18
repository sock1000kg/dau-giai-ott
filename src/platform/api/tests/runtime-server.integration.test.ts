import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/db/client.ts';
import { startServer, type RuntimeServer } from '../src/runtime/server.ts';

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

integration('Runtime Server Integration (P3-D30)', () => {
  const schemaName = `runtime_test_${randomUUID().replaceAll('-', '')}`;
  let adminDb: Database;
  let scopedDbUrl: string;

  const btcUsername = `btc-admin-${randomUUID().slice(0, 8)}`;
  const btcPassword = `Password_${randomUUID()}_!`;

  let sharedRuntime: RuntimeServer;
  let origin: string;
  let sessionCookie: string;

  const getBaseEnv = (): Record<string, string> => ({
    DATABASE_URL: scopedDbUrl,
    REDIS_URL: redisUrl!,
    S3_ENDPOINT: s3Endpoint!,
    S3_BUCKET: s3Bucket!,
    S3_ACCESS_KEY_ID: s3AccessKeyId!,
    S3_SECRET_ACCESS_KEY: s3SecretAccessKey!,
    HOST: '127.0.0.1',
    PORT: '0',
    OTT_DEPLOYMENT_MODE: 'dev',
    OTT_BOOTSTRAP_BTC_USERNAME: btcUsername,
    OTT_BOOTSTRAP_BTC_PASSWORD: btcPassword,
  });

  beforeAll(async () => {
    adminDb = createDatabase({ connectionString: databaseUrl! });
    await adminDb.query(`CREATE SCHEMA "${schemaName}"`);

    const url = new URL(databaseUrl!);
    url.searchParams.set('options', `-c search_path=${schemaName}`);
    scopedDbUrl = url.toString();

    // Start shared runtime for tests 1–4
    sharedRuntime = await startServer({
      ...getBaseEnv(),
      OTT_RUN_MIGRATIONS: 'true',
    });
    origin = `http://${sharedRuntime.host}:${sharedRuntime.port}`;
  }, 30000);

  afterAll(async () => {
    if (sharedRuntime !== undefined) {
      await sharedRuntime.stop().catch(() => undefined);
    }
    if (adminDb !== undefined) {
      await adminDb.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
      await adminDb.close().catch(() => undefined);
    }
  });

  it('probes report healthy on running instance (GET /health/ready, /health/live)', async () => {
    const readyRes = await fetch(`${origin}/api/v1/health/ready`);
    expect(readyRes.status).toBe(200);
    expect(readyRes.headers.get('cache-control')).toBe('no-store');
    const readyBody = (await readyRes.json()) as any;
    expect(readyBody).toEqual({ status: 'ready' });

    const liveRes = await fetch(`${origin}/api/v1/health/live`);
    expect(liveRes.status).toBe(200);
    expect(liveRes.headers.get('cache-control')).toBe('no-store');
    const liveBody = (await liveRes.json()) as any;
    expect(liveBody).toEqual({ status: 'ok' });
  });

  it('authenticates bootstrap BTC admin and returns session with BTC_ADMIN role', async () => {
    const loginRes = await fetch(`${origin}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: btcUsername, password: btcPassword }),
    });
    expect(loginRes.status).toBe(200);

    const cookieHeader = loginRes.headers.get('set-cookie');
    expect(cookieHeader).toBeTruthy();
    sessionCookie = cookieHeader!.split(';')[0]!;

    const sessionRes = await fetch(`${origin}/api/v1/auth/session`, {
      headers: { Cookie: sessionCookie },
    });
    expect(sessionRes.status).toBe(200);
    const sessionBody = (await sessionRes.json()) as any;
    expect(sessionBody.data.role).toBe('BTC_ADMIN');
    expect(sessionBody.data.teamId ?? null).toBeNull();
  });

  it('allows authenticated BTC admin to query admin round rule sets', async () => {
    const adminRes = await fetch(
      `${origin}/api/v1/admin/round-rule-sets?tournamentStage=QUALIFICATION`,
      {
        headers: { Cookie: sessionCookie },
      },
    );
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as any;
    expect(adminBody.data).toHaveProperty('items');
  });

  it('creates exactly one BTC_ADMIN account matching bootstrap username in the database', async () => {
    const countRes = await sharedRuntime.database.query<{ count: number; role: string }>(
      'SELECT count(*)::int AS count, max(role) AS role FROM accounts WHERE username = $1',
      [btcUsername],
    );
    expect(countRes.rows[0]).toEqual({ count: 1, role: 'BTC_ADMIN' });
  });

  it('idempotently handles second startServer against existing database without duplicating admin', async () => {
    const runtime2: RuntimeServer = await startServer({
      ...getBaseEnv(),
      OTT_RUN_MIGRATIONS: 'false',
    });
    try {
      const countRes2 = await runtime2.database.query<{ count: number; role: string }>(
        'SELECT count(*)::int AS count, max(role) AS role FROM accounts WHERE username = $1',
        [btcUsername],
      );
      expect(countRes2.rows[0]).toEqual({ count: 1, role: 'BTC_ADMIN' });
    } finally {
      await runtime2.stop();
    }
  });

  it('refuses connections on bound port after stop() completes', async () => {
    const tempRuntime: RuntimeServer = await startServer({
      ...getBaseEnv(),
      OTT_RUN_MIGRATIONS: 'false',
    });
    const tempOrigin = `http://${tempRuntime.host}:${tempRuntime.port}`;

    const liveRes = await fetch(`${tempOrigin}/api/v1/health/live`);
    expect(liveRes.status).toBe(200);

    await tempRuntime.stop();
    await expect(fetch(`${tempOrigin}/api/v1/health/live`)).rejects.toThrow();
  });

  it('fails fast on dead REDIS_URL during startup within bounded time and cleans up DB pool', { timeout: 10_000 }, async () => {
    const badAppName = `ott_d30_badredis_${randomUUID().slice(0, 8)}`;
    const badUrl = new URL(scopedDbUrl);
    badUrl.searchParams.set('application_name', badAppName);

    const badRedisEnv = {
      ...getBaseEnv(),
      DATABASE_URL: badUrl.toString(),
      REDIS_URL: 'redis://127.0.0.1:1',
      OTT_RUN_MIGRATIONS: 'false',
    };

    const startFailFast = Date.now();
    await expect(startServer(badRedisEnv)).rejects.toThrow();
    const elapsed = Date.now() - startFailFast;
    expect(elapsed).toBeLessThan(8000);

    // Verify database pool cleanup by querying pg_stat_activity for leftover sessions
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
});
