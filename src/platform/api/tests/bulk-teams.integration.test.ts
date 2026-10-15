import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAuthApp,
  createDatabase,
  createPasswordHasher,
  runMigrations,
  type Database,
} from '../src/index.ts';
import { parseCsvRows } from '../src/modules/teams/bulk.ts';

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

integration('P3-D04 bulk team provisioning integration', () => {
  let database: Database;
  let redis: RedisClientType;
  let app: ReturnType<typeof createAuthApp>;
  let adminCookie: string;
  let adminAccountId: string;

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
    adminAccountId = randomUUID();
    await database.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'BTC_ADMIN', NULL)",
      [adminAccountId, 'admin', await hasher.hash('admin-password')],
    );
    app = createAuthApp({ database, redis, passwordHasher: hasher, secureCookies: false });
    await app.ready();
    adminCookie = cookie(
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'admin-password' },
      }),
    );
  });

  afterAll(async () => {
    if (redis) await redis.quit();
    if (database) await database.close();
  });

  it('imports 3 teams: returns credentials file, credentials log in, password hash is argon2 and not plaintext', async () => {
    const csv = [
      'team_name,representative_email',
      'Team One,team1@example.com',
      'Team Two,team2@example.com',
      'Team Three,team3@example.com',
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-batch-id']).toBeDefined();

    const parsed = parseCsvRows(res.body);
    expect(parsed).toHaveLength(4); // header + 3 rows
    expect(parsed[0]).toEqual(['team_name', 'representative_email', 'username', 'password']);

    for (let i = 1; i <= 3; i += 1) {
      const [teamName, email, username, password] = parsed[i]!;
      expect(teamName).toBe(`Team ${i === 1 ? 'One' : i === 2 ? 'Two' : 'Three'}`);
      expect(email).toBe(`team${i}@example.com`);
      expect(username).toBeDefined();
      expect(password).toBeDefined();

      // Login test
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username, password },
      });
      expect(loginRes.statusCode).toBe(200);

      // Check DB password_hash
      const accRes = await database.query<{ password_hash: string }>(
        'SELECT password_hash FROM accounts WHERE username = $1',
        [username],
      );
      const hash = accRes.rows[0]!.password_hash;
      expect(hash).not.toBe(password);
      expect(hash).toMatch(/^\$argon2id\$/);
    }
  });

  it('passes secret scan: no plaintext password in DB, audit, or stdout; audit count matches', async () => {
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: unknown, ...args: unknown[]) => {
      stdoutChunks.push(String(chunk));
      return (origWrite as Function).apply(process.stdout, [chunk, ...args]);
    };

    let importRes;
    try {
      const csv = [
        'team_name,representative_email',
        'Secret Team A,sec_a@example.com',
        'Secret Team B,sec_b@example.com',
      ].join('\n');

      importRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        headers: { cookie: adminCookie },
        payload: { csv },
      });
    } finally {
      process.stdout.write = origWrite;
    }

    expect(importRes.statusCode).toBe(200);
    const parsed = parseCsvRows(importRes.body);
    const passwords = [parsed[1]![3]!, parsed[2]![3]!];

    // Secret scan in stdout
    const capturedStdout = stdoutChunks.join('');
    for (const pw of passwords) {
      expect(capturedStdout).not.toContain(pw);
    }

    // Secret scan in DB: audit_events
    const auditRes = await database.query<{ row_text: string }>(
      'SELECT row_to_json(audit_events)::text AS row_text FROM audit_events',
    );
    for (const row of auditRes.rows) {
      for (const pw of passwords) {
        expect(row.row_text).not.toContain(pw);
      }
    }

    // Check specific audit events
    const audits = await database.query<{ action: string; target_type: string; reason: string | null }>(
      'SELECT action, target_type, reason FROM audit_events ORDER BY created_at ASC',
    );
    const teamCreatedAudits = audits.rows.filter((r) => r.action === 'TEAM_CREATED');
    const bulkImportAudits = audits.rows.filter((r) => r.action === 'TEAM_BULK_IMPORTED');

    expect(teamCreatedAudits).toHaveLength(2);
    expect(bulkImportAudits).toHaveLength(1);
    expect(bulkImportAudits[0]!.target_type).toBe('TEAM_BATCH');
    expect(bulkImportAudits[0]!.reason).toBe('count=2');

    // Secret scan in accounts table (whole row text)
    const accountsRes = await database.query<{ row_text: string }>(
      'SELECT row_to_json(accounts)::text AS row_text FROM accounts',
    );
    for (const row of accountsRes.rows) {
      for (const pw of passwords) {
        expect(row.row_text).not.toContain(pw);
      }
    }

    // Secret scan in teams table
    const teamsRes = await database.query<{ row_text: string }>(
      'SELECT row_to_json(teams)::text AS row_text FROM teams',
    );
    for (const row of teamsRes.rows) {
      for (const pw of passwords) {
        expect(row.row_text).not.toContain(pw);
      }
    }
  });

  it('is atomic: 1 invalid row rolls back all; existing name collision rolls back all', async () => {
    // 1 bad email among valid rows
    const badCsv = [
      'team_name,representative_email',
      'Atomic Team 1,at1@example.com',
      'Atomic Team 2,invalid-email',
      'Atomic Team 3,at3@example.com',
    ].join('\n');

    const badRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv: badCsv },
    });

    expect(badRes.statusCode).toBe(400);
    expect(badRes.json().error.code).toBe('CSV_INVALID');

    const countRes1 = await database.query<{ count: string }>('SELECT count(*) AS count FROM teams');
    expect(Number(countRes1.rows[0]!.count)).toBe(0);

    // Now insert one team in advance
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams',
      headers: { cookie: adminCookie },
      payload: { name: 'Preexisting Team' },
    });

    // CSV with one duplicate team name
    const conflictCsv = [
      'team_name,representative_email',
      'Fresh Team 1,fresh1@example.com',
      'PREEXISTING TEAM,dup@example.com', // collision
      'Fresh Team 2,fresh2@example.com',
    ].join('\n');

    const conflictRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv: conflictCsv },
    });

    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().error.code).toBe('CSV_CONFLICT');
    expect(conflictRes.json().error.errors).toEqual([
      { row: 2, column: 'team_name', code: 'TEAM_NAME_TAKEN' },
    ]);

    // Zero new teams created
    const countRes2 = await database.query<{ count: string }>('SELECT count(*) AS count FROM teams');
    expect(Number(countRes2.rows[0]!.count)).toBe(1); // only Preexisting Team
  });

  it('rejects retrying the same CSV with 409 and emits no new credentials or audits', async () => {
    const csv = [
      'team_name,representative_email',
      'Retry Team Alpha,retry_a@example.com',
      'Retry Team Beta,retry_b@example.com',
    ].join('\n');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv },
    });
    expect(first.statusCode).toBe(200);

    const auditCountBefore = await database.query<{ count: string }>('SELECT count(*) AS count FROM audit_events');

    // Retry same CSV
    const retry = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv },
    });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().error.code).toBe('CSV_CONFLICT');
    expect(retry.headers['content-type']).toContain('application/json');

    const auditCountAfter = await database.query<{ count: string }>('SELECT count(*) AS count FROM audit_events');
    expect(auditCountAfter.rows[0]!.count).toBe(auditCountBefore.rows[0]!.count);
  });

  it('download-once concurrency: exactly one request succeeds and the other gets 409', async () => {
    const csv = [
      'team_name,representative_email',
      'Conc Team 1,c1@example.com',
      'Conc Team 2,c2@example.com',
      'Conc Team 3,c3@example.com',
    ].join('\n');

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        headers: { cookie: adminCookie },
        payload: { csv },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        headers: { cookie: adminCookie },
        payload: { csv },
      }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const countRes = await database.query<{ count: string }>('SELECT count(*) AS count FROM teams');
    expect(Number(countRes.rows[0]!.count)).toBe(3);
  });

  it('persists lowercased email, enforces uniqueness and DB constraint, catches duplicates across imports', async () => {
    const csv1 = [
      'team_name,representative_email',
      'Email Team A,MIXED.Case@Domain.COM',
    ].join('\n');

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv: csv1 },
    });
    expect(res1.statusCode).toBe(200);

    const teamDb = await database.query<{ representative_email: string }>(
      "SELECT representative_email FROM teams WHERE name = 'Email Team A'",
    );
    expect(teamDb.rows[0]!.representative_email).toBe('mixed.case@domain.com');

    // Second import reusing email with different team name
    const csv2 = [
      'team_name,representative_email',
      'Email Team B,mixed.case@domain.com',
    ].join('\n');

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv: csv2 },
    });
    expect(res2.statusCode).toBe(409);
    expect(res2.json().error.errors).toEqual([
      { row: 1, column: 'representative_email', code: 'EMAIL_TAKEN' },
    ]);

    // Direct DB insert with uppercase email should violate CHECK constraint
    await expect(
      database.query("INSERT INTO teams (id, name, representative_email) VALUES ($1, $2, 'UPPER@DOMAIN.COM')", [
        randomUUID(),
        'Direct Insert Fail',
      ]),
    ).rejects.toThrow();

    // Direct DB insert with duplicate email should violate UNIQUE index
    await expect(
      database.query("INSERT INTO teams (id, name, representative_email) VALUES ($1, $2, 'mixed.case@domain.com')", [
        randomUUID(),
        'Direct Duplicate Fail',
      ]),
    ).rejects.toThrow();
  });

  it('protects email privacy: never in audit, team session, or public leaderboard; present in admin list', async () => {
    const csv = [
      'team_name,representative_email',
      'Private Team,private_rep@example.com',
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    const parsed = parseCsvRows(res.body);
    const [, , username, password] = parsed[1]!;

    // Audit events do not contain representative email
    const auditRes = await database.query<{ row_text: string }>(
      'SELECT row_to_json(audit_events)::text AS row_text FROM audit_events',
    );
    for (const row of auditRes.rows) {
      expect(row.row_text).not.toContain('private_rep@example.com');
    }

    // Team login & session check
    const teamLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password },
    });
    const teamCookie = cookie(teamLogin);

    const sessionRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: teamCookie },
    });
    expect(sessionRes.statusCode).toBe(200);
    expect(sessionRes.body).not.toContain('private_rep@example.com');

    // Public leaderboard does not contain representative email
    const leaderboardRes = await app.inject({
      method: 'GET',
      url: '/api/v1/leaderboard',
    });
    expect(leaderboardRes.body).not.toContain('private_rep@example.com');

    // BTC Admin list DOES contain representativeEmail
    const adminListRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/teams',
      headers: { cookie: adminCookie },
    });
    expect(adminListRes.statusCode).toBe(200);
    const listJson = adminListRes.json<{ data: readonly { name: string; representativeEmail: string | null }[] }>();
    const found = listJson.data.find((t) => t.name === 'Private Team');
    expect(found).toBeDefined();
    expect(found!.representativeEmail).toBe('private_rep@example.com');
  });

  it('bulk reset: creates new file, revokes old sessions, new passwords work, 409 on unknown id', async () => {
    const csv = [
      'team_name,representative_email',
      'Reset Target A,target_a@example.com',
      'Reset Target B,target_b@example.com',
    ].join('\n');

    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-import',
      headers: { cookie: adminCookie },
      payload: { csv },
    });
    const importParsed = parseCsvRows(importRes.body);
    const oldCredA = { username: importParsed[1]![2]!, password: importParsed[1]![3]! };
    const oldCredB = { username: importParsed[2]![2]!, password: importParsed[2]![3]! };

    // Login with old cred A
    const loginA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: oldCredA,
    });
    const sessionCookieA = cookie(loginA);

    // Verify session active
    const sessionBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: sessionCookieA },
    });
    expect(sessionBefore.statusCode).toBe(200);

    // Get team IDs
    const teamsRes = await database.query<{ id: string; name: string }>(
      "SELECT id, name FROM teams WHERE name IN ('Reset Target A', 'Reset Target B') ORDER BY name",
    );
    const teamIds = [teamsRes.rows[0]!.id, teamsRes.rows[1]!.id];

    // Bulk reset with an unknown ID included -> 409 TEAM_NOT_FOUND, nothing changed
    const badResetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-reset',
      headers: { cookie: adminCookie },
      payload: {
        teamIds: [teamIds[0]!, '99999999-9999-9999-9999-999999999999', teamIds[1]!],
      },
    });
    expect(badResetRes.statusCode).toBe(409);
    expect(badResetRes.json().error.code).toBe('TEAM_NOT_FOUND');
    expect(badResetRes.json().error.missingIndexes).toEqual([1]);

    // Successful bulk reset
    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/teams/bulk-reset',
      headers: { cookie: adminCookie },
      payload: { teamIds },
    });
    expect(resetRes.statusCode).toBe(200);
    expect(resetRes.headers['content-type']).toBe('text/csv; charset=utf-8');

    const resetParsed = parseCsvRows(resetRes.body);
    expect(resetParsed).toHaveLength(3); // header + 2 rows
    const newCredA = { username: resetParsed[1]![2]!, password: resetParsed[1]![3]! };
    const newCredB = { username: resetParsed[2]![2]!, password: resetParsed[2]![3]! };

    // Old passwords fail login
    const oldLoginA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: oldCredA,
    });
    expect(oldLoginA.statusCode).toBe(401);

    // Old session revoked
    const sessionAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: sessionCookieA },
    });
    expect(sessionAfter.statusCode).toBe(401);

    // New passwords succeed
    const newLoginA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: newCredA,
    });
    expect(newLoginA.statusCode).toBe(200);

    const newLoginB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: newCredB,
    });
    expect(newLoginB.statusCode).toBe(200);
  });
});
