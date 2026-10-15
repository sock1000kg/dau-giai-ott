import { randomInt, randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bootstrapBtcAdmin,
  createAuthApp,
  createDatabase,
  createPasswordHasher,
  devSecurityConfig,
  parseCidr,
  runMigrations,
  type Database,
  type SecurityConfig,
} from '../src/index.ts';
import {
  decryptTotpSecret,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  hashRecoveryCode,
} from '../src/modules/auth/totp.ts';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const integration = databaseUrl === undefined || redisUrl === undefined ? describe.skip : describe;

const passwordHasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });
const testEncryptionKey = Buffer.alloc(32, 7);
const knownSecret = generateTotpSecret();
const btcPassword = 'SuperSecretBtcPassword123!';

function parseCookie(setCookieHeaders: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders ?? ''];
  for (const header of headers) {
    if (header.startsWith(`${name}=`)) {
      return header.split(';', 1)[0]!;
    }
  }
  throw new Error(`Expected cookie '${name}' not found in headers`);
}

describe('auth-hardening AC-23 startup guard', () => {
  const fakeDb = { query: async () => ({ rows: [] }), close: async () => {} } as unknown as Database;
  const fakeRedis = {
    get: async () => null,
    set: async () => {},
    del: async () => 0,
    incr: async () => 1,
    expire: async () => {},
    sAdd: async () => 1,
    sMembers: async () => [],
  };

  it('throws in hosted mode when TOTP is disabled', () => {
    const config: SecurityConfig = {
      mode: 'hosted',
      totpRequired: false,
      adminAllowlist: [parseCidr('10.0.0.0/8')],
      trustedProxies: [parseCidr('127.0.0.1')],
      totpEncryptionKey: testEncryptionKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
      trustedProxiesConfigured: true,
    };
    expect(() => createAuthApp({ database: fakeDb, redis: fakeRedis, security: config })).toThrow(/TOTP must be required/);
  });

  it('throws in hosted mode when allowlist is empty', () => {
    const config: SecurityConfig = {
      mode: 'hosted',
      totpRequired: true,
      adminAllowlist: [],
      trustedProxies: [parseCidr('127.0.0.1')],
      totpEncryptionKey: testEncryptionKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
      trustedProxiesConfigured: true,
    };
    expect(() => createAuthApp({ database: fakeDb, redis: fakeRedis, security: config })).toThrow(/Admin network allowlist must not be empty/);
  });

  it('throws in hosted mode when trusted proxies are unset', () => {
    const config: SecurityConfig = {
      mode: 'hosted',
      totpRequired: true,
      adminAllowlist: [parseCidr('10.0.0.0/8')],
      trustedProxies: [],
      trustedProxiesConfigured: false,
      totpEncryptionKey: testEncryptionKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
    };
    expect(() => createAuthApp({ database: fakeDb, redis: fakeRedis, security: config })).toThrow(/Trusted proxies configuration is unset/);
  });

  it('throws in hosted mode when trusted proxies are ambiguous', () => {
    const config: SecurityConfig = {
      mode: 'hosted',
      totpRequired: true,
      adminAllowlist: [parseCidr('10.0.0.0/8')],
      trustedProxies: [parseCidr('0.0.0.0/0')],
      trustedProxiesConfigured: true,
      totpEncryptionKey: testEncryptionKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
    };
    expect(() => createAuthApp({ database: fakeDb, redis: fakeRedis, security: config })).toThrow(/ambiguous/);
  });

  it('throws in hosted mode when encryption key is missing or invalid', () => {
    const config: SecurityConfig = {
      mode: 'hosted',
      totpRequired: true,
      adminAllowlist: [parseCidr('10.0.0.0/8')],
      trustedProxies: [parseCidr('10.0.0.1')],
      trustedProxiesConfigured: true,
      totpEncryptionKey: null,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
    };
    expect(() => createAuthApp({ database: fakeDb, redis: fakeRedis, security: config })).toThrow(/TOTP encryption key is missing or invalid/);
  });
});

