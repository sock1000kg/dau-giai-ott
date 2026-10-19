import * as http from 'node:http';
import { S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import type { MatchJobV1 } from '@ott/job-contract';
import { createDatabase, createS3Storage, type Database, type ObjectStorage } from '@ott/platform-api';
import { defaultWorkerMetrics, type WorkerMetrics } from '../metrics.ts';
import { runMatchJob, type RunMatchJobOptions, type RunMatchJobResult } from '../run-match-job.ts';
import { runTestJob, type RunTestJobOptions, type RunTestJobResult } from '../run-test-job.ts';
import type { MatchWorkerAttemptContext } from '../worker.ts';
import { createWorkerPool, type WorkerPool, type WorkerPoolOptions } from '../worker-pool.ts';
import { loadWorkerRuntimeConfig, type WorkerRuntimeConfig } from './config.ts';
import {
  createMetricsServer,
  type WorkerMetricsServer,
  type WorkerMetricsServerOptions,
  type WorkerRuntimeLogger,
} from './metrics-server.ts';

export { type WorkerRuntimeLogger };

export class WorkerRuntimeShutdownError extends Error {
  public readonly errors: readonly unknown[];

  public constructor(errors: readonly unknown[]) {
    super(`Worker shutdown completed with ${errors.length} error(s)`);
    this.name = 'WorkerRuntimeShutdownError';
    this.errors = errors;
  }
}

export interface RedisReconnectStrategyController {
  strategy(times: number): number | null;
  markConnected(): void;
  isConnected(): boolean;
}

export function createRedisReconnectStrategy(): RedisReconnectStrategyController {
  let connected = false;
  return {
    strategy(times: number): number | null {
      if (!connected) {
        return null;
      }
      return Math.min(times * 100, 3000);
    },
    markConnected() {
      connected = true;
    },
    isConnected() {
      return connected;
    },
  };
}

const defaultLogger: WorkerRuntimeLogger = {
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

export async function pingDocker(socketPath: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        socketPath,
        path: '/_ping',
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        resolve(res.statusCode === 200);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.end();
  });
}

export async function routeJob(
  job: MatchJobV1,
  deps: { database: Database },
): Promise<'test-run' | 'match'> {
  const result = await deps.database.query(
    'SELECT 1 FROM test_runs WHERE id = $1',
    [job.matchId],
  );
  return result.rows.length > 0 ? 'test-run' : 'match';
}

export interface WorkerRuntime {
  readonly config: WorkerRuntimeConfig;
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly pool: WorkerPool;
  readonly metricsServer: WorkerMetricsServer | null;
  readonly isReady: () => boolean;
  readonly getDockerStatus: () => 'up' | 'down';
  stop(): Promise<void>;
}

export interface WorkerRuntimeDependencies {
  readonly createDatabase?: (url: string) => Database | Promise<Database>;
  readonly createS3?: (
    s3Config: WorkerRuntimeConfig['s3'],
  ) =>
    | { storage: ObjectStorage; client?: { destroy(): void } }
    | Promise<{ storage: ObjectStorage; client?: { destroy(): void } }>;
  readonly createRedisClient?: (url: string) => Redis | Promise<Redis>;
  readonly pingDocker?: (socketPath: string) => Promise<boolean>;
  readonly createPool?: (options: WorkerPoolOptions) => WorkerPool | Promise<WorkerPool>;
  readonly createMetricsServer?: (
    options: WorkerMetricsServerOptions,
  ) => WorkerMetricsServer | Promise<WorkerMetricsServer>;
  readonly routeJob?: (
    job: MatchJobV1,
    deps: { database: Database },
  ) => Promise<'test-run' | 'match'>;
  readonly runMatchJob?: (options: RunMatchJobOptions) => Promise<RunMatchJobResult>;
  readonly runTestJob?: (options: RunTestJobOptions) => Promise<RunTestJobResult>;
  readonly metrics?: WorkerMetrics;
  readonly logger?: WorkerRuntimeLogger;
  readonly processEmitter?: NodeJS.EventEmitter;
  readonly exit?: (code?: number) => void;
}

