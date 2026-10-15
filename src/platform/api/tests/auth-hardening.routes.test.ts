import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthApp,
  createPasswordHasher,
  parseCidr,
  type Database,
  type SecurityConfig,
} from '../src/index.ts';
import {
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
} from '../src/modules/auth/totp.ts';

const passwordHasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });
const testKey = Buffer.alloc(32, 42);

function parseCookie(setCookieHeaders: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders ?? ''];
  for (const header of headers) {
    if (header.startsWith(`${name}=`)) {
      return header.split(';', 1)[0]!;
    }
  }
  throw new Error(`Expected cookie '${name}' not found`);
}

describe('auth-hardening routes unit tests (mocked DB and Redis)', () => {
  function createMockEnvironment() {
    const redisStore = new Map<string, string>();
    const redisSets = new Map<string, Set<string>>();

    const redis = {
      get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        const deleted = redisStore.delete(key);
        return deleted ? 1 : 0;
      }),
      incr: vi.fn(async (key: string) => {
        const current = parseInt(redisStore.get(key) ?? '0', 10);
        const next = current + 1;
        redisStore.set(key, next.toString());
        return next;
      }),
      expire: vi.fn(async () => 'OK'),
      sAdd: vi.fn(async (key: string, member: string) => {
        if (!redisSets.has(key)) redisSets.set(key, new Set());
        redisSets.get(key)!.add(member);
        return 1;
      }),
      sMembers: vi.fn(async (key: string) => Array.from(redisSets.get(key) ?? [])),
    };

    return { redis, redisStore };
  }

  it('runs two-step login flow: login -> challenge -> login/mfa -> session', async () => {
    const { redis } = createMockEnvironment();
    const accountId = randomUUID();
    const btcSecret = generateTotpSecret();
    const passwordHash = await passwordHasher.hash('valid-password');
    const encrypted = encryptTotpSecret(btcSecret, testKey);

    let lastUsedStep: bigint | null = null;

    const dbQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT id, username, password_hash, role, team_id FROM accounts')) {
        return {
          rows: [
            { id: accountId, username: 'btc-admin', password_hash: passwordHash, role: 'BTC_ADMIN', team_id: null },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT account_id, secret_ciphertext, secret_iv, secret_tag')) {
        return {
          rows: [
            {
              account_id: accountId,
              secret_ciphertext: encrypted.ciphertext,
              secret_iv: encrypted.iv,
              secret_tag: encrypted.tag,
              key_version: 1,
              enrolled_at: new Date(),
              last_used_step: lastUsedStep ? lastUsedStep.toString() : null,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE admin_mfa')) {
        const step = BigInt(params![1] as string);
        if (lastUsedStep === null || step > lastUsedStep) {
          lastUsedStep = step;
          return { rows: [{ account_id: accountId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO audit_events')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const database = {
      query: dbQuery,
      transaction: vi.fn(async (fn: any) => fn({ query: dbQuery })),
      close: vi.fn(),
    } as unknown as Database;

    const config: SecurityConfig = {
      mode: 'test',
      totpRequired: true,
      adminAllowlist: [],
      trustedProxies: [],
      totpEncryptionKey: testKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
      trustedProxiesConfigured: true,
    };

    const app = createAuthApp({
      database,
      redis,
      passwordHasher,
      security: config,
      secureCookies: false,
    });
    await app.ready();

    try {
      // Step 1: Login
      const step1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'btc-admin', password: 'valid-password' },
      });

      expect(step1.statusCode).toBe(200);
      expect(step1.json()).toEqual({ data: { mfaRequired: true } });
      const mfaCookie = parseCookie(step1.headers['set-cookie'], 'ott_mfa');

      // Step 2: Login with MFA TOTP code
      const currentSeconds = Math.floor(Date.now() / 1000);
      const code = generateTotpCode(btcSecret, currentSeconds);

      const step2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        headers: { cookie: mfaCookie },
        payload: { code },
      });

      expect(step2.statusCode).toBe(200);
      expect(step2.json()).toEqual({ data: { role: 'BTC_ADMIN' } });
      const sessionCookie = parseCookie(step2.headers['set-cookie'], 'ott_session');
      expect(sessionCookie).toBeTruthy();

      // Check session
      const sessionCheck = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/session',
        headers: { cookie: sessionCookie },
      });
      expect(sessionCheck.statusCode).toBe(200);
      expect(sessionCheck.json()).toEqual({ data: { role: 'BTC_ADMIN' } });
    } finally {
      await app.close();
    }
  });

  it('rejects login with recovery code when recovery code is already used', async () => {
    const { redis } = createMockEnvironment();
    const accountId = randomUUID();
    const passwordHash = await passwordHasher.hash('valid-password');
    const { formatted, hashes } = generateRecoveryCodes(1);
    const recoveryCode = formatted[0]!;
    let recoveryCodeUsed = false;

    const dbQuery = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, username, password_hash, role, team_id FROM accounts')) {
        return {
          rows: [
            { id: accountId, username: 'btc-admin', password_hash: passwordHash, role: 'BTC_ADMIN', team_id: null },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes('UPDATE admin_recovery_codes')) {
        if (!recoveryCodeUsed) {
          recoveryCodeUsed = true;
          return { rows: [{ id: randomUUID() }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes('INSERT INTO audit_events')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const database = {
      query: dbQuery,
      transaction: vi.fn(async (fn: any) => fn({ query: dbQuery })),
      close: vi.fn(),
    } as unknown as Database;

    const config: SecurityConfig = {
      mode: 'test',
      totpRequired: true,
      adminAllowlist: [],
      trustedProxies: [],
      totpEncryptionKey: testKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
      trustedProxiesConfigured: true,
    };

    const app = createAuthApp({
      database,
      redis,
      passwordHasher,
      security: config,
      secureCookies: false,
    });
    await app.ready();

    try {
      // Step 1
      const step1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'btc-admin', password: 'valid-password' },
      });
      const mfaCookie = parseCookie(step1.headers['set-cookie'], 'ott_mfa');

      // First use of recovery code
      const step2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        headers: { cookie: mfaCookie },
        payload: { recoveryCode },
      });
      expect(step2.statusCode).toBe(200);

      // Re-login step 1
      const step1B = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'btc-admin', password: 'valid-password' },
      });
      const mfaCookieB = parseCookie(step1B.headers['set-cookie'], 'ott_mfa');

      // Second use of same recovery code
      const step2B = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        headers: { cookie: mfaCookieB },
        payload: { recoveryCode },
      });
      expect(step2B.statusCode).toBe(401);
      expect(step2B.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });
    } finally {
      await app.close();
    }
  });

  it('blocks admin route from non-allowlisted IP with 403 ADMIN_NETWORK_FORBIDDEN', async () => {
    const { redis } = createMockEnvironment();
    const database = { query: vi.fn(), transaction: vi.fn(), close: vi.fn() } as unknown as Database;

    const config: SecurityConfig = {
      mode: 'test',
      totpRequired: false,
      adminAllowlist: [parseCidr('192.168.1.0/24')],
      trustedProxies: [parseCidr('10.0.0.1')],
      totpEncryptionKey: testKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
      trustedProxiesConfigured: true,
    };

    const app = createAuthApp({ database, redis, security: config });
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk',
        remoteAddress: '203.0.113.10',
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: { code: 'ADMIN_NETWORK_FORBIDDEN', message: 'Access denied from this network address' },
      });
    } finally {
      await app.close();
    }
  });

  it('rate limits write requests per IP and account with Retry-After header', async () => {
    const { redis } = createMockEnvironment();
    const database = {
      query: vi.fn(async () => ({ rows: [] })),
      close: vi.fn(),
    } as unknown as Database;

    const config: SecurityConfig = {
      mode: 'test',
      totpRequired: false,
      adminAllowlist: [],
      trustedProxies: [],
      totpEncryptionKey: testKey,
      writeRateLimit: { perIpPerMinute: 2, perAccountPerMinute: 2 },
      trustedProxiesConfigured: true,
    };

    const app = createAuthApp({ database, redis, security: config });
    await app.ready();

    try {
      // 1st and 2nd write requests pass rate limit check
      const res1 = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(res1.statusCode).toBe(204);
      const res2 = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(res2.statusCode).toBe(204);

      // 3rd write request gets 429
      const res3 = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(res3.statusCode).toBe(429);
      expect(res3.headers['retry-after']).toBe('60');
      expect(res3.json()).toEqual({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
      });
    } finally {
      await app.close();
    }
  });
});
