import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Database, ObjectStorage } from '@ott/platform-api';
import type { MatchJobV1 } from '@ott/job-contract';
import type { WorkerRuntimeConfig } from '../src/runtime/config.ts';
import {
  createWorkerRuntime,
  startWorker,
  routeJob,
  createRedisReconnectStrategy,
  WorkerRuntimeShutdownError,
  type WorkerRuntimeDependencies,
} from '../src/runtime/server.ts';
import type { WorkerPool, WorkerPoolOptions } from '../src/worker-pool.ts';
import type { WorkerMetricsServer, WorkerMetricsServerOptions } from '../src/runtime/metrics-server.ts';

const baseConfig: WorkerRuntimeConfig = {
  databaseUrl: 'postgresql://postgres:secret@127.0.0.1:5432/ott_test',
  redisUrl: 'redis://:supersecret@127.0.0.1:6379/0',
  s3: {
    endpoint: 'http://127.0.0.1:8333',
    region: 'us-east-1',
    bucket: 'ott-bucket',
    accessKeyId: 'admin-key',
    secretAccessKey: 'topsecretkey',
  },
  queueName: 'ott.match.v1',
  deadLetterQueueName: 'ott.match.dead-letter.v1',
  concurrency: { max: 4, min: 1 },
  heartbeatIntervalMs: 5000,
  heartbeatTtlSeconds: 15,
  metrics: { host: '127.0.0.1', port: 9464 },
  dockerSocketPath: '/var/run/docker.sock',
  requireDocker: true,
  shutdownTimeoutMs: 100,
};

function createMockFakes(order: string[] = []) {
  const dbClose = vi.fn().mockImplementation(async () => {
    order.push('db.close');
  });
  const mockDb: Database = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn(),
    close: dbClose,
  } as unknown as Database;

  const s3Destroy = vi.fn().mockImplementation(() => {
    order.push('s3.destroy');
  });
  const mockStorage: ObjectStorage = {
    get: vi.fn(),
    put: vi.fn(),
    copy: vi.fn(),
    remove: vi.fn(),
  } as unknown as ObjectStorage;

  const redisQuit = vi.fn().mockImplementation(async () => {
    order.push('redis.quit');
  });
  const mockRedis = {
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: redisQuit,
    disconnect: vi.fn(),
  };

  let activeCount = 0;
  let poolStarted = false;
  let pausedReason: string | undefined;

  const mockPool: WorkerPool = {
    start: vi.fn().mockImplementation(async () => {
      order.push('pool.start');
      poolStarted = true;
    }),
    pause: vi.fn().mockImplementation(async (reason?: string) => {
      order.push(`pool.pause:${reason}`);
      pausedReason = reason;
    }),
    resume: vi.fn(),
    isPaused: vi.fn().mockImplementation(() => pausedReason !== undefined),
    getActiveCount: vi.fn().mockImplementation(() => activeCount),
    getCapacity: vi.fn().mockReturnValue(4),
    getWorkerId: vi.fn().mockReturnValue('worker-test-123'),
    close: vi.fn().mockImplementation(async () => {
      order.push('pool.close');
    }),
  } as unknown as WorkerPool;

  const mockMetricsServer: WorkerMetricsServer = {
    host: '127.0.0.1',
    port: 9464,
    listen: vi.fn().mockImplementation(async () => {
      order.push('metrics.listen');
    }),
    close: vi.fn().mockImplementation(async () => {
      order.push('metrics.close');
    }),
  };

  let capturedProcessMatch: WorkerPoolOptions['processMatch'] | undefined;

  const deps: WorkerRuntimeDependencies = {
    createDatabase: vi.fn().mockImplementation(async () => {
      order.push('db.create');
      return mockDb;
    }),
    createS3: vi.fn().mockImplementation(async () => {
      order.push('s3.create');
      return { storage: mockStorage, client: { destroy: s3Destroy } };
    }),
    createRedisClient: vi.fn().mockImplementation(async () => {
      order.push('redis.create');
      return mockRedis as any;
    }),
    pingDocker: vi.fn().mockImplementation(async () => {
      order.push('docker.ping');
      return true;
    }),
    createPool: vi.fn().mockImplementation(async (opts: WorkerPoolOptions) => {
      order.push('pool.create');
      capturedProcessMatch = opts.processMatch;
      return mockPool;
    }),
    createMetricsServer: vi.fn().mockImplementation(async () => {
      order.push('metrics.create');
      return mockMetricsServer;
    }),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };

  return {
    deps,
    mockDb,
    mockStorage,
    mockRedis,
    mockPool,
    mockMetricsServer,
    order,
    setActiveCount: (count: number) => {
      activeCount = count;
    },
    isPoolStarted: () => poolStarted,
    getCapturedProcessMatch: () => capturedProcessMatch,
  };
}