integration('auth-hardening DB and Redis integration tests', () => {
  let database: Database;
  let redis: RedisClientType;
  let btcAccountId: string;
  let runId: string;
  let btcUsername: string;
  let testIp: string;

  const uniqueTestIp = (): string => `192.168.${randomInt(2, 255)}.${randomInt(1, 255)}`;

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    redis = createClient({ url: redisUrl! });
    await redis.connect();
    await runMigrations(database);
  });

  afterAll(async () => {
    await redis.quit();
    await database.close();
  });

  beforeEach(async () => {
    testIp = uniqueTestIp();
    runId = randomUUID().slice(0, 8);
    btcUsername = `btc-${runId}`;

    const result = await bootstrapBtcAdmin({
      database,
      passwordHasher,
      environment: {
        OTT_BOOTSTRAP_BTC_USERNAME: btcUsername,
        OTT_BOOTSTRAP_BTC_PASSWORD: btcPassword,
        OTT_BOOTSTRAP_BTC_TOTP_SECRET: knownSecret,
      },
      totpEncryptionKey: testEncryptionKey,
    });
    btcAccountId = result!.accountId;
  });

  async function leakCorpus(): Promise<string> {
    const rows = await database.query<{ readonly t: string }>(`
      SELECT row_to_json(a)::text AS t FROM audit_events a
      UNION ALL SELECT row_to_json(r)::text FROM admin_recovery_codes r
      UNION ALL SELECT row_to_json(m)::text FROM admin_mfa m`);
    return rows.rows.map(({ t }) => t).join('\n');
  }

  function captureOutput(): { readonly text: () => string; readonly restore: () => void } {
    const chunks: string[] = [];
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = methods.map((m) => console[m]);
    process.stdout.write = ((c: unknown, ...r: unknown[]) => { chunks.push(String(c)); return (out as (...a: unknown[]) => boolean)(c, ...r); }) as typeof process.stdout.write;
    process.stderr.write = ((c: unknown, ...r: unknown[]) => { chunks.push(String(c)); return (err as (...a: unknown[]) => boolean)(c, ...r); }) as typeof process.stderr.write;
    methods.forEach((m) => { console[m] = (...a: unknown[]) => { chunks.push(a.map(String).join(' ')); }; });
    return {
      text: () => chunks.join('\n'),
      restore: () => { process.stdout.write = out; process.stderr.write = err; methods.forEach((m, i) => { console[m] = originals[i]!; }); },
    };
  }

  function createTestApp(securityConfig?: SecurityConfig) {
    return createAuthApp({
      database,
      redis,
      passwordHasher,
      secureCookies: false,
      security: securityConfig ?? {
        mode: 'test',
        totpRequired: true,
        adminAllowlist: [parseCidr('127.0.0.1'), parseCidr('192.168.0.0/16')],
        trustedProxies: [parseCidr('10.0.0.0/8')],
        totpEncryptionKey: testEncryptionKey,
        writeRateLimit: { perIpPerMinute: 20, perAccountPerMinute: 10 },
        trustedProxiesConfigured: true,
      },
    });
  }

  it('succeeds on known-secret TOTP login and protects against step replay', async () => {
    const app = createTestApp();
    await app.ready();

    try {
      // Step 1: Login with password
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.json()).toEqual({ data: { mfaRequired: true } });

      const mfaCookie = parseCookie(loginRes.headers['set-cookie'], 'ott_mfa');
      expect(mfaCookie).toBeTruthy();

      // Step 2: Login with current TOTP code
      const currentStepSeconds = Math.floor(Date.now() / 1000);
      const code = generateTotpCode(knownSecret, currentStepSeconds);

      const mfaRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie },
        payload: { code },
      });
      expect(mfaRes.statusCode).toBe(200);
      expect(mfaRes.json()).toEqual({ data: { role: 'BTC_ADMIN' } });
      const sessionCookie = parseCookie(mfaRes.headers['set-cookie'], 'ott_session');
      expect(sessionCookie).toBeTruthy();

      // Replay same code: must be rejected with 401
      // Attempt login step 1 again
      const loginRes2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      const mfaCookie2 = parseCookie(loginRes2.headers['set-cookie'], 'ott_mfa');

      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie2 },
        payload: { code },
      });
      expect(replayRes.statusCode).toBe(401);
      expect(replayRes.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });

      // Older step code after a newer step must also fail
      const loginRes3 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      const mfaCookie3 = parseCookie(loginRes3.headers['set-cookie'], 'ott_mfa');
      const olderCode = generateTotpCode(knownSecret, currentStepSeconds - 30);

      const olderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie3 },
        payload: { code: olderCode },
      });
      expect(olderRes.statusCode).toBe(401);
      expect(olderRes.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });
    } finally {
      await app.close();
    }
  });

  it('allows single-use recovery code and prevents replay and concurrent reuse', async () => {
    // Generate recovery codes for btc admin
    const { formatted, hashes } = generateRecoveryCodes(1);
    const testCode = formatted[0]!;
    await database.query(
      'INSERT INTO admin_recovery_codes (id, account_id, code_sha256) VALUES ($1, $2, $3)',
      [randomUUID(), btcAccountId, hashes[0]!],
    );

    const app = createTestApp();
    await app.ready();

    try {
      // Step 1: Login
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      const mfaCookie = parseCookie(loginRes.headers['set-cookie'], 'ott_mfa');

      // Step 2: Login with recovery code
      const mfaRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie },
        payload: { recoveryCode: testCode },
      });
      expect(mfaRes.statusCode).toBe(200);
      expect(mfaRes.json()).toEqual({ data: { role: 'BTC_ADMIN' } });

      // Second use of the same recovery code -> 401
      const loginRes2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      const mfaCookie2 = parseCookie(loginRes2.headers['set-cookie'], 'ott_mfa');

      const replayRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie2 },
        payload: { recoveryCode: testCode },
      });
      expect(replayRes.statusCode).toBe(401);
      expect(replayRes.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });

      // Concurrent double use test with a new recovery code
      const { formatted: cFormatted, hashes: cHashes } = generateRecoveryCodes(1);
      const concurrentCode = cFormatted[0]!;
      await database.query(
        'INSERT INTO admin_recovery_codes (id, account_id, code_sha256) VALUES ($1, $2, $3)',
        [randomUUID(), btcAccountId, cHashes[0]!],
      );

      const loginA = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      const cookieA = parseCookie(loginA.headers['set-cookie'], 'ott_mfa');

      const loginB = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      const cookieB = parseCookie(loginB.headers['set-cookie'], 'ott_mfa');

      const [resA, resB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/login/mfa',
          remoteAddress: testIp,
          headers: { cookie: cookieA },
          payload: { recoveryCode: concurrentCode },
        }),
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/login/mfa',
          remoteAddress: testIp,
          headers: { cookie: cookieB },
          payload: { recoveryCode: concurrentCode },
        }),
      ]);

      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([200, 401]);
    } finally {
      await app.close();
    }
  });

  it('returns identical generic 401 for wrong code, missing challenge, or expired challenge', async () => {
    const app = createTestApp();
    await app.ready();

    try {
      // 1. Missing challenge cookie
      const noChallenge = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        payload: { code: '123456' },
      });

      // 2. Wrong code with valid challenge
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      const mfaCookie = parseCookie(loginRes.headers['set-cookie'], 'ott_mfa');

      const wrongCode = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie },
        payload: { code: '000000' },
      });

      // 3. Expired / fake challenge
      const expiredChallenge = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: 'ott_mfa=fake-or-expired-challenge-token' },
        payload: { code: '123456' },
      });

      expect(noChallenge.statusCode).toBe(401);
      expect(wrongCode.statusCode).toBe(401);
      expect(expiredChallenge.statusCode).toBe(401);

      expect(noChallenge.json()).toEqual(wrongCode.json());
      expect(noChallenge.json()).toEqual(expiredChallenge.json());
      expect(noChallenge.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });
    } finally {
      await app.close();
    }
  });

  it('rejects un-enrolled BTC account in required mode with generic 401', async () => {
    // Insert an un-enrolled BTC admin
    const unenrolledId = randomUUID();
    const unenrolledUsername = `unenrolled-btc-${runId}`;
    await database.query(
      "INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, $2, $3, 'BTC_ADMIN')",
      [unenrolledId, unenrolledUsername, await passwordHasher.hash('password')],
    );

    const app = createTestApp();
    await app.ready();

    try {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: unenrolledUsername, password: 'password' },
      });
      expect(loginRes.statusCode).toBe(200);
      const mfaCookie = parseCookie(loginRes.headers['set-cookie'], 'ott_mfa');

      const mfaRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie },
        payload: { code: '123456' },
      });
      expect(mfaRes.statusCode).toBe(401);
      expect(mfaRes.json()).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      });
    } finally {
      await app.close();
    }
  });

  it('scans DB: no secret or recovery code plaintext stored; ciphertext decrypts only with key', async () => {
    // Generate recovery codes for btc admin
    const { formatted, hashes } = generateRecoveryCodes(2);
    const codePlaintext1 = formatted[0]!;
    const codePlaintext2 = formatted[1]!;

    await database.query(
      'INSERT INTO admin_recovery_codes (id, account_id, code_sha256) VALUES ($1, $2, $3), ($4, $2, $5)',
      [randomUUID(), btcAccountId, hashes[0]!, randomUUID(), hashes[1]!],
    );

    const mfaRows = await database.query<{
      secret_ciphertext: Buffer;
      secret_iv: Buffer;
      secret_tag: Buffer;
    }>('SELECT secret_ciphertext, secret_iv, secret_tag FROM admin_mfa WHERE account_id = $1', [btcAccountId]);

    expect(mfaRows.rows.length).toBe(1);
    const row = mfaRows.rows[0]!;

    // Plaintext secret must not appear anywhere in DB representation
    expect(row.secret_ciphertext.toString('utf8')).not.toContain(knownSecret);
    expect(row.secret_ciphertext.toString('hex')).not.toContain(Buffer.from(knownSecret).toString('hex'));

    // Recovery codes must not be in plaintext
    const recoveryRows = await database.query<{ code_sha256: string }>(
      'SELECT code_sha256 FROM admin_recovery_codes WHERE account_id = $1',
      [btcAccountId],
    );
    for (const r of recoveryRows.rows) {
      expect(r.code_sha256).not.toBe(codePlaintext1);
      expect(r.code_sha256).not.toBe(codePlaintext2);
      expect(r.code_sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    // Ciphertext decrypts properly with the encryption key
    const decrypted = decryptTotpSecret(
      {
        ciphertext: row.secret_ciphertext,
        iv: row.secret_iv,
        tag: row.secret_tag,
      },
      testEncryptionKey,
    );
    expect(decrypted).toBe(knownSecret);

    // Fails with wrong key
    const wrongKey = Buffer.alloc(32, 99);
    expect(() =>
      decryptTotpSecret(
        {
          ciphertext: row.secret_ciphertext,
          iv: row.secret_iv,
          tag: row.secret_tag,
        },
        wrongKey,
      ),
    ).toThrow();
  });

  it('never leaks TOTP secret, codes or recovery codes to DB rows or logs', async () => {
    const { formatted, hashes } = generateRecoveryCodes(3);
    for (const hash of hashes) {
      await database.query(
        'INSERT INTO admin_recovery_codes (id, account_id, code_sha256) VALUES ($1, $2, $3)',
        [randomUUID(), btcAccountId, hash],
      );
    }

    const app = createTestApp();
    await app.ready();
    const capture = captureOutput();

    try {
      // 1. Password login -> /login/mfa with recoveryCode
      const loginRes1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      expect(loginRes1.statusCode).toBe(200);
      const mfaCookie1 = parseCookie(loginRes1.headers['set-cookie'], 'ott_mfa');

      const recoveryRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie1 },
        payload: { recoveryCode: formatted[0]! },
      });
      expect(recoveryRes.statusCode).toBe(200);

      // 2. Password login -> /login/mfa with current TOTP code
      const loginRes2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      expect(loginRes2.statusCode).toBe(200);
      const mfaCookie2 = parseCookie(loginRes2.headers['set-cookie'], 'ott_mfa');

      const currentStepSeconds = Math.floor(Date.now() / 1000);
      const totpCode = generateTotpCode(knownSecret, currentStepSeconds);

      const totpRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/mfa',
        remoteAddress: testIp,
        headers: { cookie: mfaCookie2 },
        payload: { code: totpCode },
      });
      expect(totpRes.statusCode).toBe(200);

      // 3. Scan corpus (DB rows + logs)
      const corpus = (await leakCorpus()) + '\n' + capture.text();

      expect(corpus).not.toContain(knownSecret);
      expect(corpus).not.toContain(totpCode);
      for (const code of formatted) {
        expect(corpus).not.toContain(code);
        const normalized = code.replaceAll('-', '');
        expect(corpus).not.toContain(normalized);
        expect(corpus).not.toContain(normalized.toLowerCase());
        expect(corpus).not.toContain(normalized.toUpperCase());
        expect(corpus).not.toContain(code.toLowerCase());
        expect(corpus).not.toContain(code.toUpperCase());
      }

      // 4. Assert audit_events has an AUTH_LOGIN_MFA row for this account
      const auditRows = await database.query<{ readonly action: string; readonly target_id: string }>(
        'SELECT action, target_id FROM audit_events WHERE target_id = $1 AND action = $2',
        [btcAccountId, 'AUTH_LOGIN_MFA'],
      );
      expect(auditRows.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      capture.restore();
      await app.close();
    }
  });

  it('enforces network allowlist on admin routes and validates proxy spoofing defense', async () => {
    const app = createTestApp({
      mode: 'test',
      totpRequired: false,
      adminAllowlist: [parseCidr('192.168.1.0/24')], // Only 192.168.1.0/24 allowed
      trustedProxies: [parseCidr('10.0.0.1')],      // Only 10.0.0.1 is trusted proxy
      totpEncryptionKey: testEncryptionKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
      trustedProxiesConfigured: true,
    });
    await app.ready();

    try {
      // 1. Direct connection from non-allowlisted IP -> 403
      const blocked = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/enroll',
        remoteAddress: '203.0.113.5',
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toEqual({
        error: { code: 'ADMIN_NETWORK_FORBIDDEN', message: 'Access denied from this network address' },
      });

      // 2. Allowlisted IP via trusted proxy XFF -> passes network check (fails on session 401 instead of 403)
      const allowedViaProxy = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/enroll',
        remoteAddress: '10.0.0.1', // Trusted proxy socket
        headers: { 'x-forwarded-for': '192.168.1.50' }, // Allowlisted client IP
      });
      expect(allowedViaProxy.statusCode).toBe(401); // Passed network check, reached auth check!

      // 3. Spoofed XFF from untrusted peer socket -> ignored, socket IP is used -> 403
      const spoofed = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/mfa/enroll',
        remoteAddress: '203.0.113.5', // Untrusted socket
        headers: { 'x-forwarded-for': '192.168.1.50' }, // Spoofed allowlisted IP
      });
      expect(spoofed.statusCode).toBe(403);
      expect(spoofed.json()).toEqual({
        error: { code: 'ADMIN_NETWORK_FORBIDDEN', message: 'Access denied from this network address' },
      });

      // 4. Empty allowlist (dev mode) -> allows access
      const devApp = createTestApp(devSecurityConfig());
      await devApp.ready();
      try {
        const devCheck = await devApp.inject({
          method: 'POST',
          url: '/api/v1/auth/mfa/enroll',
          remoteAddress: '203.0.113.5',
        });
        expect(devCheck.statusCode).toBe(401); // Not 403!
      } finally {
        await devApp.close();
      }
    } finally {
      await app.close();
    }
  });

  it('sets security headers on JSON and error responses, and HSTS only in hosted mode', async () => {
    // 1. Test config (HSTS absent)
    const testApp = createTestApp();
    await testApp.ready();
    try {
      const res = await testApp.inject({ method: 'GET', url: '/api/v1/auth/session', remoteAddress: testIp });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
      expect(res.headers['strict-transport-security']).toBeUndefined();
    } finally {
      await testApp.close();
    }

    // 2. Hosted config (HSTS present)
    const hostedApp = createTestApp({
      mode: 'hosted',
      totpRequired: true,
      adminAllowlist: [parseCidr('127.0.0.1'), parseCidr('192.168.0.0/16')],
      trustedProxies: [parseCidr('10.0.0.1')],
      totpEncryptionKey: testEncryptionKey,
      writeRateLimit: { perIpPerMinute: 600, perAccountPerMinute: 300 },
      trustedProxiesConfigured: true,
    });
    await hostedApp.ready();
    try {
      const res = await hostedApp.inject({ method: 'GET', url: '/api/v1/auth/session', remoteAddress: testIp });
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    } finally {
      await hostedApp.close();
    }
  });

  it('enforces write rate limits with Retry-After and does not double-limit login route', async () => {
    const rateIp = uniqueTestIp();
    const app = createTestApp({
      mode: 'test',
      totpRequired: false,
      adminAllowlist: [],
      trustedProxies: [],
      totpEncryptionKey: testEncryptionKey,
      writeRateLimit: { perIpPerMinute: 3, perAccountPerMinute: 3 },
      trustedProxiesConfigured: true,
    });
    await app.ready();

    try {
      // 3 write requests succeed
      for (let i = 0; i < 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          remoteAddress: rateIp,
        });
        expect(res.statusCode).toBe(204);
      }

      // 4th write request is rate limited
      const limited = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        remoteAddress: rateIp,
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers['retry-after']).toBe('60');
      expect(limited.json()).toEqual({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
      });

      // Login route is NOT blocked by write rate limit
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: rateIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      // Should succeed with 200 (in dev/test with totpRequired=false)
      expect(loginRes.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('runs password-only login for BTC admin in dev config exactly as before', async () => {
    const app = createTestApp(devSecurityConfig());
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        remoteAddress: testIp,
        payload: { username: btcUsername, password: btcPassword },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: { role: 'BTC_ADMIN', teamId: undefined } });
      const cookie = parseCookie(res.headers['set-cookie'], 'ott_session');
      expect(cookie).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});
