import * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerMetrics } from '../src/metrics.ts';
import { createMetricsServer, type WorkerMetricsServer } from '../src/runtime/metrics-server.ts';

function httpRequest(
  url: string,
  method = 'GET',
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
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
    });
    req.on('error', reject);
    req.end();
  });
}

describe('WorkerMetricsServer (P3-D32)', () => {
  let server: WorkerMetricsServer | undefined;

  afterEach(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
  });

  it('serves /metrics with text/plain; version=0.0.4 and Cache-Control: no-store', async () => {
    const metrics = new WorkerMetrics();
    metrics.recordAttempt({ matchId: '11111111-1111-4111-8111-111111111111', status: 'completed' });

    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      metrics,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {},
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/metrics`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain; version=0.0.4');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('ott_match_attempts_total');
  });

  it('responds with 500 fixed body when metrics scrape contains sensitive patterns', async () => {
    const poisonedMetrics = {
      scrape: () => 'ott_match_attempts_total 1\n# bearer sensitive_jwt_token_here',
    } as unknown as WorkerMetrics;

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      metrics: poisonedMetrics,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {},
      logger,
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/metrics`);
    expect(res.statusCode).toBe(500);
    expect(res.body).toBe('Internal Server Error');
    expect(res.body).not.toContain('sensitive_jwt_token_here');
    expect(logger.error).toHaveBeenCalledWith('Metrics sanitization check failed');
  });

  it('serves /health/live with 200 {"status":"ok"}', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => false, // liveness is true even when not ready
      checkPostgres: async () => {},
      checkRedis: async () => {},
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/health/live`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
  });

  it('serves /health/ready with 200 {"status":"ready"} when all dependencies pass', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {},
      checkDocker: async () => true,
      requireDocker: true,
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ready' });
  });

  it('returns 503 {"status":"not_ready"} without leaking details when isReady is false', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => false,
      checkPostgres: async () => {},
      checkRedis: async () => {},
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ status: 'not_ready' });
  });

  it('returns 503 {"status":"not_ready"} when PostgreSQL check fails or times out', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => true,
      checkPostgres: async () => {
        throw new Error('connection refused to db.internal.lan:5432 with secret_password');
      },
      checkRedis: async () => {},
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ status: 'not_ready' });
    expect(res.body).not.toContain('db.internal.lan');
    expect(res.body).not.toContain('secret_password');
  });

  it('returns 503 {"status":"not_ready"} when Redis check fails', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {
        throw new Error('REDIS_AUTH_FAIL: secret_token');
      },
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ status: 'not_ready' });
    expect(res.body).not.toContain('secret_token');
  });

  it('returns 503 {"status":"not_ready"} when Docker check fails and requireDocker=true', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {},
      checkDocker: async () => false,
      requireDocker: true,
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ status: 'not_ready' });
  });

  it('serves /health/ready with 200 {"status":"ready","docker":"down"} when requireDocker=false and docker is down', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {},
      checkDocker: async () => false,
      getDockerStatus: () => 'down',
      requireDocker: false,
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ready', docker: 'down' });
  });

  it('serves /health/ready with 200 {"status":"ready","docker":"up"} when requireDocker=false and docker is up', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {},
      checkDocker: async () => true,
      getDockerStatus: () => 'up',
      requireDocker: false,
    });
    await server.listen();

    const res = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ready', docker: 'up' });
  });

  it('recovers readiness after transient Redis failure (503 -> 503 -> 200)', async () => {
    let attempts = 0;
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {
        attempts++;
        if (attempts <= 2) {
          throw new Error('REDIS_TRANSIENT_BLIP');
        }
      },
    });
    await server.listen();

    const res1 = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res1.statusCode).toBe(503);
    expect(JSON.parse(res1.body)).toEqual({ status: 'not_ready' });

    const res2 = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res2.statusCode).toBe(503);
    expect(JSON.parse(res2.body)).toEqual({ status: 'not_ready' });

    const res3 = await httpRequest(`http://127.0.0.1:${server.port}/health/ready`);
    expect(res3.statusCode).toBe(200);
    expect(JSON.parse(res3.body)).toEqual({ status: 'ready' });
  });

  it('returns 404 for unmapped paths or non-GET methods', async () => {
    server = createMetricsServer({
      host: '127.0.0.1',
      port: 0,
      isReady: () => true,
      checkPostgres: async () => {},
      checkRedis: async () => {},
    });
    await server.listen();

    const postRes = await httpRequest(`http://127.0.0.1:${server.port}/health/live`, 'POST');
    expect(postRes.statusCode).toBe(404);

    const unknownPath = await httpRequest(`http://127.0.0.1:${server.port}/api/v1/unknown`);
    expect(unknownPath.statusCode).toBe(404);
  });
});
