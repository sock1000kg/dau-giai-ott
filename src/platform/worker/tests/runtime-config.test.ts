import { describe, expect, it } from 'vitest';
import {
  loadWorkerRuntimeConfig,
  WorkerRuntimeConfigError,
} from '../src/runtime/config.ts';

const validEnv: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1:5432/ott_test',
  REDIS_URL: 'redis://:supersecret@127.0.0.1:6379/0',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_BUCKET: 'ott-bucket',
  S3_ACCESS_KEY_ID: 'admin-key',
  S3_SECRET_ACCESS_KEY: 'topsecretkey',
};

describe('WorkerRuntimeConfig (P3-D32)', () => {
  it('loads valid configuration with canonical defaults', () => {
    const config = loadWorkerRuntimeConfig(validEnv);

    expect(config.databaseUrl).toBe(validEnv.DATABASE_URL);
    expect(config.redisUrl).toBe(validEnv.REDIS_URL);
    expect(config.s3).toEqual({
      endpoint: 'http://127.0.0.1:8333',
      region: 'us-east-1',
      bucket: 'ott-bucket',
      accessKeyId: 'admin-key',
      secretAccessKey: 'topsecretkey',
    });
    expect(config.queueName).toBe('ott.match.v1');
    expect(config.deadLetterQueueName).toBe('ott.match.dead-letter.v1');
    expect(config.workerId).toBeUndefined();
    expect(config.concurrency).toEqual({ max: 4, min: 1 });
    expect(config.heartbeatIntervalMs).toBe(5000);
    expect(config.heartbeatTtlSeconds).toBe(15);
    expect(config.metrics).toEqual({ host: '127.0.0.1', port: 9464 });
    expect(config.dockerSocketPath).toBe('/var/run/docker.sock');
    expect(config.requireDocker).toBe(true);
    expect(config.shutdownTimeoutMs).toBe(30000);
  });

  it('aggregates all missing required variables into a single WorkerRuntimeConfigError', () => {
    expect(() => loadWorkerRuntimeConfig({})).toThrowError(WorkerRuntimeConfigError);

    try {
      loadWorkerRuntimeConfig({});
    } catch (err) {
      expect(err).toBeInstanceOf(WorkerRuntimeConfigError);
      const confErr = err as WorkerRuntimeConfigError;
      const vars = confErr.issues.map((i) => i.variable);
      expect(vars).toContain('DATABASE_URL');
      expect(vars).toContain('REDIS_URL');
      expect(vars).toContain('S3_ENDPOINT');
      expect(vars).toContain('S3_BUCKET');
      expect(vars).toContain('S3_ACCESS_KEY_ID');
      expect(vars).toContain('S3_SECRET_ACCESS_KEY');
    }
  });

  it('never leaks credential strings or sensitive URL values in error message', () => {
    const sensitiveEnv = {
      DATABASE_URL: 'not-a-valid-scheme://admin:SUPER_SECRET_DB_PASSWORD@127.0.0.1/db',
      REDIS_URL: 'http://redis:SECRET_REDIS_AUTH@127.0.0.1',
      S3_ENDPOINT: 'ftp://admin:SECRET_S3_KEY@127.0.0.1',
      S3_BUCKET: 'bucket',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
    };

    try {
      loadWorkerRuntimeConfig(sensitiveEnv);
      expect.fail('Should have thrown WorkerRuntimeConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkerRuntimeConfigError);
      const confErr = err as WorkerRuntimeConfigError;
      expect(confErr.message).not.toContain('SUPER_SECRET_DB_PASSWORD');
      expect(confErr.message).not.toContain('SECRET_REDIS_AUTH');
      expect(confErr.message).not.toContain('SECRET_S3_KEY');
      expect(confErr.message).not.toContain('admin:');
      for (const issue of confErr.issues) {
        expect(issue.reason).not.toContain('SUPER_SECRET_DB_PASSWORD');
        expect(issue.reason).not.toContain('SECRET_REDIS_AUTH');
        expect(issue.reason).not.toContain('SECRET_S3_KEY');
      }
    }
  });

  it('validates concurrency bounds: max >= 1, min >= 1, and min <= max', () => {
    // max < 1
    expect(() =>
      loadWorkerRuntimeConfig({ ...validEnv, OTT_WORKER_MAX_CONCURRENCY: '0' }),
    ).toThrowError(WorkerRuntimeConfigError);

    // min < 1
    expect(() =>
      loadWorkerRuntimeConfig({ ...validEnv, OTT_WORKER_MIN_CONCURRENCY: '-1' }),
    ).toThrowError(WorkerRuntimeConfigError);

    // min > max
    try {
      loadWorkerRuntimeConfig({
        ...validEnv,
        OTT_WORKER_MAX_CONCURRENCY: '2',
        OTT_WORKER_MIN_CONCURRENCY: '5',
      });
      expect.fail('Should have failed min > max');
    } catch (err) {
      const confErr = err as WorkerRuntimeConfigError;
      const issue = confErr.issues.find((i) => i.variable === 'OTT_WORKER_MIN_CONCURRENCY');
      expect(issue?.reason).toContain('must be less than or equal to OTT_WORKER_MAX_CONCURRENCY');
    }
  });

  it('validates heartbeat TTL must be greater than heartbeat interval', () => {
    // ttl 5 seconds (5000 ms) <= heartbeat interval 5000 ms
    try {
      loadWorkerRuntimeConfig({
        ...validEnv,
        OTT_WORKER_HEARTBEAT_MS: '5000',
        OTT_WORKER_HEARTBEAT_TTL_SECONDS: '5',
      });
      expect.fail('Should have failed ttl <= heartbeat');
    } catch (err) {
      const confErr = err as WorkerRuntimeConfigError;
      const issue = confErr.issues.find((i) => i.variable === 'OTT_WORKER_HEARTBEAT_TTL_SECONDS');
      expect(issue?.reason).toContain('must be greater than heartbeat interval');
    }

    // ttl 6 seconds (6000 ms) > heartbeat interval 5000 ms
    const config = loadWorkerRuntimeConfig({
      ...validEnv,
      OTT_WORKER_HEARTBEAT_MS: '5000',
      OTT_WORKER_HEARTBEAT_TTL_SECONDS: '6',
    });
    expect(config.heartbeatIntervalMs).toBe(5000);
    expect(config.heartbeatTtlSeconds).toBe(6);
  });

  it('handles metrics disabled via "off" or empty string, and ephemeral port 0', () => {
    // "off"
    const offConfig = loadWorkerRuntimeConfig({
      ...validEnv,
      OTT_WORKER_METRICS_PORT: 'off',
    });
    expect(offConfig.metrics).toBeNull();

    // empty string
    const emptyConfig = loadWorkerRuntimeConfig({
      ...validEnv,
      OTT_WORKER_METRICS_PORT: '',
    });
    expect(emptyConfig.metrics).toBeNull();

    // ephemeral port 0
    const zeroConfig = loadWorkerRuntimeConfig({
      ...validEnv,
      OTT_WORKER_METRICS_PORT: '0',
    });
    expect(zeroConfig.metrics).toEqual({ host: '127.0.0.1', port: 0 });

    // custom host and port
    const customConfig = loadWorkerRuntimeConfig({
      ...validEnv,
      OTT_WORKER_METRICS_HOST: '0.0.0.0',
      OTT_WORKER_METRICS_PORT: '9090',
    });
    expect(customConfig.metrics).toEqual({ host: '0.0.0.0', port: 9090 });
  });

  it('validates OTT_WORKER_REQUIRE_DOCKER boolean string and OTT_SHUTDOWN_TIMEOUT_MS', () => {
    // invalid boolean
    expect(() =>
      loadWorkerRuntimeConfig({ ...validEnv, OTT_WORKER_REQUIRE_DOCKER: 'yes' }),
    ).toThrowError(WorkerRuntimeConfigError);

    // false
    const noDocker = loadWorkerRuntimeConfig({
      ...validEnv,
      OTT_WORKER_REQUIRE_DOCKER: 'false',
    });
    expect(noDocker.requireDocker).toBe(false);

    // invalid shutdown timeout
    expect(() =>
      loadWorkerRuntimeConfig({ ...validEnv, OTT_SHUTDOWN_TIMEOUT_MS: '0' }),
    ).toThrowError(WorkerRuntimeConfigError);

    // custom shutdown timeout
    const customTimeout = loadWorkerRuntimeConfig({
      ...validEnv,
      OTT_SHUTDOWN_TIMEOUT_MS: '45000',
    });
    expect(customTimeout.shutdownTimeoutMs).toBe(45000);
  });
});
