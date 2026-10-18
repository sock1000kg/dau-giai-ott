import { EventEmitter } from 'node:events';
import fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import type { RedisAuthCommands } from '../src/modules/auth/sessions.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';
import { loadRuntimeConfig } from '../src/runtime/config.ts';
import {
  createRedisReconnectStrategy,
  createRuntime,
  RuntimeShutdownError,
  startServer,
  type RuntimeDependencies,
  type RuntimeLogger,
} from '../src/runtime/server.ts';

function validDevEnv(): Record<string, string> {
  return {
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/ott_test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
    OTT_DEPLOYMENT_MODE: 'dev',
    PORT: '0',
  };
}

describe('Runtime Server Lifecycle (P3-D30)', () => {
  it('records correct startup order and flips readiness only after listen resolves', async () => {
    const events: string[] = [];

    const mockDb: Database = {
      query: vi.fn().mockImplementation(async () => {
        events.push('db.query');
        return { rows: [] };
      }),
      transaction: vi.fn(),
      close: vi.fn().mockImplementation(async () => {
        events.push('db.close');
      }),
    };

    const mockRedis: RedisAuthCommands & { quit: () => Promise<void>; ping: () => Promise<string> } = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      incr: vi.fn(),
      expire: vi.fn(),
      sAdd: vi.fn(),
      sMembers: vi.fn(),
      ping: vi.fn().mockResolvedValue('PONG'),
      quit: vi.fn().mockImplementation(async () => {
        events.push('redis.quit');
      }),
    };

    const mockStorage: ObjectStorage = {
      put: vi.fn(),
      get: vi.fn(),
      copy: vi.fn(),
      remove: vi.fn(),
      ping: vi.fn().mockResolvedValue(undefined),
    };

    const mockS3Client = {
      destroy: vi.fn().mockImplementation(() => {
        events.push('s3.destroy');
      }),
    };

    const mockQueue = {
      enqueue: vi.fn(),
      close: vi.fn().mockImplementation(async () => {
        events.push('queue.close');
      }),
    };

    const mockApp = {
      server: {
        address: () => ({ address: '127.0.0.1', port: 12345 }),
      },
      ready: vi.fn().mockImplementation(async () => {
        events.push('app.ready');
      }),
      listen: vi.fn().mockImplementation(async () => {
        events.push('app.listen');
      }),
      close: vi.fn().mockImplementation(async () => {
        events.push('app.close');
      }),
      get: vi.fn(),
    };

    const config = loadRuntimeConfig({
      ...validDevEnv(),
      OTT_RUN_MIGRATIONS: 'true',
      OTT_BOOTSTRAP_BTC_USERNAME: 'admin',
      OTT_BOOTSTRAP_BTC_PASSWORD: 'password123',
    });

    const deps: RuntimeDependencies = {
      createDatabase: async () => {
        events.push('createDatabase');
        return mockDb;
      },
      runMigrations: async () => {
        events.push('runMigrations');
        return { applied: ['0001_init'] };
      },
      createRedis: async () => {
        events.push('createRedis');
        return mockRedis as any;
      },
      createS3: async () => {
        events.push('createS3');
        return { storage: mockStorage, client: mockS3Client };
      },
      createQueue: async () => {
        events.push('createQueue');
        return mockQueue as any;
      },
      bootstrapAdmin: async () => {
        events.push('bootstrapAdmin');
        return { accountId: 'acc-1', created: true };
      },
      createApp: () => {
        events.push('createApp');
        return mockApp as any;
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const runtime = await createRuntime(config, deps);

    expect(events).toEqual([
      'createDatabase',
      'runMigrations',
      'createRedis',
      'createS3',
      'createQueue',
      'bootstrapAdmin',
      'createApp',
      'app.ready',
      'app.listen',
    ]);
    expect(runtime.port).toBe(12345);
    expect(runtime.host).toBe('127.0.0.1');
    expect(runtime.isShuttingDown()).toBe(false);
  });

  it('skips bootstrap when bootstrap env variables are absent', async () => {
    const bootstrapMock = vi.fn();
    const config = loadRuntimeConfig(validDevEnv());

    const deps: RuntimeDependencies = {
      createDatabase: async () => ({ query: vi.fn(), transaction: vi.fn(), close: vi.fn() }),
      createRedis: async () => ({
        get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn(), sAdd: vi.fn(), sMembers: vi.fn(),
        ping: vi.fn(), quit: vi.fn(),
      } as any),
      createS3: async () => ({ storage: { put: vi.fn(), get: vi.fn(), copy: vi.fn(), remove: vi.fn() } }),
      createQueue: async () => ({ enqueue: vi.fn(), close: vi.fn() } as any),
      bootstrapAdmin: bootstrapMock,
      createApp: () => ({
        server: { address: () => ({ address: '127.0.0.1', port: 8080 }) },
        ready: vi.fn().mockResolvedValue(undefined),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        get: vi.fn(),
      } as any),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    await createRuntime(config, deps);
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  describe('parametrized startup-failure cleanup', () => {
    const failureCases = [
      {
        step: 'runMigrations',
        error: 'MIGRATIONS_FAILED',
        withMigrations: true,
        withBootstrap: false,
        expectedCloses: ['database.close'],
      },
      {
        step: 'createRedis',
        error: 'REDIS_CONNECT_FAILED',
        withMigrations: false,
        withBootstrap: false,
        expectedCloses: ['database.close'],
      },
      {
        step: 'createS3',
        error: 'S3_INITIALIZATION_FAILED',
        withMigrations: false,
        withBootstrap: false,
        expectedCloses: ['redis.quit', 'database.close'],
      },
      {
        step: 'createQueue',
        error: 'QUEUE_INITIALIZATION_FAILED',
        withMigrations: false,
        withBootstrap: false,
        expectedCloses: ['s3Client.destroy', 'redis.quit', 'database.close'],
      },
      {
        step: 'bootstrapAdmin',
        error: 'BOOTSTRAP_ADMIN_FAILED',
        withMigrations: false,
        withBootstrap: true,
        expectedCloses: ['queue.close', 's3Client.destroy', 'redis.quit', 'database.close'],
      },
      {
        step: 'createApp',
        error: 'CREATE_APP_FAILED',
        withMigrations: false,
        withBootstrap: false,
        expectedCloses: ['queue.close', 's3Client.destroy', 'redis.quit', 'database.close'],
      },
      {
        step: 'app.ready',
        error: 'APP_READY_FAILED',
        withMigrations: false,
        withBootstrap: false,
        expectedCloses: ['app.close', 'queue.close', 's3Client.destroy', 'redis.quit', 'database.close'],
      },
      {
        step: 'app.listen',
        error: 'APP_LISTEN_FAILED',
        withMigrations: false,
        withBootstrap: false,
        expectedCloses: ['app.close', 'queue.close', 's3Client.destroy', 'redis.quit', 'database.close'],
      },
    ];

    it.each(failureCases)(
      'closes opened resources in reverse order when step $step fails during startup',
      async ({ step, error, withMigrations, withBootstrap, expectedCloses }) => {
        const cleanupOrder: string[] = [];

        const mockDb: Database = {
          query: vi.fn(),
          transaction: vi.fn(),
          close: vi.fn().mockImplementation(async () => {
            cleanupOrder.push('database.close');
          }),
        };

        const mockRedis = {
          quit: vi.fn().mockImplementation(async () => {
            cleanupOrder.push('redis.quit');
          }),
          ping: vi.fn(),
        };

        const mockS3Client = {
          destroy: vi.fn().mockImplementation(() => {
            cleanupOrder.push('s3Client.destroy');
          }),
        };

        const mockQueue = {
          close: vi.fn().mockImplementation(async () => {
            cleanupOrder.push('queue.close');
          }),
        };

        const mockApp = {
          server: { address: () => ({ address: '127.0.0.1', port: 9000 }) },
          ready: vi.fn().mockImplementation(async () => {
            if (step === 'app.ready') throw new Error(error);
          }),
          listen: vi.fn().mockImplementation(async () => {
            if (step === 'app.listen') throw new Error(error);
          }),
          close: vi.fn().mockImplementation(async () => {
            cleanupOrder.push('app.close');
          }),
          get: vi.fn(),
        };

        const config = loadRuntimeConfig({
          ...validDevEnv(),
          OTT_RUN_MIGRATIONS: withMigrations ? 'true' : 'false',
          ...(withBootstrap
            ? { OTT_BOOTSTRAP_BTC_USERNAME: 'admin', OTT_BOOTSTRAP_BTC_PASSWORD: 'password' }
            : {}),
        });

        const deps: RuntimeDependencies = {
          createDatabase: async () => mockDb,
          runMigrations: async () => {
            if (step === 'runMigrations') throw new Error(error);
            return { applied: [] };
          },
          createRedis: async () => {
            if (step === 'createRedis') throw new Error(error);
            return mockRedis as any;
          },
          createS3: async () => {
            if (step === 'createS3') throw new Error(error);
            return { storage: {} as any, client: mockS3Client };
          },
          createQueue: async () => {
            if (step === 'createQueue') throw new Error(error);
            return mockQueue as any;
          },
          bootstrapAdmin: async () => {
            if (step === 'bootstrapAdmin') throw new Error(error);
            return { accountId: 'acc-1', created: true };
          },
          createApp: () => {
            if (step === 'createApp') throw new Error(error);
            return mockApp as any;
          },
          logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        };

        await expect(createRuntime(config, deps)).rejects.toThrow(error);

        // Verify full recorded order of close calls
        expect(cleanupOrder).toEqual(expectedCloses);

        // Verify each close called exactly once
        const allMocks = [
          { name: 'app.close', fn: mockApp.close },
          { name: 'queue.close', fn: mockQueue.close },
          { name: 's3Client.destroy', fn: mockS3Client.destroy },
          { name: 'redis.quit', fn: mockRedis.quit },
          { name: 'database.close', fn: mockDb.close },
        ];

        for (const m of allMocks) {
          if (expectedCloses.includes(m.name)) {
            expect(m.fn).toHaveBeenCalledTimes(1);
          } else {
            expect(m.fn).not.toHaveBeenCalled();
          }
        }
      },
    );
  });

  describe('createRedisReconnectStrategy', () => {
    it('returns false on retries before connected, and returns bounded delay <= 3000 after connected', () => {
      const controller = createRedisReconnectStrategy();
      expect(controller.isConnected()).toBe(false);

      // Before connected: stops reconnecting on initial connection failure
      expect(controller.strategy(1)).toBe(false);
      expect(controller.strategy(5)).toBe(false);

      // Mark connected on 'ready' event
      controller.markConnected();
      expect(controller.isConnected()).toBe(true);

      // After connected: bounded backoff
      const r1 = controller.strategy(1);
      const r2 = controller.strategy(2);
      const r100 = controller.strategy(100);

      expect(typeof r1).toBe('number');
      expect(r1).toBeGreaterThan(0);
      expect(r2).toBeGreaterThan(r1 as number);
      expect(r100).toBeLessThanOrEqual(3000);
      expect(r100).toBe(3000);
    });
  });

  it('handles redis error event without crashing, logs fixed message without URL/secrets, and reports not_ready', async () => {
    const redisEmitter = new EventEmitter();
    const redisPingMock = vi.fn().mockResolvedValue('PONG');
    Object.assign(redisEmitter, {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      incr: vi.fn(),
      expire: vi.fn(),
      sAdd: vi.fn(),
      sMembers: vi.fn(),
      ping: redisPingMock,
      quit: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
    });

    const loggedMessages: Array<{ level: string; msg: string; context?: any }> = [];
    const logger: RuntimeLogger = {
      info: (msg, ctx) => {
        loggedMessages.push({ level: 'info', msg, context: ctx });
      },
      warn: (msg, ctx) => {
        loggedMessages.push({ level: 'warn', msg, context: ctx });
      },
      error: (msg, ctx) => {
        loggedMessages.push({ level: 'error', msg, context: ctx });
      },
    };

    const realApp = fastify();

    const deps: RuntimeDependencies = {
      createDatabase: async () =>
        ({
          query: vi.fn().mockResolvedValue({ rows: [] }),
          transaction: vi.fn(),
          close: vi.fn(),
        } as any),
      createRedisClient: () => redisEmitter,
      createS3: async () => ({ storage: { ping: vi.fn().mockResolvedValue(undefined) } as any }),
      createQueue: async () => ({ close: vi.fn() } as any),
      createApp: () => realApp,
      logger,
    };

    const runtime = await createRuntime(loadRuntimeConfig(validDevEnv()), deps);
    expect(runtime).toBeDefined();

    // Default factory attaches exactly one 'error' listener before connect
    expect(redisEmitter.listenerCount('error')).toBe(1);

    // Initial probes before error
    const liveBefore = await runtime.app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(liveBefore.statusCode).toBe(200);
    expect(liveBefore.json()).toEqual({ status: 'ok' });

    const readyBefore = await runtime.app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(readyBefore.statusCode).toBe(200);
    expect(readyBefore.json()).toEqual({ status: 'ready' });

    // Emit error event with sensitive URL containing credentials
    const canary = 'secret_url_canary_credentials_12345';
    expect(() => {
      redisEmitter.emit('error', new Error(`ECONNRESET: redis://admin:${canary}@127.0.0.1:6379`));
    }).not.toThrow();

    // Redis ping now rejects
    redisPingMock.mockRejectedValue(new Error('CONNECTION_LOST'));

    // Verify logger was called with fixed message "redis client error"
    const warnCall = loggedMessages.find((m) => m.msg === 'redis client error');
    expect(warnCall).toBeDefined();

    // Verify NO logged message or context contains the secret canary
    for (const entry of loggedMessages) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(canary);
    }

    // Health probes after error: ready is 503 not_ready, live is 200 ok
    const readyAfter = await runtime.app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(readyAfter.statusCode).toBe(503);
    expect(readyAfter.json()).toEqual({ status: 'not_ready' });

    const liveAfter = await runtime.app.inject({ method: 'GET', url: '/api/v1/health/live' });
    expect(liveAfter.statusCode).toBe(200);
    expect(liveAfter.json()).toEqual({ status: 'ok' });

    await runtime.stop();
  });

  it('calls startServer with TOTP secret and ignores process.env, passing only bootstrap keys', async () => {
    const origSecret = process.env.OTT_BOOTSTRAP_BTC_TOTP_SECRET;
    process.env.OTT_BOOTSTRAP_BTC_TOTP_SECRET = 'B';

    let capturedOptions: any;
    const testEnv = {
      ...validDevEnv(),
      OTT_BOOTSTRAP_BTC_USERNAME: 'admin',
      OTT_BOOTSTRAP_BTC_PASSWORD: 'password123',
      OTT_BOOTSTRAP_BTC_TOTP_SECRET: 'A',
      OTT_TOTP_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    };

    const deps: RuntimeDependencies = {
      createDatabase: async () => ({ query: vi.fn(), transaction: vi.fn(), close: vi.fn() } as any),
      createRedis: async () => ({ get: vi.fn(), set: vi.fn(), ping: vi.fn(), quit: vi.fn() } as any),
      createS3: async () => ({ storage: {} as any }),
      createQueue: async () => ({ close: vi.fn() } as any),
      bootstrapAdmin: async (options) => {
        capturedOptions = options;
        return { accountId: 'acc-1', created: true };
      },
      createApp: () => ({
        server: { address: () => ({ address: '127.0.0.1', port: 8080 }) },
        ready: vi.fn().mockResolvedValue(undefined),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        get: vi.fn(),
      } as any),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    try {
      await startServer(testEnv, deps);
      expect(capturedOptions?.environment?.OTT_BOOTSTRAP_BTC_TOTP_SECRET).toBe('A');
      expect(Object.keys(capturedOptions?.environment).sort()).toEqual([
        'OTT_BOOTSTRAP_BTC_PASSWORD',
        'OTT_BOOTSTRAP_BTC_TOTP_SECRET',
        'OTT_BOOTSTRAP_BTC_USERNAME',
      ]);
    } finally {
      if (origSecret !== undefined) {
        process.env.OTT_BOOTSTRAP_BTC_TOTP_SECRET = origSecret;
      } else {
        delete process.env.OTT_BOOTSTRAP_BTC_TOTP_SECRET;
      }
    }
  });

  it('logs actual bound port when configured with PORT=0', async () => {
    const loggedLines: Array<{ message: string; context?: any }> = [];
    const logger: RuntimeLogger = {
      info: (message, context) => loggedLines.push({ message, context }),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const mockApp = {
      server: { address: () => ({ address: '127.0.0.1', port: 45123 }) },
      ready: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    };

    const deps: RuntimeDependencies = {
      createDatabase: async () => ({ query: vi.fn(), transaction: vi.fn(), close: vi.fn() } as any),
      createRedis: async () => ({ get: vi.fn(), set: vi.fn(), ping: vi.fn(), quit: vi.fn() } as any),
      createS3: async () => ({ storage: {} as any }),
      createQueue: async () => ({ close: vi.fn() } as any),
      createApp: () => mockApp as any,
      logger,
    };

    const runtime = await createRuntime(loadRuntimeConfig({ ...validDevEnv(), PORT: '0' }), deps);
    expect(runtime.port).toBe(45123);

    const listenLog = loggedLines.find((l) => l.message === 'server listening');
    expect(listenLog).toBeDefined();
    expect(listenLog?.context).toEqual({ host: '127.0.0.1', port: 45123 });
  });

  it('stops in correct order and is strictly idempotent', async () => {
    const stopEvents: string[] = [];

    const mockDb: Database = {
      query: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn().mockImplementation(async () => {
        stopEvents.push('database.close');
      }),
    };

    const mockRedis = {
      quit: vi.fn().mockImplementation(async () => {
        stopEvents.push('redis.quit');
      }),
      ping: vi.fn(),
    };

    const mockS3Client = {
      destroy: vi.fn().mockImplementation(() => {
        stopEvents.push('s3Client.destroy');
      }),
    };

    const mockQueue = {
      close: vi.fn().mockImplementation(async () => {
        stopEvents.push('queue.close');
      }),
    };

    const mockApp = {
      server: { address: () => ({ address: '127.0.0.1', port: 9000 }) },
      ready: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockImplementation(async () => {
        stopEvents.push('app.close');
      }),
      get: vi.fn(),
    };

    const config = loadRuntimeConfig(validDevEnv());
    const deps: RuntimeDependencies = {
      createDatabase: async () => mockDb,
      createRedis: async () => mockRedis as any,
      createS3: async () => ({ storage: {} as any, client: mockS3Client }),
      createQueue: async () => mockQueue as any,
      createApp: () => mockApp as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const runtime = await createRuntime(config, deps);

    // Call stop twice concurrently
    const p1 = runtime.stop();
    const p2 = runtime.stop();

    // Idempotency: exact same promise returned
    expect(p1).toBe(p2);

    await Promise.all([p1, p2]);

    expect(stopEvents).toEqual([
      'app.close',
      'queue.close',
      's3Client.destroy',
      'redis.quit',
      'database.close',
    ]);
    expect(runtime.isShuttingDown()).toBe(true);

    // Call stop a third time after already resolved
    const p3 = runtime.stop();
    expect(p3).toBe(p1);
    await p3;
    // None of the close functions should have been called again
    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(mockQueue.close).toHaveBeenCalledTimes(1);
    expect(mockS3Client.destroy).toHaveBeenCalledTimes(1);
    expect(mockRedis.quit).toHaveBeenCalledTimes(1);
    expect(mockDb.close).toHaveBeenCalledTimes(1);
  });

  it('continues closing remaining components if one step fails during stop', async () => {
    const executed: string[] = [];

    const mockDb: Database = {
      query: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn().mockImplementation(async () => {
        executed.push('database.close');
      }),
    };

    const mockRedis = {
      quit: vi.fn().mockImplementation(async () => {
        executed.push('redis.quit');
      }),
      ping: vi.fn(),
    };

    const mockS3Client = {
      destroy: vi.fn().mockImplementation(() => {
        executed.push('s3Client.destroy');
      }),
    };

    const mockQueue = {
      close: vi.fn().mockImplementation(async () => {
        executed.push('queue.close');
        throw new Error('REDIS_CONNECTION_LOST');
      }),
    };

    const mockApp = {
      server: { address: () => ({ address: '127.0.0.1', port: 9000 }) },
      ready: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockImplementation(async () => {
        executed.push('app.close');
      }),
      get: vi.fn(),
    };

    const config = loadRuntimeConfig(validDevEnv());
    const deps: RuntimeDependencies = {
      createDatabase: async () => mockDb,
      createRedis: async () => mockRedis as any,
      createS3: async () => ({ storage: {} as any, client: mockS3Client }),
      createQueue: async () => mockQueue as any,
      createApp: () => mockApp as any,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const runtime = await createRuntime(config, deps);

    await expect(runtime.stop()).rejects.toThrow(RuntimeShutdownError);

    // Even though queue.close failed, s3Client.destroy, redis.quit, and database.close STILL ran
    expect(executed).toContain('app.close');
    expect(executed).toContain('queue.close');
    expect(executed).toContain('s3Client.destroy');
    expect(executed).toContain('redis.quit');
    expect(executed).toContain('database.close');
  });

  it('bounds shutdown by shutdownTimeoutMs, logs warning and continues closing', async () => {
    const executed: string[] = [];
    const logger: RuntimeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const mockDb: Database = {
      query: vi.fn(),
      transaction: vi.fn(),
      close: vi.fn().mockImplementation(async () => {
        executed.push('database.close');
      }),
    };

    const mockRedis = {
      quit: vi.fn().mockImplementation(async () => {
        executed.push('redis.quit');
      }),
      ping: vi.fn(),
    };

    const mockQueue = {
      close: vi.fn().mockImplementation(async () => {
        executed.push('queue.close');
        // Wait longer than shutdownTimeoutMs
        await new Promise((r) => setTimeout(r, 200));
      }),
    };

    const mockApp = {
      server: { address: () => ({ address: '127.0.0.1', port: 9000 }) },
      ready: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockImplementation(async () => {
        executed.push('app.close');
      }),
      get: vi.fn(),
    };

    const config = loadRuntimeConfig({
      ...validDevEnv(),
      OTT_SHUTDOWN_TIMEOUT_MS: '50',
    });

    const deps: RuntimeDependencies = {
      createDatabase: async () => mockDb,
      createRedis: async () => mockRedis as any,
      createS3: async () => ({ storage: {} as any }),
      createQueue: async () => mockQueue as any,
      createApp: () => mockApp as any,
      logger,
    };

    const runtime = await createRuntime(config, deps);

    await expect(runtime.stop()).rejects.toThrow(RuntimeShutdownError);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Shutdown timeout exceeded'),
      expect.anything(),
    );
    // Subsequent steps are still attempted
    expect(executed).toContain('redis.quit');
    expect(executed).toContain('database.close');
  });

  it('registers SIGTERM and SIGINT handlers once on startServer and exits gracefully', async () => {
    const emitter = new EventEmitter();
    const exitMock = vi.fn();

    const mockApp = {
      server: { address: () => ({ address: '127.0.0.1', port: 9000 }) },
      ready: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    };

    const deps: RuntimeDependencies = {
      createDatabase: async () => ({ query: vi.fn(), transaction: vi.fn(), close: vi.fn() } as any),
      createRedis: async () => ({ quit: vi.fn(), ping: vi.fn() } as any),
      createS3: async () => ({ storage: {} as any }),
      createQueue: async () => ({ close: vi.fn() } as any),
      createApp: () => mockApp as any,
      processEmitter: emitter,
      exit: exitMock,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const runtime = await startServer(validDevEnv(), deps);
    expect(emitter.listenerCount('SIGTERM')).toBe(1);
    expect(emitter.listenerCount('SIGINT')).toBe(1);

    // Trigger SIGTERM
    emitter.emit('SIGTERM');

    // Wait for shutdown promise
    await new Promise((r) => setTimeout(r, 50));

    expect(mockApp.close).toHaveBeenCalledTimes(1);
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(runtime.isShuttingDown()).toBe(true);
  });
});
