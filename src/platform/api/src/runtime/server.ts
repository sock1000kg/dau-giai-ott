import { S3Client } from '@aws-sdk/client-s3';
import type { FastifyInstance } from 'fastify';
import { createClient } from 'redis';

import { createAuthApp, type CreateAuthAppOptions } from '../app.ts';
import { createDatabase, runMigrations, type Database } from '../db/client.ts';
import { bootstrapBtcAdmin, type BootstrapBtcAdminOptions, type BootstrapBtcAdminResult } from '../modules/auth/bootstrap.ts';
import { createPasswordHasher } from '../modules/auth/passwords.ts';
import type { RedisAuthCommands } from '../modules/auth/sessions.ts';
import { MatchQueue } from '../queue/match-queue.ts';
import { createS3Storage, type ObjectStorage } from '../storage/s3.ts';
import { loadRuntimeConfig, type RuntimeConfig } from './config.ts';
import { registerHealthRoutes, type HealthCheck } from './health.ts';

export interface RuntimeLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const defaultLogger: RuntimeLogger = {
  info(message, context) {
    if (context && Object.keys(context).length > 0) {
      console.log(JSON.stringify({ level: 'info', message, ...context }));
    } else {
      console.log(JSON.stringify({ level: 'info', message }));
    }
  },
  warn(message, context) {
    if (context && Object.keys(context).length > 0) {
      console.warn(JSON.stringify({ level: 'warn', message, ...context }));
    } else {
      console.warn(JSON.stringify({ level: 'warn', message }));
    }
  },
  error(message, context) {
    if (context && Object.keys(context).length > 0) {
      console.error(JSON.stringify({ level: 'error', message, ...context }));
    } else {
      console.error(JSON.stringify({ level: 'error', message }));
    }
  },
};

export class RuntimeShutdownError extends Error {
  public readonly errors: readonly unknown[];

  public constructor(errors: readonly unknown[]) {
    super(`Shutdown completed with ${errors.length} error(s)`);
    this.name = 'RuntimeShutdownError';
    this.errors = errors;
  }
}

export interface RedisReconnectStrategyController {
  strategy: (retries: number, cause?: Error) => number | false;
  markConnected: () => void;
  isConnected: () => boolean;
}

export function createRedisReconnectStrategy(): RedisReconnectStrategyController {
  let connected = false;
  return {
    strategy(retries: number): number | false {
      if (!connected) {
        return false;
      }
      return Math.min(retries * 100, 3000);
    },
    markConnected() {
      connected = true;
    },
    isConnected() {
      return connected;
    },
  };
}

export interface RuntimeServer {
  readonly config: RuntimeConfig;
  readonly app: FastifyInstance;
  readonly database: Database;
  readonly redis: RedisAuthCommands & { quit(): Promise<unknown>; ping(): Promise<unknown> };
  readonly storage: ObjectStorage;
  readonly queue: MatchQueue;
  readonly host: string;
  readonly port: number;
  readonly isShuttingDown: () => boolean;
  stop(): Promise<void>;
}

export interface RuntimeDependencies {
  readonly createDatabase?: (url: string) => Database | Promise<Database>;
  readonly runMigrations?: (database: Database) => Promise<{ readonly applied: readonly string[] }>;
  readonly createRedis?: (url: string) => Promise<RedisAuthCommands & { quit(): Promise<unknown>; ping(): Promise<unknown> }>;
  readonly createRedisClient?: (options: any) => any;
  readonly createS3?: (s3Config: RuntimeConfig['s3']) => { storage: ObjectStorage; client?: { destroy(): void } } | Promise<{ storage: ObjectStorage; client?: { destroy(): void } }>;
  readonly createQueue?: (options: { redisUrl: string; queueName: string }) => MatchQueue | Promise<MatchQueue>;
  readonly bootstrapAdmin?: (options: BootstrapBtcAdminOptions) => Promise<BootstrapBtcAdminResult | null>;
  readonly createApp?: (options: CreateAuthAppOptions) => FastifyInstance;
  readonly logger?: RuntimeLogger;
  readonly processEmitter?: NodeJS.EventEmitter;
  readonly exit?: (code?: number) => void;
}

