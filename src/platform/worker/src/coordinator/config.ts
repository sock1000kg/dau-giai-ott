import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATCH_QUEUE_NAME } from '@ott/job-contract';

export interface PublicEditorial {
  announcements: { title: string; body: string }[];
  faq: { title: string; body: string }[];
  status: { message: string; incidentEta: string | null };
  changelog: string;
  minimumSeries: number;
}

export const DEFAULT_PUBLIC_EDITORIAL: PublicEditorial = {
  announcements: [],
  faq: [],
  status: { message: 'Hệ thống hoạt động bình thường', incidentEta: null },
  changelog: '',
  minimumSeries: 5,
};

export interface CoordinatorConfigIssue {
  readonly variable: string;
  readonly reason: string;
}

export class CoordinatorConfigError extends Error {
  public readonly issues: readonly CoordinatorConfigIssue[];

  public constructor(issues: readonly CoordinatorConfigIssue[]) {
    const summary = issues.map((i) => `${i.variable}: ${i.reason}`).join('; ');
    super(`Coordinator configuration error: ${summary}`);
    this.name = 'CoordinatorConfigError';
    this.issues = issues;
  }
}

export interface CoordinatorConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly queueName: string;
  readonly dockerSocketPath: string;
  readonly requireDocker: boolean;
  readonly shutdownTimeoutMs: number;
  readonly preflightIntervalMs: number;
  readonly preflightBatch: number;
  readonly dispatchIntervalMs: number;
  readonly dispatchLimit: number;
  readonly settleIntervalMs: number;
  readonly snapshotIntervalMs: number;
  readonly snapshotDir: string;
  readonly snapshotKeep: number;
  readonly editorialFile: string | null;
  readonly initialEditorial: PublicEditorial;
  readonly retention: 'off' | 'dry-run';
  readonly retentionIntervalMs: number;
  readonly metrics: {
    readonly host: string;
    readonly port: number;
  } | null;
}

function isValidUrlWithScheme(raw: string, allowedSchemes: readonly string[]): boolean {
  try {
    const parsed = new URL(raw);
    return allowedSchemes.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function validateEditorial(raw: unknown): { valid: true; value: PublicEditorial } | { valid: false } {
  if (typeof raw !== 'object' || raw === null) return { valid: false };
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.announcements)) return { valid: false };
  for (const item of obj.announcements) {
    if (typeof item !== 'object' || item === null) return { valid: false };
    const itemObj = item as Record<string, unknown>;
    if (typeof itemObj.title !== 'string' || typeof itemObj.body !== 'string') return { valid: false };
  }

  if (!Array.isArray(obj.faq)) return { valid: false };
  for (const item of obj.faq) {
    if (typeof item !== 'object' || item === null) return { valid: false };
    const itemObj = item as Record<string, unknown>;
    if (typeof itemObj.title !== 'string' || typeof itemObj.body !== 'string') return { valid: false };
  }

  if (typeof obj.status !== 'object' || obj.status === null) return { valid: false };
  const statusObj = obj.status as Record<string, unknown>;
  if (typeof statusObj.message !== 'string') return { valid: false };
  if (statusObj.incidentEta !== null && typeof statusObj.incidentEta !== 'string') return { valid: false };

  if (typeof obj.changelog !== 'string') return { valid: false };
  if (typeof obj.minimumSeries !== 'number' || !Number.isInteger(obj.minimumSeries) || obj.minimumSeries < 0) {
    return { valid: false };
  }

  return {
    valid: true,
    value: {
      announcements: obj.announcements.map((a: any) => ({ title: a.title, body: a.body })),
      faq: obj.faq.map((f: any) => ({ title: f.title, body: f.body })),
      status: { message: statusObj.message, incidentEta: (statusObj.incidentEta as string | null) ?? null },
      changelog: obj.changelog,
      minimumSeries: obj.minimumSeries,
    },
  };
}

