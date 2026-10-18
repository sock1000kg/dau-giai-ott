import { DEAD_LETTER_QUEUE_NAME, MATCH_QUEUE_NAME } from '@ott/job-contract';

export interface ConfigIssue {
  readonly variable: string;
  readonly reason: string;
}

export class WorkerRuntimeConfigError extends Error {
  public readonly issues: readonly ConfigIssue[];

  public constructor(issues: readonly ConfigIssue[]) {
    const summary = issues.map((i) => `${i.variable}: ${i.reason}`).join('; ');
    super(`Worker runtime configuration error: ${summary}`);
    this.name = 'WorkerRuntimeConfigError';
    this.issues = issues;
  }
}

export interface WorkerRuntimeConfig {
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
  readonly deadLetterQueueName: string;
  readonly workerId?: string | undefined;
  readonly concurrency: {
    readonly max: number;
    readonly min: number;
  };
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTtlSeconds: number;
  readonly metrics: {
    readonly host: string;
    readonly port: number;
  } | null;
  readonly dockerSocketPath: string;
  readonly requireDocker: boolean;
  readonly shutdownTimeoutMs: number;
}

function isValidUrlWithScheme(raw: string, allowedSchemes: readonly string[]): boolean {
  try {
    const parsed = new URL(raw);
    return allowedSchemes.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function loadWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): WorkerRuntimeConfig {
  const issues: ConfigIssue[] = [];

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

  // OTT_DEAD_LETTER_QUEUE (default: DEAD_LETTER_QUEUE_NAME = 'ott.match.dead-letter.v1')
  const dlqRaw = env.OTT_DEAD_LETTER_QUEUE;
  const deadLetterQueueName = (dlqRaw !== undefined && dlqRaw.trim() !== '') ? dlqRaw.trim() : DEAD_LETTER_QUEUE_NAME;

  // OTT_WORKER_ID (optional)
  const workerIdRaw = env.OTT_WORKER_ID;
  const workerId = (workerIdRaw !== undefined && workerIdRaw.trim() !== '') ? workerIdRaw.trim() : undefined;

  // OTT_WORKER_MAX_CONCURRENCY (default: 4)
  let maxConcurrency = 4;
  if (env.OTT_WORKER_MAX_CONCURRENCY !== undefined && env.OTT_WORKER_MAX_CONCURRENCY.trim() !== '') {
    const parsed = Number(env.OTT_WORKER_MAX_CONCURRENCY.trim());
    if (!Number.isInteger(parsed) || parsed < 1) {
      issues.push({
        variable: 'OTT_WORKER_MAX_CONCURRENCY',
        reason: 'must be an integer greater than or equal to 1',
      });
    } else {
      maxConcurrency = parsed;
    }
  }

  // OTT_WORKER_MIN_CONCURRENCY (default: 1)
  let minConcurrency = 1;
  if (env.OTT_WORKER_MIN_CONCURRENCY !== undefined && env.OTT_WORKER_MIN_CONCURRENCY.trim() !== '') {
    const parsed = Number(env.OTT_WORKER_MIN_CONCURRENCY.trim());
    if (!Number.isInteger(parsed) || parsed < 1) {
      issues.push({
        variable: 'OTT_WORKER_MIN_CONCURRENCY',
        reason: 'must be an integer greater than or equal to 1',
      });
    } else {
      minConcurrency = parsed;
    }
  }

  if (minConcurrency > maxConcurrency) {
    issues.push({
      variable: 'OTT_WORKER_MIN_CONCURRENCY',
      reason: 'must be less than or equal to OTT_WORKER_MAX_CONCURRENCY',
    });
  }

  // OTT_WORKER_HEARTBEAT_MS (default: 5000)
  let heartbeatIntervalMs = 5000;
  if (env.OTT_WORKER_HEARTBEAT_MS !== undefined && env.OTT_WORKER_HEARTBEAT_MS.trim() !== '') {
    const parsed = Number(env.OTT_WORKER_HEARTBEAT_MS.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      issues.push({
        variable: 'OTT_WORKER_HEARTBEAT_MS',
        reason: 'must be a positive integer',
      });
    } else {
      heartbeatIntervalMs = parsed;
    }
  }

  // OTT_WORKER_HEARTBEAT_TTL_SECONDS (default: 15)
  let heartbeatTtlSeconds = 15;
  if (env.OTT_WORKER_HEARTBEAT_TTL_SECONDS !== undefined && env.OTT_WORKER_HEARTBEAT_TTL_SECONDS.trim() !== '') {
    const parsed = Number(env.OTT_WORKER_HEARTBEAT_TTL_SECONDS.trim());
    if (!Number.isInteger(parsed) || parsed <= 0) {
      issues.push({
        variable: 'OTT_WORKER_HEARTBEAT_TTL_SECONDS',
        reason: 'must be a positive integer',
      });
    } else {
      heartbeatTtlSeconds = parsed;
    }
  }

  if (heartbeatTtlSeconds * 1000 <= heartbeatIntervalMs) {
    issues.push({
      variable: 'OTT_WORKER_HEARTBEAT_TTL_SECONDS',
      reason: 'must be greater than heartbeat interval',
    });
  }

  // OTT_WORKER_METRICS_HOST (default: 127.0.0.1)
  const metricsHostRaw = env.OTT_WORKER_METRICS_HOST;
  const metricsHost = (metricsHostRaw !== undefined && metricsHostRaw.trim() !== '') ? metricsHostRaw.trim() : '127.0.0.1';

  // OTT_WORKER_METRICS_PORT (default: 9464; 0 = ephemeral, empty or 'off' = disabled)
  let metricsPort: number | null = 9464;
  const metricsPortRaw = env.OTT_WORKER_METRICS_PORT;
  if (metricsPortRaw !== undefined) {
    const trimmed = metricsPortRaw.trim().toLowerCase();
    if (trimmed === '' || trimmed === 'off') {
      metricsPort = null;
    } else {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        issues.push({
          variable: 'OTT_WORKER_METRICS_PORT',
          reason: 'must be an integer between 0 and 65535, or "off"',
        });
      } else {
        metricsPort = parsed;
      }
    }
  }

  // OTT_DOCKER_SOCKET (default: /var/run/docker.sock)
  const dockerSocketRaw = env.OTT_DOCKER_SOCKET;
  const dockerSocketPath = (dockerSocketRaw !== undefined && dockerSocketRaw.trim() !== '') ? dockerSocketRaw.trim() : '/var/run/docker.sock';

  // OTT_WORKER_REQUIRE_DOCKER (default: true)
  let requireDocker = true;
  if (env.OTT_WORKER_REQUIRE_DOCKER !== undefined && env.OTT_WORKER_REQUIRE_DOCKER.trim() !== '') {
    const trimmed = env.OTT_WORKER_REQUIRE_DOCKER.trim().toLowerCase();
    if (trimmed === 'true') {
      requireDocker = true;
    } else if (trimmed === 'false') {
      requireDocker = false;
    } else {
      issues.push({
        variable: 'OTT_WORKER_REQUIRE_DOCKER',
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

  if (issues.length > 0) {
    throw new WorkerRuntimeConfigError(issues);
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
    deadLetterQueueName,
    workerId,
    concurrency: {
      max: maxConcurrency,
      min: minConcurrency,
    },
    heartbeatIntervalMs,
    heartbeatTtlSeconds,
    metrics: metricsPort === null ? null : { host: metricsHost, port: metricsPort },
    dockerSocketPath,
    requireDocker,
    shutdownTimeoutMs,
  };
}
