import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';

import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createAuthApp,
  createDatabase,
  createPasswordHasher,
  runMigrations,
  type Database,
} from '../src/index.ts';
import { seedDemoAccounts } from '../src/demo/seed-accounts.ts';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const testHasher = createPasswordHasher({ memoryCost: 8, timeCost: 1 });

integration('P2-T35 demo accounts and credential CSV', () => {
  let database: Database;
  let redis: RedisClientType | null = null;

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await database.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(database);
    if (redisUrl !== undefined) {
      redis = createClient({ url: redisUrl });
      await redis.connect();
    }
  });

  beforeEach(async () => {
    if (redis !== null) {
      await redis.flushDb();
    }
    await database.query('TRUNCATE audit_events, sessions, accounts, teams RESTART IDENTITY CASCADE;');
  });

  afterAll(async () => {
    if (redis !== null) {
      await redis.quit();
    }
    if (database !== undefined) {
      await database.close();
    }
  });

  it('(a) refuses when OTT_DEMO_MODE is absent or false', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const csvPath = path.join(tmpDir, 'sub', 'accounts.csv');
    try {
      // 1. Absent
      await expect(
        seedDemoAccounts({
          database,
          passwordHasher: testHasher,
          environment: { OTT_DEPLOYMENT_MODE: 'dev' },
          csvPath,
        }),
      ).rejects.toThrow(/OTT_DEMO_MODE/);

      // 2. Explicitly 'false'
      await expect(
        seedDemoAccounts({
          database,
          passwordHasher: testHasher,
          environment: { OTT_DEMO_MODE: 'false', OTT_DEPLOYMENT_MODE: 'dev' },
          csvPath,
        }),
      ).rejects.toThrow(/OTT_DEMO_MODE/);

      // Verify no rows created
      const accts = await database.query<{ count: string }>('SELECT count(*)::int AS count FROM accounts');
      expect(Number(accts.rows[0]?.count)).toBe(0);
      const teams = await database.query<{ count: string }>('SELECT count(*)::int AS count FROM teams');
      expect(Number(teams.rows[0]?.count)).toBe(0);

      // Verify no CSV exists
      expect(fs.existsSync(csvPath)).toBe(false);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('(b) refuses when OTT_DEPLOYMENT_MODE is production, hosted, or missing', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const csvPath = path.join(tmpDir, 'sub', 'accounts.csv');
    try {
      for (const badMode of ['production', 'hosted', undefined, 'staging', '']) {
        await expect(
          seedDemoAccounts({
            database,
            passwordHasher: testHasher,
            environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: badMode },
            csvPath,
          }),
        ).rejects.toThrow(/OTT_DEPLOYMENT_MODE/);
      }

      const accts = await database.query<{ count: string }>('SELECT count(*)::int AS count FROM accounts');
      expect(Number(accts.rows[0]?.count)).toBe(0);
      const teams = await database.query<{ count: string }>('SELECT count(*)::int AS count FROM teams');
      expect(Number(teams.rows[0]?.count)).toBe(0);
      expect(fs.existsSync(csvPath)).toBe(false);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('(c) creates exactly three accounts with correct roles and team bindings', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const csvPath = path.join(tmpDir, 'accounts.csv');
    try {
      const summary = await seedDemoAccounts({
        database,
        passwordHasher: testHasher,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
        csvPath,
      });

      expect(summary).toHaveLength(3);
      expect(summary.map((s) => s.username).sort()).toEqual(['btc', 'team01', 'team02']);
      expect(summary.every((s) => s.created)).toBe(true);

      const accountsRes = await database.query<{
        username: string;
        role: string;
        team_id: string | null;
        team_name: string | null;
      }>(
        `SELECT a.username, a.role, a.team_id, t.name AS team_name
         FROM accounts a
         LEFT JOIN teams t ON a.team_id = t.id
         ORDER BY a.username`,
      );

      expect(accountsRes.rows).toHaveLength(3);
      const [btc, team01, team02] = accountsRes.rows;

      expect(btc?.username).toBe('btc');
      expect(btc?.role).toBe('BTC_ADMIN');
      expect(btc?.team_id).toBeNull();
      expect(btc?.team_name).toBeNull();

      expect(team01?.username).toBe('team01');
      expect(team01?.role).toBe('TEAM_ACCOUNT');
      expect(team01?.team_id).toBeTruthy();
      expect(team01?.team_name).toBe('Team 01');

      expect(team02?.username).toBe('team02');
      expect(team02?.role).toBe('TEAM_ACCOUNT');
      expect(team02?.team_id).toBeTruthy();
      expect(team02?.team_name).toBe('Team 02');

      expect(team01?.team_id).not.toBe(team02?.team_id);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('(d) stored password_hash starts with $argon2id$ and plaintext appears in no column, and login succeeds', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const csvPath = path.join(tmpDir, 'accounts.csv');
    try {
      await seedDemoAccounts({
        database,
        passwordHasher: testHasher,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
        csvPath,
      });

      const rows = await database.query<Record<string, unknown>>('SELECT * FROM accounts');
      expect(rows.rows).toHaveLength(3);

      for (const row of rows.rows) {
        const hashStr = String(row['password_hash']);
        expect(hashStr.startsWith('$argon2id$')).toBe(true);
        // Assert no column anywhere in the accounts table contains the plaintext password
        for (const [col, val] of Object.entries(row)) {
          expect(val, `Column ${col} contains plaintext password`).not.toBe('ABC123');
        }
        // Direct hasher verification
        const valid = await testHasher.verify(hashStr, 'ABC123');
        expect(valid).toBe(true);
      }

      // Real auth path via createAuthApp if redis is available
      if (redis !== null) {
        const app = createAuthApp({
          database,
          redis,
          passwordHasher: testHasher,
          secureCookies: false,
        });
        await app.ready();
        try {
          const accountsQuery = await database.query<{ username: string; role: string; team_id: string | null }>(
            'SELECT username, role, team_id FROM accounts',
          );
          const accountMap = new Map(accountsQuery.rows.map((a) => [a.username, a]));

          const teamIds: string[] = [];
          for (const username of ['btc', 'team01', 'team02']) {
            const res = await app.inject({
              method: 'POST',
              url: '/api/v1/auth/login',
              payload: { username, password: 'ABC123' },
            });
            expect(res.statusCode).toBe(200);
            expect(res.headers['set-cookie']).toBeDefined();
            const expected = accountMap.get(username);
            expect(expected).toBeDefined();
            if (username === 'btc') {
              expect(res.json()).toEqual({ data: { role: 'BTC_ADMIN' } });
            } else {
              expect(typeof expected!.team_id).toBe('string');
              expect(res.json()).toEqual({ data: { role: 'TEAM_ACCOUNT', teamId: expected!.team_id } });
              teamIds.push(expected!.team_id!);
            }
          }
          expect(new Set(teamIds).size).toBe(2);
        } finally {
          await app.close();
        }
      }
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('(e) second run: counts unchanged, created=false', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const csvPath = path.join(tmpDir, 'accounts.csv');
    try {
      const firstRun = await seedDemoAccounts({
        database,
        passwordHasher: testHasher,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
        csvPath,
      });
      expect(firstRun.every((r) => r.created)).toBe(true);

      const secondRun = await seedDemoAccounts({
        database,
        passwordHasher: testHasher,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
        csvPath,
      });
      expect(secondRun).toHaveLength(3);
      expect(secondRun.every((r) => !r.created)).toBe(true);

      const acctsCount = await database.query<{ count: string }>('SELECT count(*)::int AS count FROM accounts');
      expect(Number(acctsCount.rows[0]?.count)).toBe(3);
      const teamsCount = await database.query<{ count: string }>('SELECT count(*)::int AS count FROM teams');
      expect(Number(teamsCount.rows[0]?.count)).toBe(2);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('(f) CSV: mode 0600, dir 0700, header + 3 rows, passwords ABC123', async () => {
    const tmpBase = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const demoDir = path.join(tmpBase, 'demo-dir');
    const csvPath = path.join(demoDir, 'accounts.csv');
    try {
      await seedDemoAccounts({
        database,
        passwordHasher: testHasher,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
        csvPath,
      });

      const dirStat = await fs.promises.stat(demoDir);
      expect(dirStat.mode & 0o777).toBe(0o700);

      const fileStat = await fs.promises.stat(csvPath);
      expect(fileStat.mode & 0o777).toBe(0o600);

      const content = await fs.promises.readFile(csvPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe('username,password,role,team');
      expect(lines[1]).toBe('btc,ABC123,BTC_ADMIN,');
      expect(lines[2]).toBe('team01,ABC123,TEAM_ACCOUNT,Team 01');
      expect(lines[3]).toBe('team02,ABC123,TEAM_ACCOUNT,Team 02');
    } finally {
      await fs.promises.rm(tmpBase, { recursive: true, force: true });
    }
  });

  it('(g) pre-existing team01 with a different password leaves untouched hash and CSV cell empty', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const csvPath = path.join(tmpDir, 'accounts.csv');
    try {
      const teamId = randomUUID();
      await database.query('INSERT INTO teams (id, name, representative_email) VALUES ($1, $2, $3)', [
        teamId,
        'Team 01',
        'team01@demo.invalid',
      ]);
      const customHash = await testHasher.hash('different-secret-password');
      await database.query(
        "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, 'team01', $2, 'TEAM_ACCOUNT', $3)",
        [randomUUID(), customHash, teamId],
      );

      const summary = await seedDemoAccounts({
        database,
        passwordHasher: testHasher,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
        csvPath,
      });

      expect(summary.find((s) => s.username === 'team01')?.created).toBe(false);

      // Verify stored hash in DB was untouched
      const checkRow = await database.query<{ password_hash: string }>(
        "SELECT password_hash FROM accounts WHERE username = 'team01'",
      );
      expect(checkRow.rows[0]?.password_hash).toBe(customHash);

      // Verify CSV line
      const content = await fs.promises.readFile(csvPath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines[0]).toBe('username,password,role,team');
      const team01Line = lines.find((l) => l.startsWith('team01,'));
      expect(team01Line).toBe('team01,,TEAM_ACCOUNT,Team 01');
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('(h) pre-existing team01 as BTC_ADMIN throws error', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const csvPath = path.join(tmpDir, 'accounts.csv');
    try {
      const customHash = await testHasher.hash('some-password');
      await database.query(
        "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, 'team01', $2, 'BTC_ADMIN', NULL)",
        [randomUUID(), customHash],
      );

      await expect(
        seedDemoAccounts({
          database,
          passwordHasher: testHasher,
          environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
          csvPath,
        }),
      ).rejects.toThrow(/already exists with a different role/);
    } finally {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('(i) console and logger output captured during a run does not contain ABC123', async () => {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ott-demo-test-'));
    const csvPath = path.join(tmpDir, 'accounts.csv');

    let stdoutCaptured = '';
    let stderrCaptured = '';
    const origStdout = process.stdout.write.bind(process.stdout);
    const origStderr = process.stderr.write.bind(process.stderr);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stdout.write = ((chunk: any, ...args: any[]) => {
      stdoutCaptured += String(chunk);
      return origStdout(chunk, ...args);
    }) as typeof process.stdout.write;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.stderr.write = ((chunk: any, ...args: any[]) => {
      stderrCaptured += String(chunk);
      return origStderr(chunk, ...args);
    }) as typeof process.stderr.write;

    try {
      await seedDemoAccounts({
        database,
        passwordHasher: testHasher,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
        csvPath,
      });

      expect(stdoutCaptured.includes('ABC123')).toBe(false);
      expect(stderrCaptured.includes('ABC123')).toBe(false);
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
