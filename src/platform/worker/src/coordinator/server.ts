import { S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import { Pool, type PoolClient } from 'pg';
import {
  createDatabase,
  createS3Storage,
  dispatchScheduledMatches,
  MatchQueue,
  publishQualificationSnapshot,
  runRetentionPrune,
  settleSeries,
  type Database,
  type ObjectStorage,
} from '@ott/platform-api';
import { preflightSubmission } from '../preflight-submission.ts';
import {
  createMetricsServer,
  type WorkerMetricsServer,
  type WorkerMetricsServerOptions,
} from '../runtime/metrics-server.ts';
import { createRedisReconnectStrategy, pingDocker } from '../runtime/server.ts';
import { loadCoordinatorConfig, type CoordinatorConfig } from './config.ts';
import {
  CoordinatorLoopRunner,
  runDispatchIteration,
  runPreflightIteration,
  runRetentionIteration,
  runSettleIteration,
  runSnapshotIteration,
  type CoordinatorLogger,
  type LoopDefinition,
} from './loops.ts';
import {
  CoordinatorMetrics,
  defaultCoordinatorMetrics,
  type CoordinatorRole,
} from './metrics.ts';

export { type CoordinatorLogger };

export interface AdvisoryLockHandle {
  tryLock(): Promise<boolean>;
  unlock(): Promise<void>;
  onConnectionLoss(callback: () => void): void;
  close(): Promise<void>;
}

export function createDefaultAdvisoryLockHandle(databaseUrlOrPool: string | Pool): AdvisoryLockHandle {
  const pool =
    typeof databaseUrlOrPool === 'string'
      ? new Pool({ connectionString: databaseUrlOrPool, max: 2, connectionTimeoutMillis: 3000 })
      : databaseUrlOrPool;
  let client: PoolClient | null = null;
  let connectionLossHandler: (() => void) | null = null;
  let isLocked = false;

  return {
    async tryLock(): Promise<boolean> {
      if (client === null) {
        client = await pool.connect();
        const activeClient = client;
        activeClient.on('error', (err) => {
          isLocked = false;
          try {
            activeClient.release(err ?? true);
          } catch {
            // ignore
          }
          if (client === activeClient) {
            client = null;
          }
          if (connectionLossHandler) connectionLossHandler();
        });
        activeClient.on('end', () => {
          isLocked = false;
          try {
            activeClient.release(true);
          } catch {
            // ignore
          }
          if (client === activeClient) {
            client = null;
          }
          if (connectionLossHandler) connectionLossHandler();
        });
      }
      try {
        const res = await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext('ott:coordinator')) AS locked",
        );
        isLocked = res.rows[0]?.locked === true;
        return isLocked;
      } catch {
        isLocked = false;
        return false;
      }
    },
    async unlock(): Promise<void> {
      if (client !== null && isLocked) {
        try {
          await client.query("SELECT pg_advisory_unlock(hashtext('ott:coordinator'))");
        } catch {
          // ignore
        }
        isLocked = false;
      }
    },
    onConnectionLoss(callback: () => void): void {
      connectionLossHandler = callback;
    },
    async close(): Promise<void> {
      if (client !== null) {
        if (isLocked) {
          try {
            await client.query("SELECT pg_advisory_unlock(hashtext('ott:coordinator'))");
          } catch {
            // ignore
          }
          isLocked = false;
        }
        try {
          client.release();
        } catch {
          // ignore
        }
        client = null;
      }
      await pool.end().catch(() => {});
    },
  };
}

