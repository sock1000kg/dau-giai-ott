import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthApp } from '../src/app.ts';
import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import type { PasswordHasher } from '../src/modules/auth/types.ts';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const integration = databaseUrl === undefined || redisUrl === undefined ? describe.skip : describe;

function cookieHeader(value: string | string[] | undefined): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (cookie === undefined) throw new Error('Expected an auth session cookie');
  return cookie.split(';', 1)[0]!;
}

integration('P2-T13C authenticated results API', () => {
  let database: Database;
  let redis: RedisClientType;
  let app: ReturnType<typeof createAuthApp>;
  const suffix = randomUUID();
  const stage = `T13C_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const teamIds = Array.from({ length: 4 }, () => randomUUID());
  const accountIds = Array.from({ length: 5 }, () => randomUUID());
  const usernames = [`a-${suffix}`, `b-${suffix}`, `c-${suffix}`, `d-${suffix}`, `btc-${suffix}`];
  const submissionIds = Array.from({ length: 4 }, () => randomUUID());
  const roundIds = [randomUUID(), randomUUID()];
  const seriesIds = [randomUUID(), randomUUID()];
  const matchIds = seriesIds.flatMap(() => [randomUUID(), randomUUID()]);

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    redis = createClient({ url: redisUrl! });
    await redis.connect();
    await runMigrations(database);
    const passwordHasher: PasswordHasher = { hash: async () => 'test-hash', verify: async () => true };
    app = createAuthApp({ database, redis, passwordHasher, secureCookies: false });
    await app.ready();

    for (const [index, teamId] of teamIds.entries()) {
      await database.query('INSERT INTO teams (id,name) VALUES ($1,$2)', [teamId, `${stage}-Team-${index}`]);
      await database.query(
        "INSERT INTO accounts (id,username,password_hash,role,team_id) VALUES ($1,$2,'test-hash','TEAM_ACCOUNT',$3)",
        [accountIds[index], usernames[index], teamId],
      );
      await database.query(
        "INSERT INTO submissions (id,team_id,tournament_stage,archive_sha256,oci_manifest_digest,oci_config_digest,object_key,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')",
        [submissionIds[index], teamId, stage, `sha256:${String(index + 1).repeat(64)}`, `sha256:${String(index + 5).repeat(64)}`, `sha256:${String(index + 1).repeat(64)}`, `private/${submissionIds[index]}`],
      );
    }
    await database.query(
      "INSERT INTO accounts (id,username,password_hash,role,team_id) VALUES ($1,$2,'test-hash','BTC_ADMIN',NULL)",
      [accountIds[4], usernames[4]],
    );

    for (const [index, roundId] of roundIds.entries()) {
      await database.query(
        "INSERT INTO rounds (id,tournament_stage,idempotency_key,request_hash,schedule_seed,status,rating_snapshot,finalized_at) VALUES ($1,$2,$3,$4,$5,'FINALIZED','[]'::jsonb,now())",
        [roundId, stage, `results-${index}`, String(index + 1).repeat(64), `PRIVATE-SEED-${index}`],
      );
      const firstTeam = index * 2;
      await database.query(
        "INSERT INTO series (id,tournament_stage,status,round_id,team_a_id,team_b_id,team_a_score,team_b_score,winner_team_id,finalized_at) VALUES ($1,$2,'FINALIZED',$3,$4,$5,2,0,$4,now())",
        [seriesIds[index], stage, roundId, teamIds[firstTeam], teamIds[firstTeam + 1]],
      );
      await database.query(
        "INSERT INTO round_participants (round_id,series_id,team_id,assignment,series_slot) VALUES ($1,$2,$3,'PAIRED','A'),($1,$2,$4,'PAIRED','B')",
        [roundId, seriesIds[index], teamIds[firstTeam], teamIds[firstTeam + 1]],
      );
      for (let game = 0; game < 2; game += 1) {
        const matchId = matchIds[index * 2 + game]!;
        const x = game === 0 ? firstTeam : firstTeam + 1;
        const o = game === 0 ? firstTeam + 1 : firstTeam;
        await database.query(
          "INSERT INTO matches (id,series_id,x_submission_id,o_submission_id,status,game_number,seed) VALUES ($1,$2,$3,$4,'FINALIZED',$5,$6)",
          [matchId, seriesIds[index], submissionIds[x], submissionIds[o], game + 1, `PRIVATE-MATCH-SEED-${index}-${game}`],
        );
        await database.query(
          'INSERT INTO match_results (match_id,winner_side,reason,turn_count,final_state_hash,event_log_key,event_log_sha256) VALUES ($1,$2,\'TURN_LIMIT\',4,$3,$4,$5)',
          [matchId, game === 0 ? 'X' : 'O', String(index + 1).repeat(64), `private/replay/${matchId}.json`, `sha256:${String(index + 1).repeat(64)}`],
        );
      }
    }
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
    if (database !== undefined) {
      await database.query('DELETE FROM audit_events WHERE actor_account_id = ANY($1::uuid[])', [accountIds]);
      await database.query('DELETE FROM sessions WHERE account_id = ANY($1::uuid[])', [accountIds]);
      await database.query('DELETE FROM match_results WHERE match_id = ANY($1::uuid[])', [matchIds]);
      await database.query('DELETE FROM matches WHERE id = ANY($1::uuid[])', [matchIds]);
      await database.query('DELETE FROM round_participants WHERE round_id = ANY($1::uuid[])', [roundIds]);
      await database.query('DELETE FROM series WHERE id = ANY($1::uuid[])', [seriesIds]);
      await database.query('DELETE FROM rounds WHERE id = ANY($1::uuid[])', [roundIds]);
      await database.query('DELETE FROM submissions WHERE id = ANY($1::uuid[])', [submissionIds]);
      await database.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
      await database.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [teamIds]);
      await database.close();
    }
    if (redis !== undefined) {
      await redis.flushDb();
      await redis.quit();
    }
  });

  async function login(username: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: 'test-password' } });
    expect(response.statusCode).toBe(200);
    return cookieHeader(response.headers['set-cookie']);
  }

  it('requires login, scopes team accounts to their own team, and rejects IDOR filters', async () => {
    const anonymous = await app.inject({ method: 'GET', url: `/api/v1/results/matches?stage=${stage}` });
    expect(anonymous.statusCode).toBe(401);

    const session = await login(usernames[0]!);
    const matches = await app.inject({ method: 'GET', url: `/api/v1/results/matches?stage=${stage}`, headers: { cookie: session } });
    const series = await app.inject({ method: 'GET', url: `/api/v1/results/series?stage=${stage}`, headers: { cookie: session } });
    expect(matches.statusCode).toBe(200);
    expect(matches.json().data.pagination.total).toBe(2);
    expect(matches.json().data.items.every((item: { readonly teams: { readonly x: { readonly id: string }; readonly o: { readonly id: string } } }) =>
      item.teams.x.id === teamIds[0] || item.teams.o.id === teamIds[0])).toBe(true);
    expect(series.json().data.pagination.total).toBe(1);

    const idor = await app.inject({
      method: 'GET', url: `/api/v1/results/series?stage=${stage}&teamId=${teamIds[2]}`, headers: { cookie: session },
    });
    expect(idor.statusCode).toBe(403);
    expect(idor.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });

  it('lets BTC browse all teams with stable pagination without exposing seeds or private artifact keys', async () => {
    const session = await login(usernames[4]!);
    const first = await app.inject({ method: 'GET', url: `/api/v1/results/matches?stage=${stage}&page=1&pageSize=1`, headers: { cookie: session } });
    const second = await app.inject({ method: 'GET', url: `/api/v1/results/matches?stage=${stage}&page=2&pageSize=1`, headers: { cookie: session } });
    const allSeries = await app.inject({ method: 'GET', url: `/api/v1/results/series?stage=${stage}&pageSize=10`, headers: { cookie: session } });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.pagination).toEqual({ page: 1, pageSize: 1, total: 4, totalPages: 4 });
    expect(second.json().data.items[0].matchId).not.toBe(first.json().data.items[0].matchId);
    expect(allSeries.json().data.pagination.total).toBe(2);
    expect(first.json().data.items[0]).not.toHaveProperty('seed');
    expect(first.json().data.items[0]).not.toHaveProperty('eventLogKey');
    expect(first.json().data.items[0]).not.toHaveProperty('objectKey');
  });
});
