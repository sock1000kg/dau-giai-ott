import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CoordinatorConfigError,
  DEFAULT_PUBLIC_EDITORIAL,
  loadCoordinatorConfig,
  type PublicEditorial,
} from '../src/coordinator/config.ts';

const VALID_BASE_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1:5432/ott_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_BUCKET: 'ott-submissions-test',
  S3_ACCESS_KEY_ID: 'minio-admin',
  S3_SECRET_ACCESS_KEY: 'minio-secret',
};

describe('Coordinator Configuration (P2-T32)', () => {
  it('loads valid configuration with complete defaults', () => {
    const config = loadCoordinatorConfig(VALID_BASE_ENV);

    expect(config.databaseUrl).toBe(VALID_BASE_ENV.DATABASE_URL);
    expect(config.redisUrl).toBe(VALID_BASE_ENV.REDIS_URL);
    expect(config.s3).toEqual({
      endpoint: 'http://127.0.0.1:8333',
      region: 'us-east-1',
      bucket: 'ott-submissions-test',
      accessKeyId: 'minio-admin',
      secretAccessKey: 'minio-secret',
    });
    expect(config.queueName).toBe('ott.match.v1');
    expect(config.dockerSocketPath).toBe('/var/run/docker.sock');
    expect(config.requireDocker).toBe(true);
    expect(config.shutdownTimeoutMs).toBe(30000);
    expect(config.preflightIntervalMs).toBe(2000);
    expect(config.preflightBatch).toBe(2);
    expect(config.dispatchIntervalMs).toBe(1000);
    expect(config.dispatchLimit).toBe(100);
    expect(config.settleIntervalMs).toBe(5000);
    expect(config.snapshotIntervalMs).toBe(30000);
    // repo root derived from this test file (src/platform/worker/tests -> four levels up), never from the cwd
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    expect(config.snapshotDir).toBe(path.resolve(repoRoot, 'src/platform/web/public/snapshots'));
    expect(config.snapshotKeep).toBe(24);
    expect(config.editorialFile).toBeNull();
    expect(config.initialEditorial).toEqual(DEFAULT_PUBLIC_EDITORIAL);
    expect(config.retention).toBe('off');
    expect(config.retentionIntervalMs).toBe(3600000);
    expect(config.metrics).toEqual({ host: '127.0.0.1', port: 9465 });
  });

  it('aggregates multiple missing variable issues names-only without leaking values', () => {
    try {
      loadCoordinatorConfig({});
      expect.unreachable('Should have thrown CoordinatorConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(CoordinatorConfigError);
      const configErr = err as CoordinatorConfigError;
      const vars = configErr.issues.map((i) => i.variable);
      expect(vars).toContain('DATABASE_URL');
      expect(vars).toContain('REDIS_URL');
      expect(vars).toContain('S3_ENDPOINT');
      expect(vars).toContain('S3_BUCKET');
      expect(vars).toContain('S3_ACCESS_KEY_ID');
      expect(vars).toContain('S3_SECRET_ACCESS_KEY');
      expect(configErr.message).toContain('Coordinator configuration error');
      expect(configErr.name).toBe('CoordinatorConfigError');
    }
  });

  it('validates URL schemes strictly', () => {
    expect(() =>
      loadCoordinatorConfig({
        ...VALID_BASE_ENV,
        DATABASE_URL: 'mysql://root@localhost/db',
        REDIS_URL: 'http://localhost:6379',
        S3_ENDPOINT: 'ftp://localhost:8333',
      }),
    ).toThrowError(/DATABASE_URL.*REDIS_URL.*S3_ENDPOINT/);
  });

  it('validates intervals and batch limits strictly', () => {
    expect(() =>
      loadCoordinatorConfig({
        ...VALID_BASE_ENV,
        OTT_COORD_PREFLIGHT_INTERVAL_MS: '50',
        OTT_COORD_PREFLIGHT_BATCH: '10',
        OTT_COORD_DISPATCH_INTERVAL_MS: '99',
        OTT_COORD_DISPATCH_LIMIT: '0',
        OTT_COORD_SETTLE_INTERVAL_MS: '0',
        OTT_COORD_SNAPSHOT_INTERVAL_MS: '50', // 0 is allowed, but 50 is < 100
        OTT_SNAPSHOT_KEEP: '0',
        OTT_COORD_RETENTION_INTERVAL_MS: '10',
      }),
    ).toThrowError(CoordinatorConfigError);
  });

  it('allows disabling snapshots with interval 0', () => {
    const config = loadCoordinatorConfig({
      ...VALID_BASE_ENV,
      OTT_COORD_SNAPSHOT_INTERVAL_MS: '0',
    });
    expect(config.snapshotIntervalMs).toBe(0);
  });

  it('validates retention modes strictly and rejects "on"', () => {
    const dryRunConfig = loadCoordinatorConfig({
      ...VALID_BASE_ENV,
      OTT_COORD_RETENTION: 'dry-run',
    });
    expect(dryRunConfig.retention).toBe('dry-run');

    expect(() =>
      loadCoordinatorConfig({
        ...VALID_BASE_ENV,
        OTT_COORD_RETENTION: 'on', // Real pruning is deliberately not offered
      }),
    ).toThrowError(/OTT_COORD_RETENTION/);

    expect(() =>
      loadCoordinatorConfig({
        ...VALID_BASE_ENV,
        OTT_COORD_RETENTION: 'enabled',
      }),
    ).toThrowError(/OTT_COORD_RETENTION/);
  });

  it('handles metrics port disabled and ephemeral', () => {
    const disabledConfig = loadCoordinatorConfig({
      ...VALID_BASE_ENV,
      OTT_COORD_METRICS_PORT: 'off',
    });
    expect(disabledConfig.metrics).toBeNull();

    const emptyDisabledConfig = loadCoordinatorConfig({
      ...VALID_BASE_ENV,
      OTT_COORD_METRICS_PORT: '',
    });
    expect(emptyDisabledConfig.metrics).toBeNull();

    const ephemeralConfig = loadCoordinatorConfig({
      ...VALID_BASE_ENV,
      OTT_COORD_METRICS_PORT: '0',
    });
    expect(ephemeralConfig.metrics?.port).toBe(0);
  });

  it('validates editorial file when provided and rejects malformed content without leaking file content', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-coord-test-'));
    const validEditorialPath = path.join(tmpDir, 'editorial.json');
    const validEditorial: PublicEditorial = {
      announcements: [{ title: 'Notice', body: 'Test notice body' }],
      faq: [{ title: 'Q1', body: 'A1' }],
      status: { message: 'All good', incidentEta: null },
      changelog: 'Initial version',
      minimumSeries: 3,
    };
    fs.writeFileSync(validEditorialPath, JSON.stringify(validEditorial));

    const config = loadCoordinatorConfig({
      ...VALID_BASE_ENV,
      OTT_EDITORIAL_FILE: validEditorialPath,
    });
    expect(config.editorialFile).toBe(validEditorialPath);
    expect(config.initialEditorial).toEqual(validEditorial);

    // Invalid editorial file (malformed JSON or invalid schema)
    const invalidPath = path.join(tmpDir, 'invalid.json');
    const secretCanary = 'SECRET_CANARY_DO_NOT_LEAK';
    fs.writeFileSync(invalidPath, JSON.stringify({ secret: secretCanary, announcements: 'not-an-array' }));

    try {
      loadCoordinatorConfig({
        ...VALID_BASE_ENV,
        OTT_EDITORIAL_FILE: invalidPath,
      });
      expect.unreachable('Should have thrown CoordinatorConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(CoordinatorConfigError);
      const errorMsg = (err as Error).message;
      expect(errorMsg).toContain('OTT_EDITORIAL_FILE');
      expect(errorMsg).not.toContain(secretCanary);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
