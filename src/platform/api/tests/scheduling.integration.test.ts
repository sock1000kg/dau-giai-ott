import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { dispatchScheduledMatches, scheduleRound, settleSeries } from '../src/modules/scheduling/service.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('P2-T12 PostgreSQL scheduling', () => {
  let database: Database;
  const suffix = randomUUID();
  const stage = `T12_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const teamIds: string[] = [];
  const submissionIds: string[] = [];

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
  });

  afterAll(async () => {
    const fixtureRounds = await database.query<{ readonly id: string }>('SELECT id FROM rounds WHERE tournament_stage = $1', [stage]);
    for (const { id } of fixtureRounds.rows) {
      await database.query('DELETE FROM match_outbox WHERE match_id IN (SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)', [id]);
      await database.query('DELETE FROM match_results WHERE match_id IN (SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)', [id]);
      await database.query('DELETE FROM match_events WHERE match_id IN (SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)', [id]);
      await database.query('DELETE FROM match_attempts WHERE match_id IN (SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)', [id]);
      await database.query('DELETE FROM rating_ledger WHERE series_id IN (SELECT id FROM series WHERE round_id = $1)', [id]);
      await database.query('DELETE FROM matches WHERE series_id IN (SELECT id FROM series WHERE round_id = $1)', [id]);
      await database.query('DELETE FROM round_participants WHERE round_id = $1', [id]);
      await database.query('DELETE FROM series WHERE round_id = $1', [id]);
      await database.query('DELETE FROM rounds WHERE id = $1', [id]);
    }
    if (submissionIds.length > 0) await database.query('DELETE FROM submissions WHERE id = ANY($1::uuid[])', [submissionIds]);
    if (teamIds.length > 0) await database.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [teamIds]);
    await database.close();
  });

  it('freezes a deterministic round, publishes queue outbox once, and settles only terminal series', async () => {
    for (let index = 0; index < 5; index += 1) {
      const teamId = randomUUID();
      const submissionId = randomUUID();
      teamIds.push(teamId);
      submissionIds.push(submissionId);
      await database.query('INSERT INTO teams (id, name) VALUES ($1,$2)', [teamId, `T12 ${suffix} ${index}`]);
      await database.query(
        "INSERT INTO submissions (id, team_id, tournament_stage, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, policy_version, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'P2_BASELINE_V1','ACTIVE')",
        [submissionId, teamId, stage, `sha256:${String(index + 1).repeat(64)}`, `sha256:${String(index + 2).repeat(64)}`, `sha256:${String(index + 3).repeat(64)}`, `t12/${submissionId}`],
      );
    }

    const concurrentInputs = [
      { tournamentStage: stage, idempotencyKey: 'round-concurrent-a' },
      { tournamentStage: stage, idempotencyKey: 'round-concurrent-b' },
    ] as const;
    const concurrentSchedules = await Promise.allSettled(concurrentInputs.map((input) => scheduleRound(database, input)));
    const successfulIndex = concurrentSchedules.findIndex((result) => result.status === 'fulfilled');
    const rejectedIndex = successfulIndex === 0 ? 1 : 0;
    expect(successfulIndex).toBeGreaterThanOrEqual(0);
    expect(concurrentSchedules[rejectedIndex]).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: 'ROUND_IN_PROGRESS' }) });
    const input = concurrentInputs[successfulIndex]!;
    const scheduledResult = concurrentSchedules[successfulIndex]!;
    if (scheduledResult.status !== 'fulfilled') throw new Error('CONCURRENT_SCHEDULE_EXPECTATION_FAILED');
    const scheduled = scheduledResult.value;
    expect(scheduled.seriesIds).toHaveLength(2);
    expect(scheduled.matchIds).toHaveLength(4);
    expect(scheduled.byeTeamId).not.toBeNull();
    await expect(scheduleRound(database, { tournamentStage: stage, idempotencyKey: 'overlapping-round' }))
      .rejects.toThrow('ROUND_IN_PROGRESS');
    const concurrentReplays = await Promise.all([scheduleRound(database, input), scheduleRound(database, input)]);
    expect(concurrentReplays[0]).toEqual({ ...scheduled, replayed: true });
    expect(concurrentReplays[1]).toEqual({ ...scheduled, replayed: true });

    const matchRows = await database.query<{
      readonly id: string;
      readonly series_id: string;
      readonly game_number: number;
      readonly x_submission_id: string;
      readonly o_submission_id: string;
      readonly seed: string;
      readonly map_checksum: string;
    }>('SELECT id, series_id, game_number, x_submission_id, o_submission_id, seed, map_checksum FROM matches WHERE series_id = ANY($1::uuid[]) ORDER BY series_id, game_number', [scheduled.seriesIds]);
    expect(matchRows.rows).toHaveLength(4);
    for (const seriesId of scheduled.seriesIds) {
      const games = matchRows.rows.filter(({ series_id }) => series_id === seriesId);
      expect(games[0]!.x_submission_id).toBe(games[1]!.o_submission_id);
      expect(games[0]!.o_submission_id).toBe(games[1]!.x_submission_id);
      expect(games[0]!.seed).not.toBe(games[1]!.seed);
      expect(games[0]!.map_checksum).toBe(games[1]!.map_checksum);
    }
    expect(await database.query('SELECT id FROM match_outbox WHERE match_id = ANY($1::uuid[]) AND event_type = \'MATCH_SCHEDULED\'', [scheduled.matchIds])).toMatchObject({ rowCount: 4 });
    expect(await database.query('SELECT team_id FROM round_participants WHERE round_id = $1', [scheduled.roundId])).toMatchObject({ rowCount: 5 });
    await expect(database.query('UPDATE rounds SET schedule_seed = $1 WHERE id = $2', ['mutated', scheduled.roundId])).rejects.toMatchObject({ code: 'P0001' });
    await expect(database.query('UPDATE round_participants SET assignment = \'BYE\' WHERE round_id = $1 AND assignment = \'PAIRED\'', [scheduled.roundId])).rejects.toMatchObject({ code: 'P0001' });
    const pair = await database.query<{ readonly team_a_id: string; readonly team_b_id: string }>(
      'SELECT team_a_id, team_b_id FROM series WHERE id = $1', [scheduled.seriesIds[0]],
    );
    await expect(database.query(
      "INSERT INTO series (id, tournament_stage, round_id, team_a_id, team_b_id) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), stage, scheduled.roundId, pair.rows[0]!.team_b_id, pair.rows[0]!.team_a_id],
    )).rejects.toMatchObject({ code: '23505' });

    const jobs: string[] = [];
    const enqueuer = { enqueue: async (job: { readonly matchId: string }) => { jobs.push(job.matchId); } };
    await expect(dispatchScheduledMatches(database, { enqueue: async () => { throw new Error('QUEUE_DOWN'); } })).rejects.toThrow('QUEUE_DOWN');
    expect(await dispatchScheduledMatches(database, enqueuer)).toBe(4);
    expect(await dispatchScheduledMatches(database, enqueuer)).toBe(0);
    expect(jobs).toHaveLength(4);

    const tieSeries = scheduled.seriesIds[0]!;
    const tieGames = matchRows.rows.filter(({ series_id }) => series_id === tieSeries);
    await expect(database.query('UPDATE matches SET game_number = 2 WHERE id = $1', [tieGames[0]!.id])).rejects.toMatchObject({ code: 'P0001' });
    for (const [index, match] of tieGames.entries()) {
      await database.query("UPDATE matches SET status = 'FINALIZED' WHERE id = $1", [match.id]);
      await database.query(
        'INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash) VALUES ($1,$2,\'TURN_LIMIT\',4,$3)',
        [match.id, 'X', `${index === 0 ? 'a' : 'b'}${'0'.repeat(63)}`],
      );
    }
    const settled = await settleSeries(database, tieSeries);
    expect(settled).toMatchObject({ state: 'FINALIZED', teamAScore: 1, teamBScore: 1, winnerTeamId: null });
    expect(await settleSeries(database, tieSeries)).toEqual(settled);
    expect((await database.query<{ readonly status: string }>('SELECT status FROM rounds WHERE id = $1', [scheduled.roundId])).rows[0]?.status).toBe('SCHEDULED');
    await expect(scheduleRound(database, { tournamentStage: stage, idempotencyKey: 'overlapping-round-after-one-series' }))
      .rejects.toThrow('ROUND_IN_PROGRESS');

    const cancelledSeries = scheduled.seriesIds[1]!;
    const cancelledGames = matchRows.rows.filter(({ series_id }) => series_id === cancelledSeries);
    await database.query("UPDATE matches SET status = 'FAILED' WHERE id = $1", [cancelledGames[0]!.id]);
    await database.query("UPDATE matches SET status = 'CANCELLED' WHERE id = $1", [cancelledGames[1]!.id]);
    expect(await settleSeries(database, cancelledSeries)).toEqual({ state: 'CANCELLED', reason: 'INFRASTRUCTURE_FAILURE' });
    expect(await settleSeries(database, cancelledSeries)).toEqual({ state: 'CANCELLED', reason: 'INFRASTRUCTURE_FAILURE' });
    const round = await database.query<{ readonly status: string }>('SELECT status FROM rounds WHERE id = $1', [scheduled.roundId]);
    expect(round.rows[0]?.status).toBe('FINALIZED');
    expect(await database.query('SELECT team_id FROM rating_ledger WHERE series_id = $1', [tieSeries])).toMatchObject({ rowCount: 2 });
    expect(await database.query('SELECT team_id FROM rating_ledger WHERE series_id = $1', [cancelledSeries])).toMatchObject({ rowCount: 0 });
    const nextRound = await scheduleRound(database, { tournamentStage: stage, idempotencyKey: 'round-after-rating' });
    expect(nextRound.replayed).toBe(false);
    expect(nextRound.roundId).not.toBe(scheduled.roundId);
  });
});
