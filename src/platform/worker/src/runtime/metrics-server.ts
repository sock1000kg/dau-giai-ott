import * as http from 'node:http';
import { assertMetricsSanitized, defaultWorkerMetrics, type WorkerMetrics } from '../metrics.ts';

export interface WorkerRuntimeLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface WorkerMetricsServerOptions {
  readonly host: string;
  readonly port: number;
  readonly metrics?: WorkerMetrics;
  readonly isReady: () => boolean;
  readonly checkPostgres: () => Promise<void>;
  readonly checkRedis: () => Promise<void>;
  readonly checkDocker?: () => Promise<boolean>;
  readonly requireDocker?: boolean;
  readonly getDockerStatus?: () => 'up' | 'down';
  readonly logger?: WorkerRuntimeLogger;
}

export interface WorkerMetricsServer {
  readonly host: string;
  readonly port: number;
  listen(): Promise<void>;
  close(): Promise<void>;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createMetricsServer(options: WorkerMetricsServerOptions): WorkerMetricsServer {
  const metrics = options.metrics ?? defaultWorkerMetrics;
  const logger = options.logger;

  let actualPort = options.port;
  let actualHost = options.host;

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'GET') {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    const url = req.url ?? '/';
    const path = url.split('?')[0];

    if (path === '/metrics') {
      try {
        const body = metrics.scrape();
        assertMetricsSanitized(body);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; version=0.0.4');
        res.end(body);
      } catch (err) {
        logger?.error('Metrics sanitization check failed');
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Internal Server Error');
      }
      return;
    }

    if (path === '/health/live') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (path === '/health/ready') {
      res.setHeader('Content-Type', 'application/json');

      if (!options.isReady()) {
        res.statusCode = 503;
        res.end(JSON.stringify({ status: 'not_ready' }));
        return;
      }

      try {
        await Promise.all([
          withTimeout(options.checkPostgres(), 2000),
          withTimeout(options.checkRedis(), 2000),
          ...(options.requireDocker && options.checkDocker !== undefined
            ? [
                withTimeout(
                  options.checkDocker().then((ok) => {
                    if (!ok) throw new Error('DOCKER_DOWN');
                  }),
                  2000,
                ),
              ]
            : []),
        ]);

        if (options.requireDocker === false) {
          let dockerState: 'up' | 'down' = 'down';
          if (options.getDockerStatus !== undefined) {
            dockerState = options.getDockerStatus();
          } else if (options.checkDocker !== undefined) {
            dockerState = (await options.checkDocker().catch(() => false)) ? 'up' : 'down';
          }
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'ready', docker: dockerState }));
        } else {
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'ready' }));
        }
      } catch (err) {
        res.statusCode = 503;
        res.end(JSON.stringify({ status: 'not_ready' }));
      }
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return {
    get host() {
      return actualHost;
    },
    get port() {
      return actualPort;
    },
    async listen(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(options.port, options.host, () => {
          server.removeListener('error', reject);
          const address = server.address();
          if (typeof address === 'object' && address !== null) {
            actualPort = address.port;
            actualHost = address.address;
          }
          resolve();
        });
      });
    },
    async close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