export async function createRuntime(
  config: RuntimeConfig,
  deps: RuntimeDependencies = {},
): Promise<RuntimeServer> {
  const logger = deps.logger ?? defaultLogger;

  let database: Database | undefined;
  let redis: (RedisAuthCommands & { quit(): Promise<unknown>; ping(): Promise<unknown> }) | undefined;
  let storage: ObjectStorage | undefined;
  let s3Client: { destroy(): void } | undefined;
  let queue: MatchQueue | undefined;
  let app: FastifyInstance | undefined;

  let shuttingDown = false;
  let isReady = false;

  try {
    // 1. Connect PostgreSQL
    logger.info('connecting to postgresql');
    database = await (deps.createDatabase ?? ((url) => createDatabase({ connectionString: url })))(config.databaseUrl);

    // 2. Run migrations (if configured)
    if (config.runMigrations) {
      logger.info('running database migrations');
      await (deps.runMigrations ?? runMigrations)(database);
    }

    // 3. Connect Redis
    logger.info('connecting to redis');
    redis = await (deps.createRedis ?? (async (url) => {
      const reconnect = createRedisReconnectStrategy();
      const clientFactory = deps.createRedisClient ?? createClient;
      const client = clientFactory({
        url,
        socket: {
          connectTimeout: 2000,
          reconnectStrategy: reconnect.strategy,
        },
      });
      client.on('ready', () => {
        reconnect.markConnected();
      });
      client.on('error', () => {
        logger.warn('redis client error');
      });
      await client.connect();
      return client as unknown as RedisAuthCommands & { quit(): Promise<unknown>; ping(): Promise<unknown> };
    }))(config.redisUrl);

    // 4. Build S3 storage
    logger.info('initializing s3 storage');
    const s3Result = await (deps.createS3 ?? ((s3Config) => {
      const client = new S3Client({
        endpoint: s3Config.endpoint,
        region: s3Config.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: s3Config.accessKeyId,
          secretAccessKey: s3Config.secretAccessKey,
        },
      });
      const s = createS3Storage({ client, bucket: s3Config.bucket });
      return { storage: s, client };
    }))(config.s3);
    storage = s3Result.storage;
    s3Client = s3Result.client;

    // 5. Build MatchQueue
    logger.info('initializing match queue');
    queue = await (deps.createQueue ?? ((opts) => new MatchQueue(opts)))({
      redisUrl: config.redisUrl,
      queueName: config.queueName,
    });

    // 6. Bootstrap BTC Admin only when both bootstrap env vars are set
    const passwordHasher = createPasswordHasher();
    if (config.bootstrap.username !== undefined && config.bootstrap.password !== undefined) {
      logger.info('bootstrapping btc admin');
      await (deps.bootstrapAdmin ?? bootstrapBtcAdmin)({
        database,
        passwordHasher,
        environment: {
          OTT_BOOTSTRAP_BTC_USERNAME: config.bootstrap.username,
          OTT_BOOTSTRAP_BTC_PASSWORD: config.bootstrap.password,
          ...(config.bootstrap.totpSecret
            ? { OTT_BOOTSTRAP_BTC_TOTP_SECRET: config.bootstrap.totpSecret }
            : {}),
        },
        totpEncryptionKey: config.security.totpEncryptionKey,
      });
    }

    // 7. Create Fastify Auth App
    logger.info('creating auth app');
    app = (deps.createApp ?? createAuthApp)({
      database,
      redis,
      passwordHasher,
      storage,
      security: config.security,
      secureCookies: config.secureCookies,
      matchEnqueuer: queue,
    });

    // 8. Register health routes
    logger.info('registering health routes');
    const checks: HealthCheck[] = [
      {
        name: 'postgres',
        check: async () => {
          await database!.query('SELECT 1');
        },
      },
      {
        name: 'redis',
        check: async () => {
          await redis!.ping();
        },
      },
      {
        name: 's3',
        check: async () => {
          if (storage!.ping) {
            await storage!.ping();
          }
        },
      },
    ];

    registerHealthRoutes(app, {
      isShuttingDown: () => shuttingDown || !isReady,
      checks,
      logger,
    });

    // 9. App ready
    logger.info('preparing fastify app');
    await app.ready();

    // 10. Listen
    logger.info('starting http listener', { host: config.host, port: config.port });
    await app.listen({ host: config.host, port: config.port });
    const address = app.server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : config.port;
    const actualHost = typeof address === 'object' && address !== null ? address.address : config.host;
    isReady = true;
    logger.info('server listening', { host: actualHost, port: actualPort });
  } catch (error) {
    logger.error('Startup failed, cleaning up initialized resources in reverse order', {
      error: error instanceof Error ? error.message : String(error),
    });

    // Cleanup in reverse order of initialization: app -> queue -> s3 -> redis -> db
    if (app !== undefined) {
      await app.close().catch(() => undefined);
    }
    if (queue !== undefined) {
      await queue.close().catch(() => undefined);
    }
    if (s3Client !== undefined) {
      try {
        s3Client.destroy();
      } catch {
        // ignore
      }
    }
    if (redis !== undefined) {
      await redis.quit().catch(() => undefined);
    }
    if (database !== undefined) {
      await database.close().catch(() => undefined);
    }

    throw error;
  }

  const address = app.server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : config.port;
  const actualHost = typeof address === 'object' && address !== null ? address.address : config.host;

  let stopPromise: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    if (stopPromise !== undefined) {
      return stopPromise;
    }

    stopPromise = (async () => {
      shuttingDown = true;
      logger.info('stopping runtime server');

      const timeoutMs = config.shutdownTimeoutMs;
      const deadline = Date.now() + timeoutMs;
      const errors: unknown[] = [];

      const runStep = async (name: string, fn: () => Promise<unknown> | void) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          logger.warn(`Shutdown timeout exceeded before starting ${name}`, { timeoutMs });
          errors.push(new Error(`Shutdown step '${name}' exceeded shutdownTimeoutMs`));
          try {
            await fn();
          } catch (err) {
            errors.push(err);
            logger.error(`Error during ${name} after timeout`, { error: err });
          }
          return;
        }

        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            Promise.resolve(fn()),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Shutdown step '${name}' timed out after ${remaining}ms`)),
                remaining,
              );
            }),
          ]);
        } catch (err) {
          errors.push(err);
          logger.error(`Error during shutdown step '${name}'`, { error: err });
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      };

      // 1. app.close()
      if (app !== undefined) {
        await runStep('app.close', () => app!.close());
      }

      // 2. queue.close()
      if (queue !== undefined) {
        await runStep('queue.close', () => queue!.close());
      }

      // 3. S3 client destroy
      if (s3Client !== undefined) {
        await runStep('s3Client.destroy', () => {
          s3Client!.destroy();
        });
      }

      // 4. redis.quit()
      if (redis !== undefined) {
        await runStep('redis.quit', () => redis!.quit());
      }

      // 5. database.close()
      if (database !== undefined) {
        await runStep('database.close', () => database!.close());
      }

      if (errors.length > 0) {
        throw new RuntimeShutdownError(errors);
      }
    })();

    return stopPromise;
  };

  return {
    config,
    app,
    database: database!,
    redis: redis!,
    storage: storage!,
    queue: queue!,
    host: actualHost,
    port: actualPort,
    isShuttingDown: () => shuttingDown,
    stop,
  };
}

export async function startServer(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
  deps: RuntimeDependencies = {},
): Promise<RuntimeServer> {
  const config = loadRuntimeConfig(env);
  const runtime = await createRuntime(config, deps);

  const emitter = deps.processEmitter ?? process;
  const exitFn = deps.exit ?? (emitter as { exit?: (code?: number) => void }).exit?.bind(emitter) ?? process.exit.bind(process);
  const logger = deps.logger ?? defaultLogger;

  const onSignal = async (signal: string) => {
    logger.info(`Received ${signal}, initiating shutdown`);
    try {
      await runtime.stop();
      exitFn(0);
    } catch (err) {
      logger.error('Shutdown failed', { error: err });
      exitFn(1);
    }
  };

  emitter.once('SIGTERM', () => void onSignal('SIGTERM'));
  emitter.once('SIGINT', () => void onSignal('SIGINT'));

  return runtime;
}
