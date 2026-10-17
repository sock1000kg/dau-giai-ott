import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../../src/db/client.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('P2-T03 PostgreSQL schema', () => {
  let database: Database;

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await database.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(database);
  });

  afterAll(async () => {
    await database.close();
  });

  it('is repeatable and enforces team account, OCI identity, result and rating invariants', async () => {
    await expect(runMigrations(database)).resolves.toEqual({ applied: [] });

    // P3-D03: Assert submission_reservations table and submissions.qualification_round_id column exist
    const reservationTableCheck = await database.query<{ readonly count: string }>(
      "SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'submission_reservations'"
    );
    expect(reservationTableCheck.rows[0]?.count).toBe('1');

    const roundIdColumnCheck = await database.query<{ readonly count: string }>(
      "SELECT COUNT(*)::text AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'submissions' AND column_name = 'qualification_round_id'"
    );
    expect(roundIdColumnCheck.rows[0]?.count).toBe('1');

    const firstTeamId = randomUUID();
    const secondTeamId = randomUUID();
    const firstAccountId = randomUUID();
    const secondAccountId = randomUUID();
    const submissionId = randomUUID();
    const matchId = randomUUID();
    const seriesId = randomUUID();

    await database.query('INSERT INTO teams (id, name) VALUES ($1, $2), ($3, $4)', [firstTeamId, 'Alpha', secondTeamId, 'Beta']);
    await database.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4)",
      [firstAccountId, 'alpha', 'hash', firstTeamId],
    );
    await expect(database.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4)",
      [secondAccountId, 'beta', 'hash', firstTeamId],
    )).rejects.toMatchObject({ code: '23505' });

    await database.query(
      "INSERT INTO submissions (id, team_id, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, status) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')",
      [submissionId, firstTeamId, `sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`, `sha256:${'c'.repeat(64)}`, `submissions/${submissionId}`],
    );
    await expect(database.query('UPDATE submissions SET oci_manifest_digest = $1 WHERE id = $2', [`sha256:${'d'.repeat(64)}`, submissionId])).rejects.toMatchObject({ code: 'P0001' });

    await database.query('INSERT INTO series (id, tournament_stage) VALUES ($1, $2)', [seriesId, 'QUALIFICATION']);
    await database.query('INSERT INTO matches (id, series_id, x_submission_id, o_submission_id, status) VALUES ($1, $2, $3, $3, $4)', [matchId, seriesId, submissionId, 'SCHEDULED']);
    await database.query("INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash) VALUES ($1, 'X', 'FORFEIT', 0, $2)", [matchId, 'f'.repeat(64)]);
    await expect(database.query("INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash) VALUES ($1, 'O', 'FORFEIT', 0, $2)", [matchId, 'e'.repeat(64)])).rejects.toMatchObject({ code: '23505' });

    await database.query('INSERT INTO rating_ledger (team_id, series_id, rating_before, rating_after, delta) VALUES ($1, $2, 1000, 1016, 16)', [firstTeamId, seriesId]);
    await expect(database.query('INSERT INTO rating_ledger (team_id, series_id, rating_before, rating_after, delta) VALUES ($1, $2, 1016, 1032, 16)', [firstTeamId, seriesId])).rejects.toMatchObject({ code: '23505' });
  });
});