export function loadCoordinatorConfig(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): CoordinatorConfig {
  const issues: CoordinatorConfigIssue[] = [];

  // 1. DATABASE_URL
  const databaseUrlRaw = env.DATABASE_URL;
  let databaseUrl = '';
  if (databaseUrlRaw === undefined || databaseUrlRaw.trim() === '') {
    issues.push({ variable: 'DATABASE_URL', reason: 'missing required environment variable' });
  } else if (!isValidUrlWithScheme(databaseUrlRaw, ['postgres:', 'postgresql:'])) {
    issues.push({
      variable: 'DATABASE_URL',
      reason: 'must be a valid URL with scheme postgres:// or postgresql://',
    });
  } else {
    databaseUrl = databaseUrlRaw;
  }

  // 2. REDIS_URL
  const redisUrlRaw = env.REDIS_URL;
  let redisUrl = '';
  if (redisUrlRaw === undefined || redisUrlRaw.trim() === '') {
    issues.push({ variable: 'REDIS_URL', reason: 'missing required environment variable' });
  } else if (!isValidUrlWithScheme(redisUrlRaw, ['redis:', 'rediss:'])) {
    issues.push({
      variable: 'REDIS_URL',
      reason: 'must be a valid URL with scheme redis:// or rediss://',
    });
  } else {
    redisUrl = redisUrlRaw;
  }

  // 3. S3_ENDPOINT
  const s3EndpointRaw = env.S3_ENDPOINT;
  let s3Endpoint = '';
  if (s3EndpointRaw === undefined || s3EndpointRaw.trim() === '') {
    issues.push({ variable: 'S3_ENDPOINT', reason: 'missing required environment variable' });
  } else if (!isValidUrlWithScheme(s3EndpointRaw, ['http:', 'https:'])) {
    issues.push({
      variable: 'S3_ENDPOINT',
      reason: 'must be a valid URL with scheme http:// or https://',
    });
  } else {
    s3Endpoint = s3EndpointRaw;
  }

  // 4. S3_BUCKET
  const s3BucketRaw = env.S3_BUCKET;
  let s3Bucket = '';
  if (s3BucketRaw === undefined || s3BucketRaw.trim() === '') {
    issues.push({ variable: 'S3_BUCKET', reason: 'missing required environment variable' });
  } else {
    s3Bucket = s3BucketRaw.trim();
  }

  // 5. S3_ACCESS_KEY_ID
  const s3AccessKeyIdRaw = env.S3_ACCESS_KEY_ID;
  let s3AccessKeyId = '';
  if (s3AccessKeyIdRaw === undefined || s3AccessKeyIdRaw.trim() === '') {
    issues.push({ variable: 'S3_ACCESS_KEY_ID', reason: 'missing required environment variable' });
  } else {
    s3AccessKeyId = s3AccessKeyIdRaw.trim();
  }

  // 6. S3_SECRET_ACCESS_KEY
  const s3SecretAccessKeyRaw = env.S3_SECRET_ACCESS_KEY;
  let s3SecretAccessKey = '';
  if (s3SecretAccessKeyRaw === undefined || s3SecretAccessKeyRaw.trim() === '') {
    issues.push({ variable: 'S3_SECRET_ACCESS_KEY', reason: 'missing required environment variable' });
  } else {
    s3SecretAccessKey = s3SecretAccessKeyRaw.trim();
  }

  // S3_REGION (default: us-east-1)
  const s3RegionRaw = env.S3_REGION;
  const s3Region = (s3RegionRaw !== undefined && s3RegionRaw.trim() !== '') ? s3RegionRaw.trim() : 'us-east-1';

  // OTT_MATCH_QUEUE (default: MATCH_QUEUE_NAME = 'ott.match.v1')
  const queueNameRaw = env.OTT_MATCH_QUEUE;
  const queueName = (queueNameRaw !== undefined && queueNameRaw.trim() !== '') ? queueNameRaw.trim() : MATCH_QUEUE_NAME;

  // OTT_DOCKER_SOCKET (default: /var/run/docker.sock)
  const dockerSocketRaw = env.OTT_DOCKER_SOCKET;
  const dockerSocketPath = (dockerSocketRaw !== undefined && dockerSocketRaw.trim() !== '')
    ? dockerSocketRaw.trim()
    : '/var/run/docker.sock';

  // OTT_COORD_REQUIRE_DOCKER (default: true)
  let requireDocker = true;
  if (env.OTT_COORD_REQUIRE_DOCKER !== undefined && env.OTT_COORD_REQUIRE_DOCKER.trim() !== '') {
    const trimmed = env.OTT_COORD_REQUIRE_DOCKER.trim().toLowerCase();
    if (trimmed === 'true') {
      requireDocker = true;
    } else if (trimmed === 'false') {
      requireDocker = false;
    } else {
      issues.push({
        variable: 'OTT_COORD_REQUIRE_DOCKER',
        reason: 'must be "true" or "false"',
      });
    }
  }

  // OTT_SHUTDOWN_TIMEOUT_MS (default: 30000)
  let shutdownTimeoutMs = 30000;
  if (env.OTT_SHUTDOWN_TIMEOUT_MS !== undefined && env.OTT_SHUTDOWN_TIMEOUT_MS.trim() !== '') {
    const parsed = Number(env.OTT_SHUTDOWN_TIMEOUT_MS.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      issues.push({
        variable: 'OTT_SHUTDOWN_TIMEOUT_MS',
        reason: 'must be a positive integer',
      });
    } else {
      shutdownTimeoutMs = parsed;
    }
  }

  // OTT_COORD_PREFLIGHT_INTERVAL_MS (default: 2000, >= 100)
  let preflightIntervalMs = 2000;
  if (env.OTT_COORD_PREFLIGHT_INTERVAL_MS !== undefined && env.OTT_COORD_PREFLIGHT_INTERVAL_MS.trim() !== '') {
    const parsed = Number(env.OTT_COORD_PREFLIGHT_INTERVAL_MS.trim());
    if (!Number.isInteger(parsed) || parsed < 100) {
      issues.push({
        variable: 'OTT_COORD_PREFLIGHT_INTERVAL_MS',
        reason: 'must be an integer greater than or equal to 100',
      });
    } else {
      preflightIntervalMs = parsed;
    }
  }

  // OTT_COORD_PREFLIGHT_BATCH (default: 2, 1-8)
  let preflightBatch = 2;
  if (env.OTT_COORD_PREFLIGHT_BATCH !== undefined && env.OTT_COORD_PREFLIGHT_BATCH.trim() !== '') {
    const parsed = Number(env.OTT_COORD_PREFLIGHT_BATCH.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
      issues.push({
        variable: 'OTT_COORD_PREFLIGHT_BATCH',
        reason: 'must be an integer between 1 and 8',
      });
    } else {
      preflightBatch = parsed;
    }
  }

  // OTT_COORD_DISPATCH_INTERVAL_MS (default: 1000, >= 100)
  let dispatchIntervalMs = 1000;
  if (env.OTT_COORD_DISPATCH_INTERVAL_MS !== undefined && env.OTT_COORD_DISPATCH_INTERVAL_MS.trim() !== '') {
    const parsed = Number(env.OTT_COORD_DISPATCH_INTERVAL_MS.trim());
    if (!Number.isInteger(parsed) || parsed < 100) {
      issues.push({
        variable: 'OTT_COORD_DISPATCH_INTERVAL_MS',
        reason: 'must be an integer greater than or equal to 100',
      });
    } else {
      dispatchIntervalMs = parsed;
    }
  }

  // OTT_COORD_DISPATCH_LIMIT (default: 100, >= 1)
  let dispatchLimit = 100;
  if (env.OTT_COORD_DISPATCH_LIMIT !== undefined && env.OTT_COORD_DISPATCH_LIMIT.trim() !== '') {
    const parsed = Number(env.OTT_COORD_DISPATCH_LIMIT.trim());
    if (!Number.isInteger(parsed) || parsed < 1) {
      issues.push({
        variable: 'OTT_COORD_DISPATCH_LIMIT',
        reason: 'must be an integer greater than or equal to 1',
      });
    } else {
      dispatchLimit = parsed;
    }
  }

  // OTT_COORD_SETTLE_INTERVAL_MS (default: 5000, >= 100)
  let settleIntervalMs = 5000;
  if (env.OTT_COORD_SETTLE_INTERVAL_MS !== undefined && env.OTT_COORD_SETTLE_INTERVAL_MS.trim() !== '') {
    const parsed = Number(env.OTT_COORD_SETTLE_INTERVAL_MS.trim());
    if (!Number.isInteger(parsed) || parsed < 100) {
      issues.push({
        variable: 'OTT_COORD_SETTLE_INTERVAL_MS',
        reason: 'must be an integer greater than or equal to 100',
      });
    } else {
      settleIntervalMs = parsed;
    }
  }

  // OTT_COORD_SNAPSHOT_INTERVAL_MS (default: 5000, 0 disables or >= 100)
  let snapshotIntervalMs = 5000;
  if (env.OTT_COORD_SNAPSHOT_INTERVAL_MS !== undefined && env.OTT_COORD_SNAPSHOT_INTERVAL_MS.trim() !== '') {
    const parsed = Number(env.OTT_COORD_SNAPSHOT_INTERVAL_MS.trim());
    if (!Number.isInteger(parsed) || (parsed !== 0 && parsed < 100)) {
      issues.push({
        variable: 'OTT_COORD_SNAPSHOT_INTERVAL_MS',
        reason: 'must be 0 (disabled) or an integer greater than or equal to 100',
      });
    } else {
      snapshotIntervalMs = parsed;
    }
  }

  // OTT_SNAPSHOT_DIR (default: <repo root>/src/platform/web/public/snapshots, independent of the process cwd;
  // an explicit relative value is resolved against the cwd)
  const snapshotDirRaw = env.OTT_SNAPSHOT_DIR;
  const snapshotDir = (snapshotDirRaw !== undefined && snapshotDirRaw.trim() !== '')
    ? path.resolve(process.cwd(), snapshotDirRaw.trim())
    : path.resolve(fileURLToPath(new URL('../../../../../', import.meta.url)), 'src/platform/web/public/snapshots');

  // OTT_SNAPSHOT_KEEP (default: 24, >= 1)
  let snapshotKeep = 24;
  if (env.OTT_SNAPSHOT_KEEP !== undefined && env.OTT_SNAPSHOT_KEEP.trim() !== '') {
    const parsed = Number(env.OTT_SNAPSHOT_KEEP.trim());
    if (!Number.isInteger(parsed) || parsed < 1) {
      issues.push({
        variable: 'OTT_SNAPSHOT_KEEP',
        reason: 'must be an integer greater than or equal to 1',
      });
    } else {
      snapshotKeep = parsed;
    }
  }

  // OTT_EDITORIAL_FILE (optional)
  let editorialFile: string | null = null;
  let initialEditorial: PublicEditorial = DEFAULT_PUBLIC_EDITORIAL;
  if (env.OTT_EDITORIAL_FILE !== undefined && env.OTT_EDITORIAL_FILE.trim() !== '') {
    editorialFile = path.resolve(process.cwd(), env.OTT_EDITORIAL_FILE.trim());
    try {
      const content = fs.readFileSync(editorialFile, 'utf8');
      const parsed = JSON.parse(content) as unknown;
      const validated = validateEditorial(parsed);
      if (!validated.valid) {
        issues.push({
          variable: 'OTT_EDITORIAL_FILE',
          reason: 'must point to a valid public editorial JSON file',
        });
      } else {
        initialEditorial = validated.value;
      }
    } catch {
      issues.push({
        variable: 'OTT_EDITORIAL_FILE',
        reason: 'must point to a valid readable public editorial JSON file',
      });
    }
  }

  // OTT_COORD_RETENTION (default: 'off', allowed: 'off' | 'dry-run')
  let retention: 'off' | 'dry-run' = 'off';
  if (env.OTT_COORD_RETENTION !== undefined && env.OTT_COORD_RETENTION.trim() !== '') {
    const trimmed = env.OTT_COORD_RETENTION.trim().toLowerCase();
    if (trimmed === 'off') {
      retention = 'off';
    } else if (trimmed === 'dry-run') {
      retention = 'dry-run';
    } else {
      issues.push({
        variable: 'OTT_COORD_RETENTION',
        reason: 'must be "off" or "dry-run"',
      });
    }
  }

  // OTT_COORD_RETENTION_INTERVAL_MS (default: 3600000, >= 100)
  let retentionIntervalMs = 3600000;
  if (env.OTT_COORD_RETENTION_INTERVAL_MS !== undefined && env.OTT_COORD_RETENTION_INTERVAL_MS.trim() !== '') {
    const parsed = Number(env.OTT_COORD_RETENTION_INTERVAL_MS.trim());
    if (!Number.isInteger(parsed) || parsed < 100) {
      issues.push({
        variable: 'OTT_COORD_RETENTION_INTERVAL_MS',
        reason: 'must be an integer greater than or equal to 100',
      });
    } else {
      retentionIntervalMs = parsed;
    }
  }

  // OTT_COORD_METRICS_HOST (default: 127.0.0.1)
  const metricsHostRaw = env.OTT_COORD_METRICS_HOST;
  const metricsHost = (metricsHostRaw !== undefined && metricsHostRaw.trim() !== '')
    ? metricsHostRaw.trim()
    : '127.0.0.1';

  // OTT_COORD_METRICS_PORT (default: 9465; 0 = ephemeral, empty or 'off' = disabled)
  let metricsPort: number | null = 9465;
  const metricsPortRaw = env.OTT_COORD_METRICS_PORT;
  if (metricsPortRaw !== undefined) {
    const trimmed = metricsPortRaw.trim().toLowerCase();
    if (trimmed === '' || trimmed === 'off') {
      metricsPort = null;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        issues.push({
          variable: 'OTT_COORD_METRICS_PORT',
          reason: 'must be an integer between 0 and 65535, or "off"',
        });
      } else {
        metricsPort = parsed;
      }
    }
  }

  if (issues.length > 0) {
    throw new CoordinatorConfigError(issues);
  }

  return {
    databaseUrl,
    redisUrl,
    s3: {
      endpoint: s3Endpoint,
      region: s3Region,
      bucket: s3Bucket,
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
    },
    queueName,
    dockerSocketPath,
    requireDocker,
    shutdownTimeoutMs,
    preflightIntervalMs,
    preflightBatch,
    dispatchIntervalMs,
    dispatchLimit,
    settleIntervalMs,
    snapshotIntervalMs,
    snapshotDir,
    snapshotKeep,
    editorialFile,
    initialEditorial,
    retention,
    retentionIntervalMs,
    metrics: metricsPort === null ? null : { host: metricsHost, port: metricsPort },
  };
}