describe('Worker Runtime Lifecycle & Routing (P3-D32)', () => {
  it('follows strict start order and readiness is true only after pool.start resolves', async () => {
    const order: string[] = [];
    const fakes = createMockFakes(order);

    const runtime = await createWorkerRuntime(baseConfig, fakes.deps);

    expect(order).toEqual([
      'db.create',
      's3.create',
      'redis.create',
      'docker.ping',
      'pool.create',
      'metrics.create',
      'metrics.listen',
      'pool.start',
    ]);
    expect(runtime.isReady()).toBe(true);
    expect(runtime.getDockerStatus()).toBe('up');
  });

  describe('startup failure cleans up opened resources in true reverse order', () => {
    it.each([
      { failAt: 1, name: 'S3 failure cleans up DB' },
      { failAt: 2, name: 'Redis failure cleans up S3 and DB' },
      { failAt: 3, name: 'Docker failure cleans up Redis, S3 and DB' },
      { failAt: 4, name: 'Pool create failure cleans up Redis, S3 and DB' },
      { failAt: 5, name: 'Metrics listen failure cleans up pool, Redis, S3, and DB' },
      { failAt: 6, name: 'Pool start failure cleans up metrics, pool, Redis, S3, and DB' },
    ])('$name', async ({ failAt }) => {
      const order: string[] = [];
      const fakes = createMockFakes(order);

      if (failAt === 1) {
        fakes.deps = {
          ...fakes.deps,
          createS3: vi.fn().mockRejectedValue(new Error('S3_FAIL')),
        };
      } else if (failAt === 2) {
        fakes.deps = {
          ...fakes.deps,
          createRedisClient: vi.fn().mockRejectedValue(new Error('REDIS_FAIL')),
        };
      } else if (failAt === 3) {
        fakes.deps = {
          ...fakes.deps,
          pingDocker: vi.fn().mockResolvedValue(false), // fails since requireDocker=true
        };
      } else if (failAt === 4) {
        fakes.deps = {
          ...fakes.deps,
          createPool: vi.fn().mockRejectedValue(new Error('POOL_FAIL')),
        };
      } else if (failAt === 5) {
        fakes.deps = {
          ...fakes.deps,
          createMetricsServer: vi.fn().mockResolvedValue({
            host: '127.0.0.1',
            port: 9464,
            listen: vi.fn().mockRejectedValue(new Error('METRICS_FAIL')),
            close: vi.fn().mockImplementation(async () => {
              order.push('metrics.close');
            }),
          }),
        };
      } else if (failAt === 6) {
        fakes.deps = {
          ...fakes.deps,
          createPool: vi.fn().mockImplementation(async () => ({
            ...fakes.mockPool,
            start: vi.fn().mockRejectedValue(new Error('POOL_START_FAIL')),
          })),
        };
      }

      await expect(createWorkerRuntime(baseConfig, fakes.deps)).rejects.toThrow();

      // Check reverse order of closes
      const closes = order.filter((o) => o.includes('.close') || o.includes('.destroy') || o.includes('.quit'));
      if (failAt === 1) {
        expect(closes).toEqual(['db.close']);
      } else if (failAt === 2) {
        expect(closes).toEqual(['s3.destroy', 'db.close']);
      } else if (failAt === 3 || failAt === 4) {
        expect(closes).toEqual(['redis.quit', 's3.destroy', 'db.close']);
      } else if (failAt === 5 || failAt === 6) {
        expect(closes).toEqual(['metrics.close', 'pool.close', 'redis.quit', 's3.destroy', 'db.close']);
      }
    });
  });

  it('fails start when Docker is unavailable and requireDocker is true', async () => {
    const fakes = createMockFakes();
    fakes.deps = {
      ...fakes.deps,
      pingDocker: vi.fn().mockResolvedValue(false),
    };

    await expect(createWorkerRuntime({ ...baseConfig, requireDocker: true }, fakes.deps)).rejects.toThrow(
      'DOCKER_UNAVAILABLE',
    );
  });

  it('starts successfully with docker: down when Docker is unavailable and requireDocker is false', async () => {
    const fakes = createMockFakes();
    fakes.deps = {
      ...fakes.deps,
      pingDocker: vi.fn().mockResolvedValue(false),
    };

    const runtime = await createWorkerRuntime({ ...baseConfig, requireDocker: false }, fakes.deps);
    expect(runtime.isReady()).toBe(true);
    expect(runtime.getDockerStatus()).toBe('down');
  });

  it('executes idempotent stop: pauses pool, waits for drain, closes in order', async () => {
    const order: string[] = [];
    const fakes = createMockFakes(order);
    const runtime = await createWorkerRuntime(baseConfig, fakes.deps);
    order.length = 0; // reset start order

    // Repeated stop() calls return same promise
    const p1 = runtime.stop();
    const p2 = runtime.stop();
    expect(p1).toBe(p2);

    await p1;

    expect(order).toEqual([
      'pool.pause:shutdown',
      'pool.close',
      'metrics.close',
      'redis.quit',
      's3.destroy',
      'db.close',
    ]);
    expect(runtime.isReady()).toBe(false);
  });

  it('waits for active matches to complete during stop drain', async () => {
    const order: string[] = [];
    const fakes = createMockFakes(order);
    fakes.setActiveCount(1);

    const runtime = await createWorkerRuntime(baseConfig, fakes.deps);

    // Simulate match completing after 60ms
    setTimeout(() => {
      fakes.setActiveCount(0);
    }, 60);

    await runtime.stop();
    expect(fakes.deps.logger?.warn).not.toHaveBeenCalledWith(
      'Shutdown timeout exceeded with active matches remaining',
      expect.anything(),
    );
  });

  it('logs count of remaining active matches when shutdown timeout is exceeded', async () => {
    const fakes = createMockFakes();
    fakes.setActiveCount(2);

    const runtime = await createWorkerRuntime({ ...baseConfig, shutdownTimeoutMs: 50 }, fakes.deps);
    await runtime.stop();

    expect(fakes.deps.logger?.warn).toHaveBeenCalledWith(
      'Shutdown timeout exceeded with active matches remaining',
      { count: 2 },
    );
  });

  it('stop() handles errors in individual steps without skipping subsequent steps', async () => {
    const order: string[] = [];
    const fakes = createMockFakes(order);
    fakes.mockPool.close = vi.fn().mockRejectedValue(new Error('POOL_CLOSE_ERR'));
    fakes.mockDb.close = vi.fn().mockRejectedValue(new Error('DB_CLOSE_ERR'));

    const runtime = await createWorkerRuntime(baseConfig, fakes.deps);

    await expect(runtime.stop()).rejects.toThrowError(WorkerRuntimeShutdownError);
    // Even though pool.close and db.close failed, s3.destroy, metrics.close, and redis.quit still ran
    expect(fakes.mockMetricsServer.close).toHaveBeenCalled();
    expect(fakes.mockRedis.quit).toHaveBeenCalled();
    expect(fakes.mockDb.close).toHaveBeenCalled();
  });

  it('registers SIGTERM and SIGINT signal handlers once on startWorker', async () => {
    const emitter = new EventEmitter();
    const exitFn = vi.fn();
    const fakes = createMockFakes();
    fakes.deps = {
      ...fakes.deps,
      processEmitter: emitter,
      exit: exitFn,
    };

    const env = {
      DATABASE_URL: baseConfig.databaseUrl,
      REDIS_URL: baseConfig.redisUrl,
      S3_ENDPOINT: baseConfig.s3.endpoint,
      S3_BUCKET: baseConfig.s3.bucket,
      S3_ACCESS_KEY_ID: baseConfig.s3.accessKeyId,
      S3_SECRET_ACCESS_KEY: baseConfig.s3.secretAccessKey,
    };

    const runtime = await startWorker(env, fakes.deps);
    expect(emitter.listenerCount('SIGTERM')).toBe(1);
    expect(emitter.listenerCount('SIGINT')).toBe(1);

    // Trigger signal
    emitter.emit('SIGTERM');
    await new Promise((r) => setTimeout(r, 50));

    expect(exitFn).toHaveBeenCalledWith(0);
    expect(runtime.isReady()).toBe(false);
  });

  function assertNoCanaryInLogger(logger: any, canary: string) {
    for (const method of ['info', 'warn', 'error'] as const) {
      for (const call of logger[method].mock.calls) {
        for (const arg of call) {
          const text = typeof arg === 'string' ? arg : JSON.stringify(arg);
          expect(text).not.toContain(canary);
        }
      }
    }
  }

  describe('processMatch routing', () => {
    const sampleMatchJob: MatchJobV1 = {
      schemaVersion: 'ott.match-job.v1',
      matchId: '11111111-1111-4111-8111-111111111111',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      policyVersion: 'P2_BASELINE_V1',
      x: {
        submissionId: '22222222-2222-4222-8222-222222222222',
        archiveSha256: 'sha256:' + 'a'.repeat(64),
        manifestDigest: 'sha256:' + 'a'.repeat(64),
        configDigest: 'sha256:' + 'a'.repeat(64),
        policyVersion: 'P2_BASELINE_V1',
      },
      o: {
        submissionId: '33333333-3333-4333-8333-333333333333',
        archiveSha256: 'sha256:' + 'b'.repeat(64),
        manifestDigest: 'sha256:' + 'b'.repeat(64),
        configDigest: 'sha256:' + 'b'.repeat(64),
        policyVersion: 'P2_BASELINE_V1',
      },
    };

    it('routes to runMatchJob when no test_runs row exists (no row => match runner called with metrics)', async () => {
      const fakes = createMockFakes();
      const mockRunMatchJob = vi.fn().mockResolvedValue({ alreadyFinalized: false });
      const mockRunTestJob = vi.fn();
      (fakes.mockDb.query as any).mockResolvedValue({ rows: [] });
      fakes.deps = {
        ...fakes.deps,
        runMatchJob: mockRunMatchJob,
        runTestJob: mockRunTestJob,
      };

      await createWorkerRuntime(baseConfig, fakes.deps);
      const processMatch = fakes.getCapturedProcessMatch()!;

      await processMatch(sampleMatchJob, { attemptNumber: 1, maxAttempts: 3 });

      expect(fakes.mockDb.query).toHaveBeenCalledWith(
        'SELECT 1 FROM test_runs WHERE id = $1',
        [sampleMatchJob.matchId],
      );
      expect(mockRunMatchJob).toHaveBeenCalledTimes(1);
      expect(mockRunMatchJob).toHaveBeenCalledWith(
        expect.objectContaining({
          job: sampleMatchJob,
          attempt: { attemptNumber: 1, maxAttempts: 3 },
          metrics: expect.anything(),
        }),
      );
      expect(mockRunTestJob).not.toHaveBeenCalled();
    });

    it('routes to runTestJob when test_runs row exists (row => test runner called with testRunId and metrics)', async () => {
      const fakes = createMockFakes();
      const mockRunMatchJob = vi.fn();
      const mockRunTestJob = vi.fn().mockResolvedValue({ alreadyFinished: false });
      (fakes.mockDb.query as any).mockImplementation(async (sql: string, params: any[]) => {
        if (sql === 'SELECT 1 FROM test_runs WHERE id = $1' && params[0] === sampleMatchJob.matchId) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      });
      fakes.deps = {
        ...fakes.deps,
        runMatchJob: mockRunMatchJob,
        runTestJob: mockRunTestJob,
      };

      await createWorkerRuntime(baseConfig, fakes.deps);
      const processMatch = fakes.getCapturedProcessMatch()!;

      await processMatch(sampleMatchJob, { attemptNumber: 1, maxAttempts: 3 });

      expect(fakes.mockDb.query).toHaveBeenCalledWith(
        'SELECT 1 FROM test_runs WHERE id = $1',
        [sampleMatchJob.matchId],
      );
      expect(mockRunTestJob).toHaveBeenCalledTimes(1);
      expect(mockRunTestJob).toHaveBeenCalledWith(
        expect.objectContaining({
          testRunId: sampleMatchJob.matchId,
          metrics: expect.anything(),
        }),
      );
      expect(mockRunMatchJob).not.toHaveBeenCalled();
    });

    it('propagates lookup error and calls neither runner when database lookup throws', async () => {
      const fakes = createMockFakes();
      const mockRunMatchJob = vi.fn();
      const mockRunTestJob = vi.fn();
      (fakes.mockDb.query as any).mockRejectedValue(new Error('DATABASE_CONNECTION_REFUSED'));
      fakes.deps = {
        ...fakes.deps,
        runMatchJob: mockRunMatchJob,
        runTestJob: mockRunTestJob,
      };

      await createWorkerRuntime(baseConfig, fakes.deps);
      const processMatch = fakes.getCapturedProcessMatch()!;

      await expect(processMatch(sampleMatchJob, { attemptNumber: 1, maxAttempts: 3 })).rejects.toThrow(
        'DATABASE_CONNECTION_REFUSED',
      );
      expect(mockRunMatchJob).not.toHaveBeenCalled();
      expect(mockRunTestJob).not.toHaveBeenCalled();
    });

    it('routeJob executes exact parameterized query SELECT 1 FROM test_runs WHERE id = $1', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      } as unknown as Database;

      const result = await routeJob(sampleMatchJob, { database: mockDb });
      expect(result).toBe('test-run');
      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT 1 FROM test_runs WHERE id = $1',
        [sampleMatchJob.matchId],
      );
    });
  });

  describe('createRedisReconnectStrategy', () => {
    it('returns null before ready (fail fast at startup)', () => {
      const reconnect = createRedisReconnectStrategy();
      expect(reconnect.isConnected()).toBe(false);
      expect(reconnect.strategy(1)).toBeNull();
      expect(reconnect.strategy(2)).toBeNull();
      expect(reconnect.strategy(10)).toBeNull();
    });

    it('returns bounded backoff after ready (Math.min(times * 100, 3000))', () => {
      const reconnect = createRedisReconnectStrategy();
      reconnect.markConnected();
      expect(reconnect.isConnected()).toBe(true);
      expect(reconnect.strategy(1)).toBe(100);
      expect(reconnect.strategy(5)).toBe(500);
      expect(reconnect.strategy(10)).toBe(1000);
      expect(reconnect.strategy(30)).toBe(3000);
      expect(reconnect.strategy(50)).toBe(3000);
    });
  });

  describe('fixed-message error logging and secret canary protection', () => {
    it('startup failure never leaks error message or canary in logger arguments', async () => {
      const canary = 'secret_host_canary';
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const fakes = createMockFakes();
      fakes.deps = {
        ...fakes.deps,
        logger: mockLogger,
        createDatabase: vi.fn().mockRejectedValue(new Error(`Failed to connect with ${canary}`)),
      };

      await expect(createWorkerRuntime(baseConfig, fakes.deps)).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith('worker startup failed', expect.anything());
      assertNoCanaryInLogger(mockLogger, canary);
    });

    it('each stop step failure never leaks error message or canary in logger arguments', async () => {
      const canary = 'secret_host_canary';
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const fakes = createMockFakes();
      fakes.deps = {
        ...fakes.deps,
        logger: mockLogger,
      };
      fakes.mockPool.pause = vi.fn().mockRejectedValue(new Error(`pause failed with ${canary}`));
      fakes.mockPool.close = vi.fn().mockRejectedValue(new Error(`pool.close failed with ${canary}`));
      fakes.mockMetricsServer.close = vi.fn().mockRejectedValue(new Error(`metrics.close failed with ${canary}`));
      fakes.mockRedis.quit = vi.fn().mockRejectedValue(new Error(`redis.quit failed with ${canary}`));
      (fakes.deps as any).createS3 = vi.fn().mockResolvedValue({
        storage: (fakes as any).mockStorage,
        client: {
          destroy: vi.fn().mockImplementation(() => {
            throw new Error(`s3.destroy failed with ${canary}`);
          }),
        },
      });
      fakes.mockDb.close = vi.fn().mockRejectedValue(new Error(`db.close failed with ${canary}`));

      const runtime = await createWorkerRuntime(baseConfig, fakes.deps);
      await expect(runtime.stop()).rejects.toThrowError(WorkerRuntimeShutdownError);

      expect(mockLogger.error).toHaveBeenCalledWith('worker stop step failed', { step: 'pool.pause' });
      expect(mockLogger.error).toHaveBeenCalledWith('worker stop step failed', { step: 'pool.close' });
      expect(mockLogger.error).toHaveBeenCalledWith('worker stop step failed', { step: 'metricsServer.close' });
      expect(mockLogger.error).toHaveBeenCalledWith('worker stop step failed', { step: 'redisClient.quit' });
      expect(mockLogger.error).toHaveBeenCalledWith('worker stop step failed', { step: 's3Client.destroy' });
      expect(mockLogger.error).toHaveBeenCalledWith('worker stop step failed', { step: 'database.close' });
      assertNoCanaryInLogger(mockLogger, canary);
    });

    it('signal handler failure never leaks error message or canary in logger arguments', async () => {
      const canary = 'secret_host_canary';
      const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const emitter = new EventEmitter();
      const exitFn = vi.fn();
      const fakes = createMockFakes();
      fakes.deps = {
        ...fakes.deps,
        logger: mockLogger,
        processEmitter: emitter,
        exit: exitFn,
      };
      fakes.mockPool.close = vi.fn().mockRejectedValue(new Error(`shutdown failed with ${canary}`));

      const env = {
        DATABASE_URL: baseConfig.databaseUrl,
        REDIS_URL: baseConfig.redisUrl,
        S3_ENDPOINT: baseConfig.s3.endpoint,
        S3_BUCKET: baseConfig.s3.bucket,
        S3_ACCESS_KEY_ID: baseConfig.s3.accessKeyId,
        S3_SECRET_ACCESS_KEY: baseConfig.s3.secretAccessKey,
      };

      await startWorker(env, fakes.deps);
      emitter.emit('SIGTERM');
      await new Promise((r) => setTimeout(r, 50));

      expect(exitFn).toHaveBeenCalledWith(1);
      expect(mockLogger.error).toHaveBeenCalledWith('worker shutdown failed');
      assertNoCanaryInLogger(mockLogger, canary);
    });
  });
});
