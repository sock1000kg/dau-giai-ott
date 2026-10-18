import { describe, expect, it } from 'vitest';
import { MATCH_QUEUE_NAME } from '@ott/job-contract';
import { loadRuntimeConfig, RuntimeConfigError } from '../src/runtime/config.ts';

function validDevEnv(): Record<string, string> {
  return {
    DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/ott_test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'test-access-key',
    S3_SECRET_ACCESS_KEY: 'test-secret-key',
    OTT_DEPLOYMENT_MODE: 'dev',
  };
}

describe('Runtime Config (P3-D30)', () => {
  it('loads valid configuration with defaults for dev mode', () => {
    const config = loadRuntimeConfig(validDevEnv());

    expect(config.databaseUrl).toBe('postgres://user:pass@127.0.0.1:5432/ott_test');
    expect(config.redisUrl).toBe('redis://127.0.0.1:6379');
    expect(config.s3).toEqual({
      endpoint: 'http://127.0.0.1:8333',
      region: 'us-east-1',
      bucket: 'test-bucket',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    });
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.queueName).toBe(MATCH_QUEUE_NAME);
    expect(config.runMigrations).toBe(false);
    expect(config.shutdownTimeoutMs).toBe(10000);
    expect(config.secureCookies).toBe(false);
    expect(config.security.mode).toBe('dev');
    expect(config.bootstrap).toEqual({});
  });

  it('loads valid configuration with defaults for hosted/production mode', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    const env = {
      ...validDevEnv(),
      OTT_DEPLOYMENT_MODE: 'hosted',
      OTT_ADMIN_TOTP_REQUIRED: 'true',
      OTT_ADMIN_ALLOWLIST: '10.0.0.0/8,192.168.1.0/24',
      OTT_TRUSTED_PROXIES: '10.0.0.1',
      OTT_TOTP_ENCRYPTION_KEY: key,
    };

    const config = loadRuntimeConfig(env);
    expect(config.security.mode).toBe('hosted');
    expect(config.secureCookies).toBe(true);
    expect(config.security.totpRequired).toBe(true);
    expect(config.security.adminAllowlist.length).toBe(2);
  });

  it('collects all missing required variables into a single RuntimeConfigError', () => {
    try {
      loadRuntimeConfig({});
      expect.fail('Expected RuntimeConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeConfigError);
      const configErr = err as RuntimeConfigError;
      const vars = configErr.issues.map((i) => i.variable);
      expect(vars).toContain('DATABASE_URL');
      expect(vars).toContain('REDIS_URL');
      expect(vars).toContain('S3_ENDPOINT');
      expect(vars).toContain('S3_BUCKET');
      expect(vars).toContain('S3_ACCESS_KEY_ID');
      expect(vars).toContain('S3_SECRET_ACCESS_KEY');
      expect(vars).toContain('OTT_DEPLOYMENT_MODE');
    }
  });

  it('validates URL schemes strictly', () => {
    const badSchemes = {
      ...validDevEnv(),
      DATABASE_URL: 'mysql://user:pass@localhost:3306/db',
      REDIS_URL: 'http://localhost:6379',
      S3_ENDPOINT: 'ftp://localhost:8333',
    };

    try {
      loadRuntimeConfig(badSchemes);
      expect.fail('Expected RuntimeConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeConfigError);
      const configErr = err as RuntimeConfigError;
      const issues = Object.fromEntries(configErr.issues.map((i) => [i.variable, i.reason]));
      expect(issues.DATABASE_URL).toContain('scheme postgres:// or postgresql://');
      expect(issues.REDIS_URL).toContain('scheme redis:// or rediss://');
      expect(issues.S3_ENDPOINT).toContain('scheme http:// or https://');
    }
  });

  it('accepts postgresql:// scheme for DATABASE_URL and rediss:// for REDIS_URL', () => {
    const env = {
      ...validDevEnv(),
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'rediss://localhost:6379',
      S3_ENDPOINT: 'https://s3.amazonaws.com',
    };
    const config = loadRuntimeConfig(env);
    expect(config.databaseUrl).toBe(env.DATABASE_URL);
    expect(config.redisUrl).toBe(env.REDIS_URL);
    expect(config.s3.endpoint).toBe(env.S3_ENDPOINT);
  });

  it('validates port bounds correctly', () => {
    // Port 0 is allowed for ephemeral tests
    const cfg0 = loadRuntimeConfig({ ...validDevEnv(), PORT: '0' });
    expect(cfg0.port).toBe(0);

    // Valid ports
    const cfg80 = loadRuntimeConfig({ ...validDevEnv(), PORT: '80' });
    expect(cfg80.port).toBe(80);

    const cfg65535 = loadRuntimeConfig({ ...validDevEnv(), PORT: '65535' });
    expect(cfg65535.port).toBe(65535);

    // Invalid ports
    for (const badPort of ['-1', '65536', 'not-a-number', '3000.5']) {
      expect(() => loadRuntimeConfig({ ...validDevEnv(), PORT: badPort })).toThrow(RuntimeConfigError);
    }
  });

  it('validates OTT_RUN_MIGRATIONS and OTT_SHUTDOWN_TIMEOUT_MS', () => {
    const valid = loadRuntimeConfig({
      ...validDevEnv(),
      OTT_RUN_MIGRATIONS: 'true',
      OTT_SHUTDOWN_TIMEOUT_MS: '5000',
    });
    expect(valid.runMigrations).toBe(true);
    expect(valid.shutdownTimeoutMs).toBe(5000);

    expect(() => loadRuntimeConfig({ ...validDevEnv(), OTT_RUN_MIGRATIONS: 'yes' })).toThrow(RuntimeConfigError);
    expect(() => loadRuntimeConfig({ ...validDevEnv(), OTT_SHUTDOWN_TIMEOUT_MS: '0' })).toThrow(RuntimeConfigError);
    expect(() => loadRuntimeConfig({ ...validDevEnv(), OTT_SHUTDOWN_TIMEOUT_MS: '-1' })).toThrow(RuntimeConfigError);
    expect(() => loadRuntimeConfig({ ...validDevEnv(), OTT_SHUTDOWN_TIMEOUT_MS: 'abc' })).toThrow(RuntimeConfigError);
  });

  it('validates explicit OTT_SECURE_COOKIES', () => {
    const trueConfig = loadRuntimeConfig({ ...validDevEnv(), OTT_SECURE_COOKIES: 'true' });
    expect(trueConfig.secureCookies).toBe(true);

    const falseConfig = loadRuntimeConfig({
      ...validDevEnv(),
      OTT_DEPLOYMENT_MODE: 'hosted',
      OTT_ADMIN_TOTP_REQUIRED: 'true',
      OTT_ADMIN_ALLOWLIST: '127.0.0.1/32',
      OTT_TRUSTED_PROXIES: 'none',
      OTT_TOTP_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      OTT_SECURE_COOKIES: 'false',
    });
    expect(falseConfig.secureCookies).toBe(false);

    expect(() => loadRuntimeConfig({ ...validDevEnv(), OTT_SECURE_COOKIES: 'maybe' })).toThrow(RuntimeConfigError);
  });

  it('validates bootstrap BTC account pairs', () => {
    // Both set -> succeeds
    const withBootstrap = loadRuntimeConfig({
      ...validDevEnv(),
      OTT_BOOTSTRAP_BTC_USERNAME: 'admin',
      OTT_BOOTSTRAP_BTC_PASSWORD: 'secure_password_123',
    });
    expect(withBootstrap.bootstrap).toEqual({
      username: 'admin',
      password: 'secure_password_123',
    });

    // Only username set -> throws
    expect(() => loadRuntimeConfig({
      ...validDevEnv(),
      OTT_BOOTSTRAP_BTC_USERNAME: 'admin',
    })).toThrow(RuntimeConfigError);

    // Only password set -> throws
    expect(() => loadRuntimeConfig({
      ...validDevEnv(),
      OTT_BOOTSTRAP_BTC_PASSWORD: 'secure_password_123',
    })).toThrow(RuntimeConfigError);

    // TOTP secret without encryption key -> throws
    expect(() => loadRuntimeConfig({
      ...validDevEnv(),
      OTT_BOOTSTRAP_BTC_USERNAME: 'admin',
      OTT_BOOTSTRAP_BTC_PASSWORD: 'secure_password_123',
      OTT_BOOTSTRAP_BTC_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    })).toThrow(RuntimeConfigError);

    // TOTP secret with encryption key -> succeeds
    const key = Buffer.alloc(32, 2).toString('base64');
    const withTotp = loadRuntimeConfig({
      ...validDevEnv(),
      OTT_BOOTSTRAP_BTC_USERNAME: 'admin',
      OTT_BOOTSTRAP_BTC_PASSWORD: 'secure_password_123',
      OTT_BOOTSTRAP_BTC_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
      OTT_TOTP_ENCRYPTION_KEY: key,
    });
    expect(withTotp.bootstrap).toEqual({
      username: 'admin',
      password: 'secure_password_123',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });
  });

  it('surfaces hosted/production security startup guards as RuntimeConfigError', () => {
    const missingHostedGuards = {
      ...validDevEnv(),
      OTT_DEPLOYMENT_MODE: 'hosted',
      // Missing TOTP, allowlist, proxies, key
    };

    try {
      loadRuntimeConfig(missingHostedGuards);
      expect.fail('Expected RuntimeConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeConfigError);
      const configErr = err as RuntimeConfigError;
      const vars = configErr.issues.map((i) => i.variable);
      expect(vars).toContain('OTT_ADMIN_TOTP_REQUIRED');
      expect(vars).toContain('OTT_ADMIN_ALLOWLIST');
      expect(vars).toContain('OTT_TRUSTED_PROXIES');
      expect(vars).toContain('OTT_TOTP_ENCRYPTION_KEY');
    }
  });

  it('rejects ambiguous trusted proxies in hosted mode', () => {
    const key = Buffer.alloc(32).toString('base64');
    const env = {
      ...validDevEnv(),
      OTT_DEPLOYMENT_MODE: 'hosted',
      OTT_ADMIN_TOTP_REQUIRED: 'true',
      OTT_ADMIN_ALLOWLIST: '127.0.0.1/32',
      OTT_TRUSTED_PROXIES: '0.0.0.0/0',
      OTT_TOTP_ENCRYPTION_KEY: key,
    };

    try {
      loadRuntimeConfig(env);
      expect.fail('Expected RuntimeConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeConfigError);
      const configErr = err as RuntimeConfigError;
      const proxyIssue = configErr.issues.find((i) => i.variable === 'OTT_TRUSTED_PROXIES');
      expect(proxyIssue?.reason).toContain('ambiguous');
    }
  });

  it('NEVER leaks secret values, passwords, or URLs with credentials in error messages or issues', () => {
    const secretPassword = 'SUPER_SECRET_DB_PASSWORD_12345';
    const secretRedisKey = 'SUPER_SECRET_REDIS_KEY_67890';
    const secretS3Key = 'SUPER_SECRET_S3_KEY_ABCDE';
    const secretBtcPass = 'SUPER_SECRET_BTC_PASSWORD_XYZ';

    const envWithSecrets = {
      DATABASE_URL: `mysql://admin:${secretPassword}@database.host:3306/dbname`,
      REDIS_URL: `invalid://:${secretRedisKey}@redis.host:6379`,
      S3_ENDPOINT: 'ftp://s3.host:8333',
      S3_BUCKET: 'bucket',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: secretS3Key,
      OTT_BOOTSTRAP_BTC_PASSWORD: secretBtcPass, // missing username -> will trigger error
      PORT: 'invalid_port',
      OTT_DEPLOYMENT_MODE: 'unknown_mode',
    };

    try {
      loadRuntimeConfig(envWithSecrets);
      expect.fail('Expected RuntimeConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeConfigError);
      const configErr = err as RuntimeConfigError;

      const fullMessage = configErr.message;
      const serializedIssues = JSON.stringify(configErr.issues);

      expect(fullMessage).not.toContain(secretPassword);
      expect(fullMessage).not.toContain(secretRedisKey);
      expect(fullMessage).not.toContain(secretS3Key);
      expect(fullMessage).not.toContain(secretBtcPass);

      expect(serializedIssues).not.toContain(secretPassword);
      expect(serializedIssues).not.toContain(secretRedisKey);
      expect(serializedIssues).not.toContain(secretS3Key);
      expect(serializedIssues).not.toContain(secretBtcPass);
    }
  });
});
