import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CoordinatorLoopRunner,
  CoordinatorMetrics,
  createCoordinatorRuntime,
  createDefaultAdvisoryLockHandle,
  loadCoordinatorConfig,
  type AdvisoryLockHandle,
  type CoordinatorConfig,
  type CoordinatorDependencies,
} from '../src/index.ts';

const VALID_BASE_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1:5432/ott_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_BUCKET: 'ott-submissions-test',
  S3_ACCESS_KEY_ID: 'minio-admin',
  S3_SECRET_ACCESS_KEY: 'minio-secret',
  OTT_COORD_METRICS_PORT: '0', // Ephemeral port for test HTTP server
  OTT_COORD_REQUIRE_DOCKER: 'false',
};

async function httpGet(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: data,
        });
      });
    }).on('error', reject);
  });
}

describe('Coordinator Lifecycle & Leadership (P2-T32)', () => {
  let config: CoordinatorConfig;

  beforeEach(() => {
    config = loadCoordinatorConfig(VALID_BASE_ENV);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs as active when advisory lock is acquired, stays standby when not acquired (Mutation 6 guard)', async () => {
    let connectionLossCallback1: (() => void) | undefined;
    let lockAcquired1 = true;

    const fakeLockHandle1: AdvisoryLockHandle = {
      tryLock: vi.fn().mockImplementation(async () => lockAcquired1),
      unlock: vi.fn().mockResolvedValue(undefined),
      onConnectionLoss: (cb) => {
        connectionLossCallback1 = cb;
      },
      close: vi.fn().mockResolvedValue(undefined),
    };

    let lockAcquired2 = false;
    const fakeLockHandle2: AdvisoryLockHandle = {
      tryLock: vi.fn().mockImplementation(async () => lockAcquired2),
      unlock: vi.fn().mockResolvedValue(undefined),
      onConnectionLoss: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    const mockStorage = { head: vi.fn().mockResolvedValue({}) } as any;
    const mockRedis = { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK') } as any;
    const mockQueue = { close: vi.fn().mockResolvedValue(undefined) } as any;

    // 1. Instance 1 acquires lock -> ACTIVE
    const coordinator1 = await createCoordinatorRuntime(config, {
      createDatabase: () => mockDb,
      createS3: () => ({ storage: mockStorage }),
      createRedisClient: () => mockRedis,
      createQueue: () => mockQueue,
      pingDocker: async () => true,
      createLockHandle: () => fakeLockHandle1,
    });
    expect(coordinator1.getRole()).toBe('active');
    expect(coordinator1.metrics.getRole()).toBe('active');

    // 2. Instance 2 fails to acquire lock -> STANDBY (Mutation 6 guard: two actives prevented!)
    const coordinator2 = await createCoordinatorRuntime(config, {
      createDatabase: () => mockDb,
      createS3: () => ({ storage: mockStorage }),
      createRedisClient: () => mockRedis,
      createQueue: () => mockQueue,
      pingDocker: async () => true,
      createLockHandle: () => fakeLockHandle2,
    });
    expect(coordinator2.getRole()).toBe('standby');
    expect(coordinator2.metrics.getRole()).toBe('standby');

    // 3. Instance 1 loses connection -> drops to STANDBY
    connectionLossCallback1!();
    expect(coordinator1.getRole()).toBe('standby');
    expect(coordinator1.metrics.getRole()).toBe('standby');

    await coordinator1.stop();
    await coordinator2.stop();
  });

  it('serves Prometheus metrics and live/ready health checks over HTTP', async () => {
    const fakeLockHandle: AdvisoryLockHandle = {
      tryLock: vi.fn().mockResolvedValue(true),
      unlock: vi.fn().mockResolvedValue(undefined),
      onConnectionLoss: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    const mockStorage = { head: vi.fn().mockResolvedValue({}) } as any;
    const mockRedis = { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK') } as any;
    const mockQueue = { close: vi.fn().mockResolvedValue(undefined) } as any;

    const coordinator = await createCoordinatorRuntime(config, {
      createDatabase: () => mockDb,
      createS3: () => ({ storage: mockStorage }),
      createRedisClient: () => mockRedis,
      createQueue: () => mockQueue,
      pingDocker: async () => true,
      createLockHandle: () => fakeLockHandle,
    });

    const port = coordinator.metricsServer!.port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Test /health/live
    const liveRes = await httpGet(`${baseUrl}/health/live`);
    expect(liveRes.statusCode).toBe(200);
    expect(JSON.parse(liveRes.body)).toEqual({ status: 'ok' });

    // Test /health/ready (active role)
    const readyRes = await httpGet(`${baseUrl}/health/ready`);
    expect(readyRes.statusCode).toBe(200);
    expect(JSON.parse(readyRes.body)).toEqual({ status: 'ready', role: 'active' });

    // Test /metrics scrape format
    coordinator.metrics.incrementIterations('dispatch');
    coordinator.metrics.addProcessed('dispatch', 5);

    const metricsRes = await httpGet(`${baseUrl}/metrics`);
    expect(metricsRes.statusCode).toBe(200);
    expect(metricsRes.headers['content-type']).toContain('text/plain');
    expect(metricsRes.body).toMatch(/ott_coordinator_loop_iterations_total\{loop="dispatch"\} [1-9]\d*/);
    expect(metricsRes.body).toContain('ott_coordinator_processed_total{loop="dispatch"} 5');
    expect(metricsRes.body).toContain('ott_coordinator_role{role="active"} 1');
    expect(metricsRes.body).toContain('ott_coordinator_role{role="standby"} 0');

    await coordinator.stop();
  });

  it('fails readiness with 503 without details when database dependency is down', async () => {
    const fakeLockHandle: AdvisoryLockHandle = {
      tryLock: vi.fn().mockResolvedValue(false),
      unlock: vi.fn().mockResolvedValue(undefined),
      onConnectionLoss: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockDb = {
      query: vi.fn().mockRejectedValue(new Error('DB_DOWN')),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    const mockStorage = { head: vi.fn().mockResolvedValue({}) } as any;
    const mockRedis = { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK') } as any;
    const mockQueue = { close: vi.fn().mockResolvedValue(undefined) } as any;

    const coordinator = await createCoordinatorRuntime(config, {
      createDatabase: () => mockDb,
      createS3: () => ({ storage: mockStorage }),
      createRedisClient: () => mockRedis,
      createQueue: () => mockQueue,
      pingDocker: async () => true,
      createLockHandle: () => fakeLockHandle,
    });

    const port = coordinator.metricsServer!.port;
    const readyRes = await httpGet(`http://127.0.0.1:${port}/health/ready`);

    expect(readyRes.statusCode).toBe(503);
    expect(JSON.parse(readyRes.body)).toEqual({ status: 'not_ready' });

    await coordinator.stop();
  });

  it('enforces idempotent shutdown and waits for in-flight iterations bounded by timeout (Mutation 7 guard)', async () => {
    const fakeLockHandle: AdvisoryLockHandle = {
      tryLock: vi.fn().mockResolvedValue(true),
      unlock: vi.fn().mockResolvedValue(undefined),
      onConnectionLoss: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    const mockStorage = { head: vi.fn().mockResolvedValue({}) } as any;
    const mockRedis = { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK') } as any;
    const mockQueue = { close: vi.fn().mockResolvedValue(undefined) } as any;

    const coordinator = await createCoordinatorRuntime(
      {
        ...config,
        shutdownTimeoutMs: 200,
      },
      {
        createDatabase: () => mockDb,
        createS3: () => ({ storage: mockStorage }),
        createRedisClient: () => mockRedis,
        createQueue: () => mockQueue,
        pingDocker: async () => true,
        createLockHandle: () => fakeLockHandle,
      },
    );

    // Call stop twice concurrently: both must return the identical Promise
    const p1 = coordinator.stop();
    const p2 = coordinator.stop();
    expect(p1).toBe(p2);
    await p1;

    expect(mockQueue.close).toHaveBeenCalledTimes(1);
    expect(mockDb.close).toHaveBeenCalledTimes(1);
    expect(fakeLockHandle.close).toHaveBeenCalledTimes(1);
  });

  it('waits for in-flight loop iterations during shutdown (Mutation 7 guard)', async () => {
    let inFlightFinished = false;
    let finishInFlight: (() => void) | undefined;
    const slowIteration = new Promise<void>((resolve) => {
      finishInFlight = resolve;
    });

    const runner = new CoordinatorLoopRunner({
      loops: [
        {
          name: 'dispatch',
          intervalMs: 1000,
          run: async () => {
            await slowIteration;
            inFlightFinished = true;
          },
        },
      ],
      metrics: new CoordinatorMetrics(),
    });

    runner.resume();
    // Allow dispatch to enter in-flight
    await new Promise((r) => setTimeout(r, 10));
    expect(runner.getInFlightCount()).toBe(1);

    // Call stop() while iteration is in-flight
    let stopResolved = false;
    const stopPromise = runner.stop(1000).then(() => {
      stopResolved = true;
    });

    // Ensure stop() has NOT resolved yet because iteration is still running
    await new Promise((r) => setTimeout(r, 50));
    expect(stopResolved).toBe(false);
    expect(inFlightFinished).toBe(false);

    // Now complete the in-flight iteration
    finishInFlight!();
    await stopPromise;

    expect(stopResolved).toBe(true);
    expect(inFlightFinished).toBe(true);
  });

  it('never logs error.message or secrets into logger (Mutation 8 guard / Canary test)', async () => {
    const loggedCalls: string[] = [];
    const secretCanary = 'secret_host_canary_super_confidential';

    const testLogger = {
      info: vi.fn().mockImplementation((msg, ctx) => loggedCalls.push(`${msg} ${JSON.stringify(ctx ?? {})}`)),
      warn: vi.fn().mockImplementation((msg, ctx) => loggedCalls.push(`${msg} ${JSON.stringify(ctx ?? {})}`)),
      error: vi.fn().mockImplementation((msg, ctx) => loggedCalls.push(`${msg} ${JSON.stringify(ctx ?? {})}`)),
    };

    const fakeLockHandle: AdvisoryLockHandle = {
      tryLock: vi.fn().mockRejectedValue(new Error(secretCanary)),
      unlock: vi.fn().mockResolvedValue(undefined),
      onConnectionLoss: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    const mockStorage = { head: vi.fn().mockResolvedValue({}) } as any;
    const mockRedis = { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK') } as any;
    const mockQueue = { close: vi.fn().mockResolvedValue(undefined) } as any;

    // 1. Startup failure with canary error
    await expect(
      createCoordinatorRuntime(config, {
        createDatabase: () => {
          throw new Error(secretCanary);
        },
        logger: testLogger,
      }),
    ).rejects.toThrow();

    // 2. Loop error with canary error
    const coordinator = await createCoordinatorRuntime(config, {
      createDatabase: () => mockDb,
      createS3: () => ({ storage: mockStorage }),
      createRedisClient: () => mockRedis,
      createQueue: () => mockQueue,
      pingDocker: async () => true,
      createLockHandle: () => fakeLockHandle,
      dispatchScheduledMatches: () => {
        throw new Error(secretCanary);
      },
      logger: testLogger,
    });

    await coordinator.loopRunner.triggerIteration('dispatch');
    await coordinator.stop();

    // Verify secret canary NEVER appears in any logger call!
    expect(loggedCalls.length).toBeGreaterThan(0);
    for (const call of loggedCalls) {
      expect(call).not.toContain(secretCanary);
    }
  });

  it('rejects metrics that contain unsanitized sensitive tokens (assertMetricsSanitized)', async () => {
    const fakeLockHandle: AdvisoryLockHandle = {
      tryLock: vi.fn().mockResolvedValue(true),
      unlock: vi.fn().mockResolvedValue(undefined),
      onConnectionLoss: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any;
    const mockStorage = { head: vi.fn().mockResolvedValue({}) } as any;
    const mockRedis = { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK') } as any;
    const mockQueue = { close: vi.fn().mockResolvedValue(undefined) } as any;

    // Custom metrics object that attempts to poison the scrape with private key text
    const poisonedMetrics = {
      scrape: () => 'ott_coordinator_role 1\n# sensitive: -----BEGIN RSA PRIVATE KEY-----',
      setRole: vi.fn(),
      getRole: () => 'active' as const,
      incrementIterations: vi.fn(),
      incrementErrors: vi.fn(),
      recordSuccess: vi.fn(),
      addProcessed: vi.fn(),
    } as any;

    const coordinator = await createCoordinatorRuntime(config, {
      createDatabase: () => mockDb,
      createS3: () => ({ storage: mockStorage }),
      createRedisClient: () => mockRedis,
      createQueue: () => mockQueue,
      pingDocker: async () => true,
      createLockHandle: () => fakeLockHandle,
      metrics: poisonedMetrics,
    });

    const port = coordinator.metricsServer!.port;
    const metricsRes = await httpGet(`http://127.0.0.1:${port}/metrics`);

    // Must fail with 500 when metrics sanitization assertion fails!
    expect(metricsRes.statusCode).toBe(500);
    expect(metricsRes.body).toBe('Internal Server Error');

    await coordinator.stop();
  });

  describe('Advisory Lock Handle & Pool Client Lifecycle (Fake Pool)', () => {
    class FakePool {
      public readonly max = 2;
      public totalActive = 0;
      public connectCalls = 0;
      public clients: any[] = [];
      public shouldRejectConnect = false;

      async connect() {
        this.connectCalls++;
        if (this.shouldRejectConnect) {
          throw new Error('ECONNREFUSED: database connection refused');
        }
        if (this.totalActive >= this.max) {
          throw new Error('POOL_EXHAUSTED: max clients already allocated');
        }
        this.totalActive++;

        const handlers: Record<string, ((...args: any[]) => void)[]> = {};
        const client = {
          handlers,
          released: false,
          releaseArg: undefined as any,
          on: (event: string, handler: (...args: any[]) => void) => {
            handlers[event] = handlers[event] ?? [];
            handlers[event].push(handler);
            return client;
          },
          emit: (event: string, ...args: any[]) => {
            for (const h of handlers[event] ?? []) {
              h(...args);
            }
          },
          query: vi.fn().mockResolvedValue({ rows: [{ locked: true }] }),
          release: vi.fn((err?: any) => {
            if (!client.released) {
              client.released = true;
              client.releaseArg = err;
              this.totalActive--;
            }
          }),
        };
        this.clients.push(client);
        return client;
      }

      async end() {
        // cleanup
      }
    }

    it('releases client on error and end events before client is cleared', async () => {
      const fakePool = new FakePool();
      const handle = createDefaultAdvisoryLockHandle(fakePool as any);

      // 1. Acquire lock -> connects client 0
      const locked1 = await handle.tryLock();
      expect(locked1).toBe(true);
      expect(fakePool.clients.length).toBe(1);
      const client0 = fakePool.clients[0];
      expect(client0.released).toBe(false);

      // Trigger error event -> client0 must be released with error
      const testErr = new Error('connection reset by peer');
      client0.emit('error', testErr);
      expect(client0.release).toHaveBeenCalledWith(testErr);
      expect(client0.released).toBe(true);

      // 2. Re-acquire lock -> connects client 1
      const locked2 = await handle.tryLock();
      expect(locked2).toBe(true);
      expect(fakePool.clients.length).toBe(2);
      const client1 = fakePool.clients[1];
      expect(client1.released).toBe(false);

      // Trigger end event -> client1 must be released with true
      client1.emit('end');
      expect(client1.release).toHaveBeenCalledWith(true);
      expect(client1.released).toBe(true);

      await handle.close();
    });

    it('keeps coordinator in standby when connect is rejected', async () => {
      const fakePool = new FakePool();
      fakePool.shouldRejectConnect = true;

      const mockDb = { query: vi.fn().mockResolvedValue({ rows: [] }), close: vi.fn() } as any;
      const mockStorage = { head: vi.fn().mockResolvedValue({}) } as any;
      const mockRedis = { ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK') } as any;
      const mockQueue = { close: vi.fn().mockResolvedValue(undefined) } as any;

      const coordinator = await createCoordinatorRuntime(config, {
        createDatabase: () => mockDb,
        createS3: () => ({ storage: mockStorage }),
        createRedisClient: () => mockRedis,
        createQueue: () => mockQueue,
        pingDocker: async () => true,
        createLockHandle: () => createDefaultAdvisoryLockHandle(fakePool as any),
      });

      // Role must remain standby because pool.connect() rejected
      expect(coordinator.getRole()).toBe('standby');
      expect(coordinator.metrics.getRole()).toBe('standby');

      await coordinator.stop();
    });

    it('handles 2 connection losses on size-2 pool without exhausting it', async () => {
      const fakePool = new FakePool();
      const handle = createDefaultAdvisoryLockHandle(fakePool as any);

      // Acquisition 1
      const lock1 = await handle.tryLock();
      expect(lock1).toBe(true);
      expect(fakePool.totalActive).toBe(1);

      // Loss 1
      fakePool.clients[0].emit('error', new Error('loss 1'));
      expect(fakePool.clients[0].release).toHaveBeenCalled();
      expect(fakePool.totalActive).toBe(0);

      // Acquisition 2
      const lock2 = await handle.tryLock();
      expect(lock2).toBe(true);
      expect(fakePool.totalActive).toBe(1);

      // Loss 2
      fakePool.clients[1].emit('error', new Error('loss 2'));
      expect(fakePool.clients[1].release).toHaveBeenCalled();
      expect(fakePool.totalActive).toBe(0);

      // Acquisition 3 (on size-2 pool, this would fail if clients were leaked!)
      const lock3 = await handle.tryLock();
      expect(lock3).toBe(true);
      expect(fakePool.totalActive).toBe(1);
      expect(fakePool.connectCalls).toBe(3);

      await handle.close();
      expect(fakePool.totalActive).toBe(0);
    });
  });
});