const defaultLogger: CoordinatorLogger = {
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

export interface CoordinatorRuntime {
  readonly config: CoordinatorConfig;
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly queue: MatchQueue;
  readonly metrics: CoordinatorMetrics;
  readonly metricsServer: WorkerMetricsServer | null;
  readonly loopRunner: CoordinatorLoopRunner;
  readonly getRole: () => CoordinatorRole;
  readonly isReady: () => boolean;
  stop(): Promise<void>;
}

export interface CoordinatorDependencies {
  readonly createDatabase?: (url: string) => Database | Promise<Database>;
  readonly createS3?: (
    s3Config: CoordinatorConfig['s3'],
  ) =>
    | { storage: ObjectStorage; client?: { destroy(): void } }
    | Promise<{ storage: ObjectStorage; client?: { destroy(): void } }>;
  readonly createRedisClient?: (url: string) => Redis | Promise<Redis>;
  readonly createQueue?: (options: { redisUrl: string; queueName: string }) => MatchQueue | Promise<MatchQueue>;
  readonly pingDocker?: (socketPath: string) => Promise<boolean>;
  readonly createLockHandle?: (databaseUrl: string) => AdvisoryLockHandle | Promise<AdvisoryLockHandle>;
  readonly createMetricsServer?: (
    options: WorkerMetricsServerOptions,
  ) => WorkerMetricsServer | Promise<WorkerMetricsServer>;
  readonly preflightSubmission?: typeof preflightSubmission;
  readonly dispatchScheduledMatches?: typeof dispatchScheduledMatches;
  readonly settleSeries?: typeof settleSeries;
  readonly publishQualificationSnapshot?: typeof publishQualificationSnapshot;
  readonly runRetentionPrune?: typeof runRetentionPrune;
  readonly metrics?: CoordinatorMetrics;
  readonly logger?: CoordinatorLogger;
}

export async function createCoordinatorRuntime(
  config: CoordinatorConfig,
  deps: CoordinatorDependencies = {},
): Promise<CoordinatorRuntime> {
  const logger = deps.logger ?? defaultLogger;
  const metrics = deps.metrics ?? defaultCoordinatorMetrics;

  let database: Database | undefined;
  let storage: ObjectStorage | undefined;
  let s3Client: { destroy(): void } | undefined;
  let redisClient: Redis | undefined;
  let queue: MatchQueue | undefined;
  let metricsServer: WorkerMetricsServer | undefined;
  let lockHandle: AdvisoryLockHandle | undefined;
  let retryLockTimer: NodeJS.Timeout | null = null;

  let shuttingDown = false;
  let isReady = false;
  let currentRole: CoordinatorRole = 'standby';
  metrics.setRole('standby');

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

    // 3. Connect Redis
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

    // 4. Docker check
    logger.info('checking docker availability', { socketPath: config.dockerSocketPath });
    const dockerOk = await (deps.pingDocker ?? pingDocker)(config.dockerSocketPath);
    if (!dockerOk && config.requireDocker) {
      throw new Error('DOCKER_UNAVAILABLE');
    }

    // 5. MatchQueue
    logger.info('creating match queue enqueuer', { queueName: config.queueName });
    queue = await (deps.createQueue ?? ((opts) => new MatchQueue(opts)))({
      redisUrl: config.redisUrl,
      queueName: config.queueName,
    });

    // 6. Build loop definitions
    const checkDockerFn = () => (deps.pingDocker ?? pingDocker)(config.dockerSocketPath);
    const checkS3Fn = async () => {
      try {
        if (typeof storage!.ping === 'function') {
          await storage!.ping();
          return true;
        }
        await storage!.get('__nonexistent_probe_key__');
        return true;
      } catch (err: unknown) {
        // NoSuchKey or 404 is healthy (proves connectivity); network/bucket error is not
        if (err instanceof Error) {
          const code = (err as { code?: string; name?: string }).code ?? err.name;
          if (code === 'NoSuchKey' || code === 'NotFound' || /404|NoSuchKey/i.test(err.message)) {
            return true;
          }
        }
        return false;
      }
    };

    const loopDefs: LoopDefinition[] = [
      {
        name: 'preflight',
        intervalMs: config.preflightIntervalMs,
        run: async () => {
          const count = await runPreflightIteration({
            database: database!,
            storage: storage!,
            batch: config.preflightBatch,
            requireDocker: config.requireDocker,
            checkDocker: checkDockerFn,
            checkS3: checkS3Fn,
            preflightSubmission: deps.preflightSubmission ?? preflightSubmission,
            dockerSocketPath: config.dockerSocketPath,
            logger,
            metrics,
          });
          metrics.addProcessed('preflight', count);
        },
      },
      {
        name: 'dispatch',
        intervalMs: config.dispatchIntervalMs,
        run: async () => {
          const count = await runDispatchIteration({
            database: database!,
            matchQueue: queue!,
            limit: config.dispatchLimit,
            dispatchFn: deps.dispatchScheduledMatches ?? dispatchScheduledMatches,
            logger,
          });
          metrics.addProcessed('dispatch', count);
        },
      },
      {
        name: 'settle',
        intervalMs: config.settleIntervalMs,
        run: async () => {
          const count = await runSettleIteration({
            database: database!,
            settleFn: deps.settleSeries ?? settleSeries,
            logger,
          });
          metrics.addProcessed('settle', count);
        },
      },
    ];

    if (config.snapshotIntervalMs > 0) {
      loopDefs.push({
        name: 'snapshot',
        intervalMs: config.snapshotIntervalMs,
        run: async () => {
          await runSnapshotIteration({
            database: database!,
            snapshotDir: config.snapshotDir,
            snapshotKeep: config.snapshotKeep,
            editorialFile: config.editorialFile,
            fallbackEditorial: config.initialEditorial,
            publishFn: deps.publishQualificationSnapshot ?? publishQualificationSnapshot,
            logger,
          });
          metrics.addProcessed('snapshot', 1);
        },
      });
    }

    if (config.retention === 'dry-run') {
      loopDefs.push({
        name: 'retention',
        intervalMs: config.retentionIntervalMs,
        run: async () => {
          await runRetentionIteration({
            database: database!,
            retentionFn: deps.runRetentionPrune ?? runRetentionPrune,
            logger,
          });
          metrics.addProcessed('retention', 1);
        },
      });
    }

    const loopRunner = new CoordinatorLoopRunner({
      loops: loopDefs,
      metrics,
      logger,
    });

    // 7. Metrics HTTP server
    if (config.metrics !== null) {
      logger.info('starting coordinator metrics server', {
        host: config.metrics.host,
        port: config.metrics.port,
      });
      metricsServer = await (deps.createMetricsServer ?? createMetricsServer)({
        host: config.metrics.host,
        port: config.metrics.port,
        scrapeMetrics: () => metrics.scrape(),
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
        requireDocker: config.requireDocker,
        getReadyBody: () => ({ status: 'ready', role: currentRole }),
        logger,
      });
      await metricsServer.listen();
      logger.info('coordinator metrics server listening', {
        host: metricsServer.host,
        port: metricsServer.port,
      });
    }

    // 8. Advisory lock handle & state management
    lockHandle = await (deps.createLockHandle ?? createDefaultAdvisoryLockHandle)(config.databaseUrl);

    const attemptAcquisition = async (): Promise<void> => {
      if (shuttingDown) return;
      try {
        const acquired = await lockHandle!.tryLock();
        if (acquired) {
          if (currentRole !== 'active') {
            logger.info('coordinator acquired advisory lock: switching to active role');
            currentRole = 'active';
            metrics.setRole('active');
            loopRunner.resume();
          }
        } else {
          if (currentRole !== 'standby') {
            logger.info('coordinator lost/failed advisory lock: switching to standby role');
            currentRole = 'standby';
            metrics.setRole('standby');
            loopRunner.pause();
          }
          scheduleRetry();
        }
      } catch {
        if (currentRole !== 'standby') {
          currentRole = 'standby';
          metrics.setRole('standby');
          loopRunner.pause();
        }
        scheduleRetry();
      }
    };

    const scheduleRetry = (): void => {
      if (shuttingDown) return;
      if (retryLockTimer !== null) clearTimeout(retryLockTimer);
      retryLockTimer = setTimeout(() => {
        retryLockTimer = null;
        void attemptAcquisition();
      }, 5000);
    };

    lockHandle.onConnectionLoss(() => {
      logger.warn('coordinator lock connection lost: dropping to standby');
      currentRole = 'standby';
      metrics.setRole('standby');
      loopRunner.pause();
      scheduleRetry();
    });

    // Try initial lock acquisition
    await attemptAcquisition();

    isReady = true;
    logger.info('coordinator runtime ready', { role: currentRole });

    let stopPromise: Promise<void> | undefined;

    const stop = (): Promise<void> => {
      if (stopPromise !== undefined) {
        return stopPromise;
      }

      stopPromise = (async () => {
        shuttingDown = true;
        isReady = false;
        currentRole = 'standby';
        metrics.setRole('standby');
        logger.info('stopping coordinator runtime');

        if (retryLockTimer !== null) {
          clearTimeout(retryLockTimer);
          retryLockTimer = null;
        }

        // 1. Stop loops and wait for in-flight bounded by shutdownTimeoutMs
        await loopRunner.stop(config.shutdownTimeoutMs);

        // 2. Release advisory lock and close dedicated lock client
        if (lockHandle !== undefined) {
          try {
            await lockHandle.close();
          } catch {
            logger.error('coordinator stop step failed', { step: 'lockHandle.close' });
          }
        }

        // 3. Close MatchQueue
        if (queue !== undefined) {
          try {
            await queue.close();
          } catch {
            logger.error('coordinator stop step failed', { step: 'queue.close' });
          }
        }

        // 4. Close metrics HTTP server
        if (metricsServer !== undefined) {
          try {
            await metricsServer.close();
          } catch {
            logger.error('coordinator stop step failed', { step: 'metricsServer.close' });
          }
        }

        // 5. Close Redis client
        if (redisClient !== undefined) {
          try {
            await redisClient.quit().catch(() => redisClient?.disconnect());
          } catch {
            logger.error('coordinator stop step failed', { step: 'redis.quit' });
          }
        }

        // 6. Destroy S3 client
        if (s3Client !== undefined) {
          try {
            s3Client.destroy();
          } catch {
            // ignore
          }
        }

        // 7. Close Database pool
        if (database !== undefined) {
          try {
            await database.close();
          } catch {
            logger.error('coordinator stop step failed', { step: 'database.close' });
          }
        }

        logger.info('coordinator runtime stopped cleanly');
      })();

      return stopPromise;
    };

    return {
      config,
      database: database!,
      storage: storage!,
      queue: queue!,
      metrics,
      metricsServer: metricsServer ?? null,
      loopRunner,
      getRole: () => currentRole,
      isReady: () => isReady && !shuttingDown,
      stop,
    };
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
    logger.error('coordinator startup failed', Object.keys(errorContext).length > 0 ? errorContext : undefined);

    if (retryLockTimer !== null) {
      clearTimeout(retryLockTimer);
    }
    if (lockHandle !== undefined) {
      await Promise.resolve(lockHandle.close()).catch(() => undefined);
    }
    if (metricsServer !== undefined) {
      await Promise.resolve(metricsServer.close()).catch(() => undefined);
    }
    if (queue !== undefined) {
      await Promise.resolve(queue.close()).catch(() => undefined);
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
}

let activeCoordinator: CoordinatorRuntime | undefined;
let signalsRegistered = false;

export async function startCoordinator(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
  deps?: CoordinatorDependencies,
): Promise<CoordinatorRuntime> {
  const config = loadCoordinatorConfig(env);
  const runtime = await createCoordinatorRuntime(config, deps);
  activeCoordinator = runtime;

  if (!signalsRegistered) {
    signalsRegistered = true;
    const shutdownHandler = () => {
      if (activeCoordinator !== undefined) {
        activeCoordinator.stop().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      }
    };
    process.once('SIGTERM', shutdownHandler);
    process.once('SIGINT', shutdownHandler);
  }

  return runtime;
}
