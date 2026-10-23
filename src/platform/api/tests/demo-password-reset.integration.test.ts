import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, createPasswordHasher, runMigrations, type Database } from '../src/index.ts';
import { resetDemoTeamPasswords, resetTargets } from '../src/demo/reset-team-passwords.ts';
import { seedDemoAccounts } from '../src/demo/seed-accounts.ts';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const integration = databaseUrl && redisUrl ? describe : describe.skip;
const environment = { OTT_DEMO_PASSWORD_RESET_ENABLED: 'true', OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'test', OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES: 'team01', OTT_DEMO_TEAM_PASSWORD: 'ABC123' };
const hasher = createPasswordHasher({ memoryCost: 8, timeCost: 1 });

describe('P2-T58 demo password reset guards', () => {
  it.each([
    [{}, /OTT_DEMO_PASSWORD_RESET_ENABLED/],
    [{ ...environment, OTT_DEMO_MODE: 'false' }, /OTT_DEMO_MODE/],
    [{ ...environment, OTT_DEPLOYMENT_MODE: 'production' }, /deployment mode/],
    [{ ...environment, OTT_DEMO_PUBLIC: 'true' }, /public/],
    [{ ...environment, OTT_HOSTED_POC: 'true' }, /public/],
    [{ ...environment, OTT_FINALS_MODE: 'true' }, /public/],
    [{ ...environment, OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES: '' }, /allowlist/],
  ])('refuses unsafe env', (env, expected) => {
    expect(() => resetTargets(env)).toThrow(expected);
  });
});

integration('P2-T58 demo password reset integration', () => {
  let database: Database;
  let redis: RedisClientType;
  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await database.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(database);
    redis = createClient({ url: redisUrl! });
    await redis.connect();
  });
  beforeEach(async () => {
    await redis.flushDb();
    await database.query('TRUNCATE audit_events, sessions, accounts, teams RESTART IDENTITY CASCADE;');
  });
  afterAll(async () => {
    if (redis) await redis.quit();
    if (database) await database.close();
  });

  it('resets only the allowlisted team, revokes sessions, writes audit and atomically updates CSV mode', async () => {
    const csvPath = `/tmp/ott-demo-reset-${Date.now()}/accounts.csv`;
    await seedDemoAccounts({ database, passwordHasher: hasher, environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'test' }, csvPath });
    const account = await database.query<{ id: string; team_id: string }>("SELECT id, team_id FROM accounts WHERE username = 'team01'");
    const target = account.rows[0]!;
    const sessionStore = (await import('../src/modules/auth/sessions.ts')).createRedisAuthStore(redis);
    const token = await sessionStore.create({ accountId: target.id, role: 'TEAM_ACCOUNT', teamId: target.team_id });
    const count = await resetDemoTeamPasswords({ database, passwordHasher: hasher, revokeAccount: (id) => sessionStore.revokeAccount(id), environment, csvPath });
    expect(count).toBe(1);
    expect(await sessionStore.read(token)).toBeNull();
    expect(await resetDemoTeamPasswords({ database, passwordHasher: hasher, revokeAccount: (id) => sessionStore.revokeAccount(id), environment, csvPath })).toBe(1);
    const row = await database.query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE username = 'team01'");
    expect(await hasher.verify(row.rows[0]!.password_hash, 'ABC123')).toBe(true);
    expect(await database.query("SELECT id FROM audit_events WHERE action = 'DEMO_TEAM_PASSWORD_RESET' AND target_id = $1", [target.team_id])).toMatchObject({ rowCount: 2 });
    const csv = await import('node:fs/promises');
    const stat = await csv.stat(csvPath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(await csv.readFile(csvPath, 'utf8')).toContain('team01,ABC123,TEAM_ACCOUNT');
  });

  it('refuses BTC and unknown usernames before changing accounts', async () => {
    await seedDemoAccounts({ database, passwordHasher: hasher, environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'test' }, csvPath: `/tmp/ott-demo-reset-${Date.now()}/accounts.csv` });
    await expect(resetDemoTeamPasswords({ database, passwordHasher: hasher, revokeAccount: async () => undefined, environment: { ...environment, OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES: 'btc,missing' }, csvPath: '/tmp/no.csv' })).rejects.toThrow(/resolve to an active TEAM_ACCOUNT/);
    const btc = await database.query<{ password_hash: string }>("SELECT password_hash FROM accounts WHERE username = 'btc'");
    expect(await hasher.verify(btc.rows[0]!.password_hash, 'ABC123')).toBe(true);
  });
});
