import { MATCH_QUEUE_NAME } from '@ott/job-contract';
import {
  isAmbiguousCidr,
  loadSecurityConfig,
  parseCidr,
  type SecurityConfig,
} from '../config/security.ts';

export interface ConfigIssue {
  readonly variable: string;
  readonly reason: string;
}

export class RuntimeConfigError extends Error {
  public readonly issues: readonly ConfigIssue[];

  public constructor(issues: readonly ConfigIssue[]) {
    const summary = issues.map((i) => `${i.variable}: ${i.reason}`).join('; ');
    super(`Runtime configuration error: ${summary}`);
    this.name = 'RuntimeConfigError';
    this.issues = issues;
  }
}

export interface RuntimeConfig {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly host: string;
  readonly port: number;
  readonly queueName: string;
  readonly runMigrations: boolean;
  readonly shutdownTimeoutMs: number;
  readonly security: SecurityConfig;
  readonly secureCookies: boolean;
  readonly bootstrap: {
    readonly username?: string;
    readonly password?: string;
    readonly totpSecret?: string;
  };
}

function isValidUrlWithScheme(raw: string, allowedSchemes: readonly string[]): boolean {
  try {
    const parsed = new URL(raw);
    return allowedSchemes.includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): RuntimeConfig {
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
  const s3Bucket = env.S3_BUCKET;
  if (s3Bucket === undefined || s3Bucket.trim() === '') {
    issues.push({ variable: 'S3_BUCKET', reason: 'missing required environment variable' });
  }

  // 5. S3_ACCESS_KEY_ID
  const s3AccessKeyId = env.S3_ACCESS_KEY_ID;
  if (s3AccessKeyId === undefined || s3AccessKeyId.trim() === '') {
    issues.push({ variable: 'S3_ACCESS_KEY_ID', reason: 'missing required environment variable' });
  }

  // 6. S3_SECRET_ACCESS_KEY
  const s3SecretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (s3SecretAccessKey === undefined || s3SecretAccessKey.trim() === '') {
    issues.push({ variable: 'S3_SECRET_ACCESS_KEY', reason: 'missing required environment variable' });
  }

  // S3_REGION (default: us-east-1)
  const s3RegionRaw = env.S3_REGION;
  const s3Region = (s3RegionRaw !== undefined && s3RegionRaw.trim() !== '') ? s3RegionRaw.trim() : 'us-east-1';

  // HOST (default: 127.0.0.1)
  const hostRaw = env.HOST;
  const host = (hostRaw !== undefined && hostRaw.trim() !== '') ? hostRaw.trim() : '127.0.0.1';

  // PORT (default: 3000, allowed: 0 to 65535)
  let port = 3000;
  if (env.PORT !== undefined && env.PORT.trim() !== '') {
    const portNum = Number(env.PORT.trim());
    if (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535) {
      issues.push({ variable: 'PORT', reason: 'must be an integer between 0 and 65535' });
    } else {
      port = portNum;
    }
  }

  // OTT_MATCH_QUEUE (default: MATCH_QUEUE_NAME)
  const queueNameRaw = env.OTT_MATCH_QUEUE;
  const queueName = (queueNameRaw !== undefined && queueNameRaw.trim() !== '') ? queueNameRaw.trim() : MATCH_QUEUE_NAME;

  // OTT_RUN_MIGRATIONS (default: false)
  let runMigrations = false;
  if (env.OTT_RUN_MIGRATIONS !== undefined && env.OTT_RUN_MIGRATIONS.trim() !== '') {
    const trimmed = env.OTT_RUN_MIGRATIONS.trim();
    if (trimmed === 'true') {
      runMigrations = true;
    } else if (trimmed === 'false') {
      runMigrations = false;
    } else {
      issues.push({ variable: 'OTT_RUN_MIGRATIONS', reason: 'must be "true" or "false"' });
    }
  }

  // OTT_SHUTDOWN_TIMEOUT_MS (default: 10000)
  let shutdownTimeoutMs = 10000;
  if (env.OTT_SHUTDOWN_TIMEOUT_MS !== undefined && env.OTT_SHUTDOWN_TIMEOUT_MS.trim() !== '') {
    const msNum = Number(env.OTT_SHUTDOWN_TIMEOUT_MS.trim());
    if (!Number.isInteger(msNum) || msNum <= 0) {
      issues.push({ variable: 'OTT_SHUTDOWN_TIMEOUT_MS', reason: 'must be a positive integer' });
    } else {
      shutdownTimeoutMs = msNum;
    }
  }

  // Bootstrap credentials
  const btcUserRaw = env.OTT_BOOTSTRAP_BTC_USERNAME;
  const btcPassRaw = env.OTT_BOOTSTRAP_BTC_PASSWORD;
  const btcTotpRaw = env.OTT_BOOTSTRAP_BTC_TOTP_SECRET;
  const hasUser = btcUserRaw !== undefined && btcUserRaw.trim() !== '';
  const hasPass = btcPassRaw !== undefined && btcPassRaw !== '';
  const hasTotpSecret = btcTotpRaw !== undefined && btcTotpRaw.trim() !== '';

  if (hasUser && !hasPass) {
    issues.push({
      variable: 'OTT_BOOTSTRAP_BTC_PASSWORD',
      reason: 'must be set when OTT_BOOTSTRAP_BTC_USERNAME is configured',
    });
  } else if (!hasUser && hasPass) {
    issues.push({
      variable: 'OTT_BOOTSTRAP_BTC_USERNAME',
      reason: 'must be set when OTT_BOOTSTRAP_BTC_PASSWORD is configured',
    });
  } else if (btcUserRaw !== undefined && btcUserRaw.trim() === '' && btcPassRaw !== undefined) {
    issues.push({
      variable: 'OTT_BOOTSTRAP_BTC_USERNAME',
      reason: 'cannot be empty when OTT_BOOTSTRAP_BTC_PASSWORD is configured',
    });
  } else if (btcPassRaw !== undefined && btcPassRaw === '' && btcUserRaw !== undefined) {
    issues.push({
      variable: 'OTT_BOOTSTRAP_BTC_PASSWORD',
      reason: 'cannot be empty when OTT_BOOTSTRAP_BTC_USERNAME is configured',
    });
  }

  if (hasTotpSecret) {
    const keyRaw = env.OTT_TOTP_ENCRYPTION_KEY;
    if (keyRaw === undefined || keyRaw.trim() === '') {
      issues.push({
        variable: 'OTT_TOTP_ENCRYPTION_KEY',
        reason: 'must be configured when OTT_BOOTSTRAP_BTC_TOTP_SECRET is provided',
      });
    }
  }

  const bootstrap: { username?: string; password?: string; totpSecret?: string } = hasUser && hasPass
    ? {
        username: btcUserRaw!.trim(),
        password: btcPassRaw!,
        ...(hasTotpSecret ? { totpSecret: btcTotpRaw!.trim() } : {}),
      }
    : (hasTotpSecret ? { totpSecret: btcTotpRaw!.trim() } : {});

  // Security config validation
  const modeRaw = env.OTT_DEPLOYMENT_MODE;
  let modeValid = false;
  if (modeRaw === undefined || modeRaw.trim() === '') {
    issues.push({
      variable: 'OTT_DEPLOYMENT_MODE',
      reason: 'missing required environment variable (must be dev, test, hosted, or production)',
    });
  } else if (!['dev', 'test', 'hosted', 'production'].includes(modeRaw.trim())) {
    issues.push({
      variable: 'OTT_DEPLOYMENT_MODE',
      reason: 'must be one of: dev, test, hosted, production',
    });
  } else {
    modeValid = true;
  }

  // Pre-validate other security env vars to avoid leaking values in loadSecurityConfig errors
  if (env.OTT_ADMIN_TOTP_REQUIRED !== undefined && env.OTT_ADMIN_TOTP_REQUIRED.trim() !== '') {
    const val = env.OTT_ADMIN_TOTP_REQUIRED.trim();
    if (val !== 'true' && val !== 'false') {
      issues.push({ variable: 'OTT_ADMIN_TOTP_REQUIRED', reason: 'must be "true" or "false"' });
    }
  }

  if (env.OTT_ADMIN_ALLOWLIST !== undefined && env.OTT_ADMIN_ALLOWLIST.trim() !== '') {
    const entries = env.OTT_ADMIN_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean);
    for (const entry of entries) {
      try {
        parseCidr(entry);
      } catch {
        issues.push({ variable: 'OTT_ADMIN_ALLOWLIST', reason: 'contains invalid CIDR' });
        break;
      }
    }
  }

  if (env.OTT_TRUSTED_PROXIES !== undefined && env.OTT_TRUSTED_PROXIES.trim() !== '') {
    const trimmed = env.OTT_TRUSTED_PROXIES.trim();
    if (trimmed.toLowerCase() !== 'none') {
      const entries = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
      for (const entry of entries) {
        try {
          parseCidr(entry);
        } catch {
          issues.push({ variable: 'OTT_TRUSTED_PROXIES', reason: 'contains invalid CIDR' });
          break;
        }
      }
    }
  }

  if (env.OTT_TOTP_ENCRYPTION_KEY !== undefined && env.OTT_TOTP_ENCRYPTION_KEY.trim() !== '') {
    try {
      const buf = Buffer.from(env.OTT_TOTP_ENCRYPTION_KEY.trim(), 'base64');
      if (buf.length !== 32) {
        issues.push({ variable: 'OTT_TOTP_ENCRYPTION_KEY', reason: 'must be 32 bytes base64' });
      }
    } catch {
      issues.push({ variable: 'OTT_TOTP_ENCRYPTION_KEY', reason: 'must be valid base64' });
    }
  }

  if (env.OTT_WRITE_RATE_LIMIT_IP !== undefined && env.OTT_WRITE_RATE_LIMIT_IP.trim() !== '') {
    const num = Number(env.OTT_WRITE_RATE_LIMIT_IP.trim());
    if (!Number.isInteger(num) || num <= 0) {
      issues.push({ variable: 'OTT_WRITE_RATE_LIMIT_IP', reason: 'must be a positive integer' });
    }
  }

  if (env.OTT_WRITE_RATE_LIMIT_ACCOUNT !== undefined && env.OTT_WRITE_RATE_LIMIT_ACCOUNT.trim() !== '') {
    const num = Number(env.OTT_WRITE_RATE_LIMIT_ACCOUNT.trim());
    if (!Number.isInteger(num) || num <= 0) {
      issues.push({ variable: 'OTT_WRITE_RATE_LIMIT_ACCOUNT', reason: 'must be a positive integer' });
    }
  }

  let security: SecurityConfig | undefined;
  if (modeValid) {
    try {
      security = loadSecurityConfig(env);

      // Mode-specific startup guards
      if (security.mode === 'hosted' || security.mode === 'production') {
        if (!security.totpRequired) {
          issues.push({
            variable: 'OTT_ADMIN_TOTP_REQUIRED',
            reason: 'must be true in hosted/production mode',
          });
        }
        if (security.adminAllowlist.length === 0) {
          issues.push({
            variable: 'OTT_ADMIN_ALLOWLIST',
            reason: 'must not be empty in hosted/production mode',
          });
        }
        if (security.trustedProxiesConfigured === false) {
          issues.push({
            variable: 'OTT_TRUSTED_PROXIES',
            reason: 'must be configured or set to literal "none" in hosted/production mode',
          });
        } else if (security.trustedProxies.some((p) => isAmbiguousCidr(p))) {
          issues.push({
            variable: 'OTT_TRUSTED_PROXIES',
            reason: 'cannot contain ambiguous CIDR (0.0.0.0/0 or ::/0) in hosted/production mode',
          });
        }
        if (security.totpEncryptionKey === null || security.totpEncryptionKey.length !== 32) {
          issues.push({
            variable: 'OTT_TOTP_ENCRYPTION_KEY',
            reason: 'must be configured as 32 bytes base64 in hosted/production mode',
          });
        }
      } else {
        // dev or test
        if (security.totpRequired && (security.totpEncryptionKey === null || security.totpEncryptionKey.length !== 32)) {
          issues.push({
            variable: 'OTT_TOTP_ENCRYPTION_KEY',
            reason: 'required whenever TOTP is enabled',
          });
        }
      }
    } catch {
      // Any parsing error was already caught by pre-validation
    }
  }

  // OTT_SECURE_COOKIES (default: true for hosted/production, false for dev/test)
  let secureCookies = modeValid && (modeRaw?.trim() === 'hosted' || modeRaw?.trim() === 'production');
  if (env.OTT_SECURE_COOKIES !== undefined && env.OTT_SECURE_COOKIES.trim() !== '') {
    const trimmed = env.OTT_SECURE_COOKIES.trim();
    if (trimmed === 'true') {
      secureCookies = true;
    } else if (trimmed === 'false') {
      secureCookies = false;
    } else {
      issues.push({ variable: 'OTT_SECURE_COOKIES', reason: 'must be "true" or "false"' });
    }
  }

  if (issues.length > 0 || security === undefined) {
    throw new RuntimeConfigError(issues);
  }

  return {
    databaseUrl,
    redisUrl,
    s3: {
      endpoint: s3Endpoint,
      region: s3Region,
      bucket: s3Bucket!,
      accessKeyId: s3AccessKeyId!,
      secretAccessKey: s3SecretAccessKey!,
    },
    host,
    port,
    queueName,
    runMigrations,
    shutdownTimeoutMs,
    security,
    secureCookies,
    bootstrap,
  };
}
