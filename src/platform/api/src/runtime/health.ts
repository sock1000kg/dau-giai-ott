import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface HealthCheck {
  readonly name: string;
  check(): Promise<void>;
}

export interface HealthLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface HealthRoutesOptions {
  readonly isShuttingDown: () => boolean;
  readonly checks?: readonly HealthCheck[];
  readonly logger?: HealthLogger;
}

export function registerHealthRoutes(app: FastifyInstance, options: HealthRoutesOptions): void {
  const { isShuttingDown, checks = [], logger } = options;

  const handleLive = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');
    return reply.status(200).send({ status: 'ok' });
  };

  app.get('/api/v1/health', handleLive);
  app.get('/api/v1/health/live', handleLive);

  app.get('/api/v1/health/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Cache-Control', 'no-store');

    if (isShuttingDown()) {
      logger?.warn('Readiness check failed: server is shutting down or not yet ready');
      return reply.status(503).send({ status: 'not_ready' });
    }

    const checkPromises = checks.map(async (check) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          check.check(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('TIMEOUT')), 2000);
          }),
        ]);
        return { name: check.name, ok: true };
      } catch (error) {
        return { name: check.name, ok: false, error };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    });

    const results = await Promise.all(checkPromises);
    const failed = results.filter((r) => !r.ok);

    if (failed.length > 0) {
      logger?.warn('Readiness check failed', {
        failedChecks: failed.map((f) => f.name),
      });
      return reply.status(503).send({ status: 'not_ready' });
    }

    return reply.status(200).send({ status: 'ready' });
  });
}
