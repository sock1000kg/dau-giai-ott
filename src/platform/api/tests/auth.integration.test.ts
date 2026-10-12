import { randomUUID } from 'node:crypto';

import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bootstrapBtcAdmin,
  createAuthApp,
  createDatabase,
  createPasswordHasher,
  requireAuthenticated,
  requireTeamAccess,
  runMigrations,
  type Database,
} from '../src/index.ts';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const integration = databaseUrl === undefined || redisUrl === undefined ? describe.skip : describe;

const passwordHasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });
const alphaPassword = 'alpha-password';

function cookieHeader(value: string | string[] | undefined): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (cookie === undefined) {
    throw new Error('Expected an auth session cookie');
  }
  return cookie.split(';', 1)[0]!;
}

integration('P2-T04 authentication and RBAC', () => {
  let database: Database;
  let redis: RedisClientType;
  let alphaTeamId: string;
  let betaTeamId: string;

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    redis = createClient({ url: redisUrl! });
    await redis.connect();
    await database.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(database);
  });

  beforeEach(async () => {
    await redis.flushDb();
    await database.query('TRUNCATE audit_events, sessions, accounts, teams RESTART IDENTITY CASCADE');

    alphaTeamId = randomUUID();
    betaTeamId = randomUUID();
    const alphaAccountId = randomUUID();
    await database.query('INSERT INTO teams (id, name) VALUES ($1, $2), ($3, $4)', [alphaTeamId, 'Alpha', betaTeamId, 'Beta']);
    await database.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4)",
      [alphaAccountId, 'alpha', await passwordHasher.hash(alphaPassword), alphaTeamId],
    );
  });

  afterAll(async () => {
    await redis.quit();
    await database.close();
  });

  async function appWithProtectedTeamRoute() {
    const app = createAuthApp({
      database,
      redis,
      passwordHasher,
      secureCookies: false,
      rateLimit: { maxFailures: 2, windowSeconds: 60 },
    });
    app.get<{ Params: { teamId: string } }>('/private/teams/:teamId', async (request) => {
      requireTeamAccess(requireAuthenticated(request.principal), request.params.teamId);
      return { data: { teamId: request.params.teamId } };
    });
    await app.ready();
    return app;
  }

  it('returns the same generic failure for unknown username and wrong password', async () => {
    const app = await appWithProtectedTeamRoute();
    try {
      const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'missing', password: 'wrong' } });
      const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alpha', password: 'wrong' } });

      expect(unknown.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(unknown.json()).toEqual(wrong.json());
      expect(unknown.json()).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } });
    } finally {
      await app.close();
    }
  });

  it('uses an opaque HttpOnly session and enforces team ownership server-side', async () => {
    const app = await appWithProtectedTeamRoute();
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alpha', password: alphaPassword } });
      const cookie = cookieHeader(login.headers['set-cookie']);

      expect(login.statusCode).toBe(200);
      expect(login.headers['set-cookie']).toContain('HttpOnly');
      expect(login.headers['set-cookie']).toContain('SameSite=Lax');
      expect(login.headers['set-cookie']).not.toContain(alphaTeamId);

      const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toEqual({ data: { role: 'TEAM_ACCOUNT', teamId: alphaTeamId } });

      await expect(app.inject({ method: 'GET', url: `/private/teams/${alphaTeamId}`, headers: { cookie } })).resolves.toMatchObject({ statusCode: 200 });
      const crossTeam = await app.inject({ method: 'GET', url: `/private/teams/${betaTeamId}`, headers: { cookie } });
      expect(crossTeam.statusCode).toBe(403);
      expect(crossTeam.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'You are not allowed to access this resource' } });

      const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } });
      expect(logout.statusCode).toBe(204);
      const revoked = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
      expect(revoked.statusCode).toBe(401);
      expect(revoked.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } });
      const audit = await database.query<{ readonly action: string; readonly reason: string | null }>('SELECT action, reason FROM audit_events ORDER BY action');
      expect(audit.rows).toEqual([{ action: 'AUTH_LOGIN', reason: null }, { action: 'AUTH_LOGOUT', reason: null }]);
    } finally {
      await app.close();
    }
  });

  it('bootstraps one BTC account from local environment values without persisting the plaintext password', async () => {
    const result = await bootstrapBtcAdmin({
      database,
      passwordHasher,
      environment: { OTT_BOOTSTRAP_BTC_USERNAME: 'btc', OTT_BOOTSTRAP_BTC_PASSWORD: 'local-only-password' },
    });
    if (result === null) {
      throw new Error('Expected BTC bootstrap credentials to be configured');
    }
    const persisted = await database.query<{ readonly username: string; readonly password_hash: string; readonly role: string; readonly team_id: string | null }>(
      'SELECT username, password_hash, role, team_id FROM accounts WHERE id = $1',
      [result.accountId],
    );

    expect(result.created).toBe(true);
    expect(persisted.rows).toEqual([{ username: 'btc', password_hash: expect.stringMatching(/^\$argon2id\$/), role: 'BTC_ADMIN', team_id: null }]);
    await expect(passwordHasher.verify(persisted.rows[0]!.password_hash, 'local-only-password')).resolves.toBe(true);
    await expect(bootstrapBtcAdmin({
      database,
      passwordHasher,
      environment: { OTT_BOOTSTRAP_BTC_USERNAME: 'btc', OTT_BOOTSTRAP_BTC_PASSWORD: 'different-password' },
    })).resolves.toEqual({ accountId: result.accountId, created: false });
  });

  it('has no self-register or self-reset API and rate limits failed login attempts', async () => {
    const app = await appWithProtectedTeamRoute();
    try {
      await expect(app.inject({ method: 'POST', url: '/api/v1/auth/register' })).resolves.toMatchObject({ statusCode: 404 });
      await expect(app.inject({ method: 'POST', url: '/api/v1/auth/reset-password' })).resolves.toMatchObject({ statusCode: 404 });

      await expect(app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'missing', password: 'wrong' } })).resolves.toMatchObject({ statusCode: 401 });
      await expect(app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'missing', password: 'wrong' } })).resolves.toMatchObject({ statusCode: 401 });
      const limited = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'missing', password: 'wrong' } });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toEqual({ error: { code: 'LOGIN_RATE_LIMITED', message: 'Too many login attempts. Try again later.' } });
    } finally {
      await app.close();
    }
  });

  it('sets Secure for the production-default HTTPS cookie policy', async () => {
    const app = createAuthApp({ database, redis, passwordHasher });
    await app.ready();
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'alpha', password: alphaPassword } });
      expect(login.headers['set-cookie']).toContain('Secure');
    } finally {
      await app.close();
    }
  });
});
