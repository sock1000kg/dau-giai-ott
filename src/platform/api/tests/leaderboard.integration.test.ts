import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthApp } from '../src/app.ts';
import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import type { RedisAuthCommands } from '../src/modules/auth/sessions.ts';
import type { PasswordHasher } from '../src/modules/auth/types.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('P2-T13B public leaderboard API', () => {
  let database: Database;
  let app: ReturnType<typeof createAuthApp>;
  const stage = `T13B_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const teamIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const submissionIds = teamIds.map(() => randomUUID());
  const roundIds = [randomUUID(), randomUUID(), randomUUID()];
  const seriesIds = [randomUUID(), randomUUID(), randomUUID()];
  const matchIds = seriesIds.flatMap(() => [randomUUID(), randomUUID()]);

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
    const redis: RedisAuthCommands = {
      get: async () => null,
      set: async () => 'OK',
      del: async () => 0,
      incr: async () => 1,
      expire: async () => 1,
      sAdd: async () => 1,
      sMembers: async () => [],
    };
    const passwordHasher: PasswordHasher = { hash: async () => 'unused', verify: async () => false };
    app = createAuthApp({ database, redis, passwordHasher, secureCookies: false });
    await app.ready();
    for (const [index, teamId] of teamIds.entries()) {
      await database.query('INSERT INTO teams (id, name) VALUES ($1,$2)', [teamId, `Team-${index}`]);
      await database.query(
        "INSERT INTO submissions (id, team_id, tournament_stage, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')",
        [submissionIds[index], teamId, stage, `sha256:${String(index + 1).repeat(64)}`, `sha256:${String(index + 5).repeat(64)}`, `sha256:${String(index + 1).repeat(64)}`, `t13b/${submissionIds[index]}`],
      );
    }
    for (const [index, roundId] of roundIds.entries()) {
      await database.query(
        "INSERT INTO rounds (id, tournament_stage, idempotency_key, request_hash, schedule_seed, status, rating_snapshot, finalized_at, created_at) VALUES ($1,$2,$3,$4,$5,'FINALIZED','[]'::jsonb,now(),now() + ($6::integer * interval '1 minute'))",
        [roundId, stage, `leaderboard-${index}`, String(index + 1).repeat(64), `seed-${index}`, index],
      );
    }
    const pairs = [[0, 1], [2, 3], [0, 2]] as const;
    for (const [index, [a, b]] of pairs.entries()) {
      await database.query(
        "INSERT INTO series (id, tournament_stage, status, round_id, team_a_id, team_b_id, team_a_score, team_b_score, finalized_at, created_at) VALUES ($1,$2,'FINALIZED',$3,$4,$5,$6,$7,now(),now() + ($8::integer * interval '1 minute'))",
        [seriesIds[index], stage, roundIds[index], teamIds[a], teamIds[b], 2, 0, index],
      );
      await database.query(
        "INSERT INTO round_participants (round_id,series_id,team_id,assignment,series_slot) VALUES ($1,$2,$3,'PAIRED','A'),($1,$2,$4,'PAIRED','B')",
        [roundIds[index], seriesIds[index], teamIds[a], teamIds[b]],
      );
      await database.query(
        'INSERT INTO rating_ledger (team_id,series_id,rating_before,rating_after,delta) VALUES ($1,$3,$4,$5,$6),($2,$3,$7,$8,$9)',
        [teamIds[a], teamIds[b], seriesIds[index], index === 2 ? 1200 : 1000, 1200, index === 2 ? 0 : 200,
          index === 2 ? 1200 : 1000, index === 2 ? 1200 : 1000, 0],
      );
      const xTeamIndex = a;
      const oTeamIndex = b;
      for (let game = 0; game < 2; game += 1) {
        const matchId = matchIds[index * 2 + game]!;
        const x = game === 0 ? xTeamIndex : oTeamIndex;
        const o = game === 0 ? oTeamIndex : xTeamIndex;
        await database.query(
          "INSERT INTO matches (id,series_id,x_submission_id,o_submission_id,status,game_number) VALUES ($1,$2,$3,$4,'FINALIZED',$5)",
          [matchId, seriesIds[index], submissionIds[x], submissionIds[o], game + 1],
        );
        const winnerSide = game === 0 ? 'X' : 'O';
        const reason = index === 1 && game === 1 ? 'FORFEIT' : 'TURN_LIMIT';
        await database.query(
          'INSERT INTO match_results (match_id,winner_side,reason,turn_count,final_state_hash) VALUES ($1,$2,$3,1,$4)',
          [matchId, winnerSide, reason, String(index + 1).repeat(64)],
        );
      }
    }
    await database.query(
      "INSERT INTO match_events (match_id,sequence,event_type,payload) VALUES ($1,1,'TURN_SKIPPED',$2::jsonb),($3,1,'TURN_SKIPPED',$4::jsonb)",
      [matchIds[0], JSON.stringify({ side: 'O', reason: 'BOT_TIMEOUT' }), matchIds[1], JSON.stringify({ side: 'X', reason: 'NO_LEGAL_ACTION' })],
    );
  });

  afterAll(async () => {
    if (database !== undefined) {
      await database.query('DELETE FROM match_events WHERE match_id = ANY($1::uuid[])', [matchIds]);
      await database.query('DELETE FROM match_results WHERE match_id = ANY($1::uuid[])', [matchIds]);
      await database.query('DELETE FROM rating_ledger WHERE series_id = ANY($1::uuid[])', [seriesIds]);
      await database.query('DELETE FROM matches WHERE id = ANY($1::uuid[])', [matchIds]);
      await database.query('DELETE FROM round_participants WHERE round_id = ANY($1::uuid[])', [roundIds]);
      await database.query('DELETE FROM series WHERE id = ANY($1::uuid[])', [seriesIds]);
      await database.query('DELETE FROM rounds WHERE id = ANY($1::uuid[])', [roundIds]);
      await database.query('DELETE FROM submissions WHERE id = ANY($1::uuid[])', [submissionIds]);
      await database.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [teamIds]);
      await database.close();
    }
    await app.close();
  });

  it('is public, applies ranking tie-breaks, marks unresolved draws and paginates stably', async () => {
    const first = await app.inject({ method: 'GET', url: `/api/v1/leaderboard?stage=${stage}&page=1&pageSize=2` });
    const second = await app.inject({ method: 'GET', url: `/api/v1/leaderboard?stage=${stage}&page=2&pageSize=2` });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const secondPageItems = second.json().data.items;
    const repeatedSecond = await app.inject({ method: 'GET', url: `/api/v1/leaderboard?stage=${stage}&page=2&pageSize=2` });

    expect(first.json().data.items).toMatchObject([
      { rank: 1, team: { name: 'Team-0' }, rating: 1200, series: { wins: 2, draws: 0, losses: 0 }, tieBreakStatus: 'CLEAR' },
      { rank: 2, team: { name: 'Team-2' }, rating: 1200, series: { wins: 1, draws: 0, losses: 1 }, tieBreakStatus: 'CLEAR' },
    ]);
    expect(secondPageItems.map((item: { readonly team: { readonly id: string } }) => item.team.id)).toEqual(
      [...secondPageItems.map((item: { readonly team: { readonly id: string } }) => item.team.id)].sort(),
    );
    expect(secondPageItems.find((item: { readonly team: { readonly name: string } }) => item.team.name === 'Team-1'))
      .toMatchObject({ rank: 3, technicalFaultCount: 1, forfeitCount: 0, tieBreakStatus: 'BTC_REQUIRED' });
    expect(secondPageItems.find((item: { readonly team: { readonly name: string } }) => item.team.name === 'Team-3'))
      .toMatchObject({ rank: 3, technicalFaultCount: 0, forfeitCount: 1, tieBreakStatus: 'BTC_REQUIRED' });
    expect(repeatedSecond.json().data.items.map((item: { readonly team: { readonly id: string } }) => item.team.id))
      .toEqual(secondPageItems.map((item: { readonly team: { readonly id: string } }) => item.team.id));
    expect(first.json().data.pagination).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
    expect(first.json().data.items[0]).not.toHaveProperty('scheduleSeed');
    expect(first.json().data.items[0]).not.toHaveProperty('objectKey');
  });

  it('bounds and validates pagination and stage input', async () => {
    const invalid = await app.inject({ method: 'GET', url: '/api/v1/leaderboard?stage=../private&page=0&pageSize=1000' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
});
