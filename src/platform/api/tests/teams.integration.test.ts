import { randomUUID } from 'node:crypto';

import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthApp, createDatabase, createPasswordHasher, runMigrations, type Database } from '../src/index.ts';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const integration = databaseUrl === undefined || redisUrl === undefined ? describe.skip : describe;
const hasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });

function cookie(response: { readonly headers: Record<string, unknown> }): string {
  const value = response.headers['set-cookie'];
  const header = Array.isArray(value) ? value[0] : value;
  if (header === undefined) throw new Error('session cookie missing');
  return header.split(';', 1)[0]!;
}

integration('P2-T06 team management', () => {
  let database: Database;
  let redis: RedisClientType;
  let app: ReturnType<typeof createAuthApp>;
  let adminCookie: string;
  let teamCookie: string;

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
    const adminId = randomUUID();
    const teamId = randomUUID();
    await database.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [teamId, 'Existing']);
    await database.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'BTC_ADMIN', NULL), ($4, $5, $6, 'TEAM_ACCOUNT', $7)",
      [adminId, 'admin', await hasher.hash('admin-password'), randomUUID(), 'existing', await hasher.hash('team-password'), teamId],
    );
    app = createAuthApp({ database, redis, passwordHasher: hasher, secureCookies: false });
    await app.ready();
    adminCookie = cookie(await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'admin-password' } }));
    teamCookie = cookie(await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'existing', password: 'team-password' } }));
  });
  afterAll(async () => { await redis.quit(); await database.close(); });

  it('lets BTC create, list, update and reset a team account exactly once', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/admin/teams', headers: { cookie: adminCookie }, payload: { name: 'Alpha Team' } });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ data: { id: string; name: string; credential: { username: string; password: string } } }>();
    expect(body.data.name).toBe('Alpha Team');
    expect(body.data.credential.password).toHaveLength(32);
    const listed = await app.inject({ method: 'GET', url: '/api/v1/admin/teams', headers: { cookie: adminCookie } });
    expect(listed.json<{ data: readonly { id: string }[] }>().data).toContainEqual(expect.objectContaining({ id: body.data.id }));
    await expect(app.inject({ method: 'PATCH', url: `/api/v1/admin/teams/${body.data.id}`, headers: { cookie: adminCookie }, payload: { name: 'Alpha Renamed' } })).resolves.toMatchObject({ statusCode: 200 });
    const reset = await app.inject({ method: 'POST', url: `/api/v1/admin/teams/${body.data.id}/reset-credential`, headers: { cookie: adminCookie } });
    expect(reset.statusCode).toBe(200);
    expect(reset.json<{ data: { credential: { password: string } } }>().data.credential.password).toHaveLength(32);
  });

  it('rejects duplicates, invalid input and team-account administration', async () => {
    await expect(app.inject({ method: 'POST', url: '/api/v1/admin/teams', headers: { cookie: adminCookie }, payload: { name: 'Existing' } })).resolves.toMatchObject({ statusCode: 409 });
    await expect(app.inject({ method: 'POST', url: '/api/v1/admin/teams', headers: { cookie: adminCookie }, payload: { name: '  ' } })).resolves.toMatchObject({ statusCode: 400 });
    const denied = await app.inject({ method: 'GET', url: '/api/v1/admin/teams', headers: { cookie: teamCookie } });
    expect(denied.statusCode).toBe(403);
  });

  it('revokes every existing team session when BTC resets credentials', async () => {
    const team = await database.query<{ readonly id: string }>("SELECT id FROM teams WHERE name = 'Existing'");
    const reset = await app.inject({ method: 'POST', url: `/api/v1/admin/teams/${team.rows[0]!.id}/reset-credential`, headers: { cookie: adminCookie } });
    expect(reset.statusCode).toBe(200);
    await expect(app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: teamCookie } })).resolves.toMatchObject({ statusCode: 401 });
  });
});