export async function createWorkerRuntime(
  config: WorkerRuntimeConfig,
  deps: WorkerRuntimeDependencies = {},
): Promise<WorkerRuntime> {
  const logger = deps.logger ?? defaultLogger;
  const metrics = deps.metrics ?? defaultWorkerMetrics;

  let database: Database | undefined;
  let storage: ObjectStorage | undefined;
  let s3Client: { destroy(): void } | undefined;
  let redisClient: Redis | undefined;
  let pool: WorkerPool | undefined;
  let metricsServer: WorkerMetricsServer | undefined;
  let dockerStatus: 'up' | 'down' = 'up';

  let shuttingDown = false;
  let isReady = false;

  try {
    // 1. Connect PostgreSQL
    logger.info('connecting to postgresql');
    database = await (deps.createDatabase ?? ((url) => createDatabase({ connectionString: url })))(
      config.databaseUrl,
    );

    // 2. Initialize S3 storage
    logger.info('initializing s3 storage');
    const s3Result = await (
      deps.createS3 ??
      ((s3Config) => {
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
      })
    )(config.s3);
    storage = s3Result.storage;
    s3Client = s3Result.client;

    // 3. Connect Redis for health/status ping
    logger.info('connecting to redis');
    redisClient = await (
      deps.createRedisClient ??
      ((url) => {
        const reconnect = createRedisReconnectStrategy();
        const client = new Redis(url, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          connectTimeout: 2000,
          retryStrategy: reconnect.strategy,
        });
        client.on('ready', () => {
          reconnect.markConnected();
        });
        client.on('error', () => {
          logger.warn('redis client error');
        });
        return client.connect().then(() => client);
      })
    )(config.redisUrl);

    // 4. Docker ping
    logger.info('checking docker availability', { socketPath: config.dockerSocketPath });
    const dockerOk = await (deps.pingDocker ?? pingDocker)(config.dockerSocketPath);
    if (!dockerOk) {
      if (config.requireDocker) {
        throw new Error('DOCKER_UNAVAILABLE');
      } else {
        logger.warn('Docker daemon is unavailable, continuing in no-sandbox mode');
        dockerStatus = 'down';
      }
    } else {
      dockerStatus = 'up';
    }

    // 5. Worker pool
    logger.info('creating worker pool', { queueName: config.queueName });
    pool = await (deps.createPool ?? createWorkerPool)({
      redisUrl: config.redisUrl,
      workerId: config.workerId,
      queueName: config.queueName,
      deadLetterQueueName: config.deadLetterQueueName,
      capacityPolicy: {
        maxConcurrency: config.concurrency.max,
        minConcurrency: config.concurrency.min,
      },
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      heartbeatTtlSeconds: config.heartbeatTtlSeconds,
      logger: {
        info: (f, m) => logger.info(m, f),
        warn: (f, m) => logger.warn(m, f),
        error: (f, m) => logger.error(m, f),
      },
      processMatch: async (job: unknown, attempt: MatchWorkerAttemptContext): Promise<void> => {
        const matchJob = job as MatchJobV1;
        const kind = await (deps.routeJob ?? routeJob)(matchJob, { database: database! });
        if (kind === 'test-run') {
          await (deps.runTestJob ?? runTestJob)({
            testRunId: matchJob.matchId,
            database: database!,
            storage: storage!,
            metrics,
          });
          return;
        }

        await (deps.runMatchJob ?? runMatchJob)({
          job: matchJob,
          database: database!,
          storage: storage!,
          attempt,
          metrics,
        });
      },
    });

    // 6. Metrics/health HTTP server
    if (config.metrics !== null) {
      logger.info('starting metrics server', { host: config.metrics.host, port: config.metrics.port });
      metricsServer = await (deps.createMetricsServer ?? createMetricsServer)({
        host: config.metrics.host,
        port: config.metrics.port,
        metrics,
        isReady: () => isReady && !shuttingDown,
        checkPostgres: async () => {
          await database!.query('SELECT 1');
        },
        checkRedis: async () => {
          await redisClient!.ping();
        },
        checkDocker: async () => {
          return (deps.pingDocker ?? pingDocker)(config.dockerSocketPath);
        },
        getDockerStatus: () => dockerStatus,
        requireDocker: config.requireDocker,
        logger,
      });
      await metricsServer.listen();
      logger.info('metrics server listening', { host: metricsServer.host, port: metricsServer.port });
    }

    // 7. Start worker pool
    logger.info('starting worker pool listener');
    await pool.start();
    isReady = true;
    logger.info('worker runtime ready');
  } catch (error) {
    const errorContext: Record<string, unknown> = {};
    if (error instanceof Error) {
      if (error.name) {
        errorContext.name = error.name;
      }
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
        errorContext.code = code;
      }
    }
    logger.error('worker startup failed', Object.keys(errorContext).length > 0 ? errorContext : undefined);

    if (metricsServer !== undefined) {
      await Promise.resolve(metricsServer.close()).catch(() => undefined);
    }
    if (pool !== undefined) {
      await Promise.resolve(pool.close()).catch(() => undefined);
    }
    if (redisClient !== undefined) {
      await Promise.resolve(redisClient.quit()).catch(() => redisClient?.disconnect());
    }
    if (s3Client !== undefined) {
      try {
        s3Client.destroy();
      } catch {}
    }
    if (database !== undefined) {
      await Promise.resolve(database.close()).catch(() => undefined);
    }

    throw error;
  }

  let stopPromise: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    if (stopPromise !== undefined) {
      return stopPromise;
    }

    stopPromise = (async () => {
      shuttingDown = true;
      isReady = false;
      logger.info('stopping worker runtime');

      const errors: unknown[] = [];

      // 1. pool.pause('shutdown')
      if (pool !== undefined) {
        try {
          await pool.pause('shutdown');
        } catch (err) {
          errors.push(err);
          logger.error('worker stop step failed', { step: 'pool.pause' });
        }
      }

      // 2. Wait for active matches to complete or deadline
      if (pool !== undefined) {
        const timeoutMs = config.shutdownTimeoutMs;
        const deadline = Date.now() + timeoutMs;
        while (pool.getActiveCount() > 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const remaining = pool.getActiveCount();
        if (remaining > 0) {
          logger.warn('Shutdown timeout exceeded with active matches remaining', { count: remaining });
        }
      }

      // 3. pool.close()
      if (pool !== undefined) {
        try {
          await pool.close();
        } catch (err) {
          errors.push(err);
          logger.error('worker stop step failed', { step: 'pool.close' });
        }
      }

      // 4. metricsServer.close()
      if (metricsServer !== undefined) {
        try {
          await metricsServer.close();
        } catch (err) {
          errors.push(err);
          logger.error('worker stop step failed', { step: 'metricsServer.close' });
        }
      }

      // 5. redisClient.quit()
      if (redisClient !== undefined) {
        try {
          await redisClient.quit();
        } catch (err) {
          redisClient.disconnect();
          errors.push(err);
          logger.error('worker stop step failed', { step: 'redisClient.quit' });
        }
      }

      // 6. s3Client.destroy()
      if (s3Client !== undefined) {
        try {
          s3Client.destroy();
        } catch (err) {
          errors.push(err);
          logger.error('worker stop step failed', { step: 's3Client.destroy' });
        }
      }

      // 7. database.close()
      if (database !== undefined) {
        try {
          await database.close();
        } catch (err) {
          errors.push(err);
          logger.error('worker stop step failed', { step: 'database.close' });
        }
      }

      if (errors.length > 0) {
        throw new WorkerRuntimeShutdownError(errors);
      }
    })();

    return stopPromise;
  };

  return {
    config,
    database: database!,
    storage: storage!,
    pool: pool!,
    metricsServer: metricsServer ?? null,
    isReady: () => isReady,
    getDockerStatus: () => dockerStatus,
    stop,
  };
}

export async function startWorker(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
  deps: WorkerRuntimeDependencies = {},
): Promise<WorkerRuntime> {
  const config = loadWorkerRuntimeConfig(env);
  const runtime = await createWorkerRuntime(config, deps);

  const emitter = deps.processEmitter ?? process;
  const exitFn =
    deps.exit ??
    (emitter as { exit?: (code?: number) => void }).exit?.bind(emitter) ??
    process.exit.bind(process);
  const logger = deps.logger ?? defaultLogger;

  const onSignal = async (signal: string) => {
    logger.info('signal received, stopping worker', { signal });
    try {
      await runtime.stop();
      exitFn(0);
    } catch {
      logger.error('worker shutdown failed');
      exitFn(1);
    }
  };

  emitter.once('SIGTERM', () => void onSignal('SIGTERM'));
  emitter.once('SIGINT', () => void onSignal('SIGINT'));

  return runtime;
}
