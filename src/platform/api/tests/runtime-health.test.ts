import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { createAuthApp } from '../src/app.ts';
import { devSecurityConfig, parseCidr } from '../src/config/security.ts';
import type { Database } from '../src/db/client.ts';
import type { RedisAuthCommands } from '../src/modules/auth/sessions.ts';
import { registerHealthRoutes, type HealthCheck, type HealthLogger } from '../src/runtime/health.ts';
import { createS3Storage } from '../src/storage/s3.ts';

function createMockRedis(): RedisAuthCommands & { ping(): Promise<string>; quit(): Promise<void> } {
  const store = new Map<string, string>();
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async set(key: string, value: string) { store.set(key, value); return 'OK'; },
    async del(key: string) { const existed = store.delete(key); return existed ? 1 : 0; },
    async incr() { return 1; },
    async expire() { return 1; },
    async sAdd() { return 1; },
    async sMembers() { return []; },
    async ping() { return 'PONG'; },
    async quit() { return undefined; },
  };
}

function createMockDatabase(): Database {
  return {
    async query() { return { rows: [], command: '', rowCount: 0, oid: 0, fields: [] }; },
    async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this); },
    async close() { return undefined; },
  };
}

describe('Runtime Health Routes (P3-D30)', () => {
  it('serves 200 {"status":"ok"} with Cache-Control: no-store on /health and /health/live', async () => {
    const app = Fastify();
    let shuttingDown = false;
    const checks: HealthCheck[] = [
      { name: 'failing_dep', check: async () => { throw new Error('DB DOWN'); } },
    ];

    registerHealthRoutes(app, {
      isShuttingDown: () => shuttingDown,
      checks,
    });
    await app.ready();

    // 1. /api/v1/health
    const res1 = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res1.statusCode).toBe(200);
    expect(res1.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res1.payload)).toEqual({ status: 'ok' });

    // 2. /api/v1/health/live
    const res2 = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res2.payload)).toEqual({ status: 'ok' });

    // 3. Remains 200 even when shutting down
    shuttingDown = true;
    const res3 = await app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(res3.statusCode).toBe(200);
    expect(JSON.parse(res3.payload)).toEqual({ status: 'ok' });
  });

  it('serves 200 {"status":"ready"} on /health/ready when not shutting down and all checks pass', async () => {
    const app = Fastify();
    const checks: HealthCheck[] = [
      { name: 'db', check: async () => {} },
      { name: 'redis', check: async () => {} },
      { name: 's3', check: async () => {} },
    ];

    registerHealthRoutes(app, {
      isShuttingDown: () => false,
      checks,
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.payload)).toEqual({ status: 'ready' });
  });

  it('serves 503 {"status":"not_ready"} immediately on /health/ready when shutting down', async () => {
    const app = Fastify();
    let shuttingDown = true;
    const checkFn = vi.fn().mockResolvedValue(undefined);

    registerHealthRoutes(app, {
      isShuttingDown: () => shuttingDown,
      checks: [{ name: 'db', check: checkFn }],
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.payload)).toEqual({ status: 'not_ready' });
    // When shutting down, checks should not even need to be called
    expect(checkFn).not.toHaveBeenCalled();
  });

  it('serves 503 {"status":"not_ready"} when any check throws and logs failing check name', async () => {
    const app = Fastify();
    const logger: HealthLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const checks: HealthCheck[] = [
      { name: 'postgres', check: async () => {} },
      { name: 'redis', check: async () => { throw new Error('CONNECTION_REFUSED'); } },
    ];

    registerHealthRoutes(app, {
      isShuttingDown: () => false,
      checks,
      logger,
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.payload)).toEqual({ status: 'not_ready' });

    // Verify response body leaks NO internal error messages, stack traces, or check names
    expect(res.payload).not.toContain('CONNECTION_REFUSED');
    expect(res.payload).not.toContain('redis');

    // Verify failing check name is logged server-side
    expect(logger.warn).toHaveBeenCalledWith(
      'Readiness check failed',
      expect.objectContaining({ failedChecks: ['redis'] }),
    );
  });

  it('serves 503 {"status":"not_ready"} when a check times out (>2000ms)', async () => {
    const app = Fastify();
    const logger: HealthLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const checks: HealthCheck[] = [
      {
        name: 'slow_s3',
        check: () => new Promise<void>((resolve) => setTimeout(resolve, 2500)),
      },
    ];

    registerHealthRoutes(app, {
      isShuttingDown: () => false,
      checks,
      logger,
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.payload)).toEqual({ status: 'not_ready' });
    expect(logger.warn).toHaveBeenCalledWith(
      'Readiness check failed',
      expect.objectContaining({ failedChecks: ['slow_s3'] }),
    );
  }, 10000);

  it('is reachable without a cookie from non-allowlisted IP through real createAuthApp', async () => {
    const redis = createMockRedis();
    const database = createMockDatabase();

    const security = {
      ...devSecurityConfig(),
      adminAllowlist: [parseCidr('10.0.0.1/32')],
      trustedProxies: [parseCidr('127.0.0.1/32')],
      trustedProxiesConfigured: true,
    };

    const app = createAuthApp({
      database,
      redis,
      security,
      secureCookies: false,
    });

    registerHealthRoutes(app, {
      isShuttingDown: () => false,
      checks: [
        { name: 'db', check: async () => {} },
        { name: 'redis', check: async () => {} },
      ],
    });
    await app.ready();

    // Request from non-allowlisted client IP (192.168.1.100 forwarded by 127.0.0.1)
    const headers = { 'x-forwarded-for': '192.168.1.100' };

    const liveRes = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers,
    });
    expect(liveRes.statusCode).toBe(200);
    expect(JSON.parse(liveRes.payload)).toEqual({ status: 'ok' });

    const readyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/health/ready',
      headers,
    });
    expect(readyRes.statusCode).toBe(200);
    expect(JSON.parse(readyRes.payload)).toEqual({ status: 'ready' });

    // An admin endpoint from the same non-allowlisted IP would return 403
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/rounds',
      headers,
    });
    expect(adminRes.statusCode).toBe(403);
  });

  it('createS3Storage ping sends HeadBucketCommand', async () => {
    const mockSend = vi.fn().mockResolvedValue({});
    const fakeClient = { send: mockSend } as any;

    const storage = createS3Storage({ client: fakeClient, bucket: 'my-bucket' });
    expect(typeof storage.ping).toBe('function');

    await storage.ping!();
    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentCommand = mockSend.mock.calls[0]?.[0] as any;
    expect(sentCommand?.constructor.name).toBe('HeadBucketCommand');
    expect(sentCommand?.input).toEqual({ Bucket: 'my-bucket' });
  });
});
