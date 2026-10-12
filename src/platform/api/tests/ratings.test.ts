import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { calculateEloDelta, expectedScore } from '../src/modules/ratings/elo.ts';
import { applyRoundRatings, rebuildRatingLedger } from '../src/modules/ratings/service.ts';
import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

describe('P2-T13A Elo', () => {
  it('uses the agreed K=32 Elo formula with deterministic zero-sum rounding', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(calculateEloDelta(1000, 1000, 1)).toBe(16);
    expect(calculateEloDelta(1000, 1000, 0.5)).toBe(0);
    expect(calculateEloDelta(1000, 1000, 0)).toBe(-16);
    expect(calculateEloDelta(1400, 1000, 1)).toBe(3);
    expect(calculateEloDelta(1400, 1000, 0)).toBe(-29);
  });

  it('rejects non-finite ratings and scores outside win/draw/loss', () => {
    expect(() => expectedScore(Number.NaN, 1000)).toThrow('RATING_INVALID');
    expect(() => calculateEloDelta(1000, 1000, 0.25)).toThrow('SCORE_INVALID');
  });
});

integration('P2-T13A PostgreSQL Elo ledger', () => {
  let database: Database;
  const suffix = randomUUID();
  const stage = `T13A_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const teamIds = Array.from({ length: 4 }, () => randomUUID());
  const roundId = randomUUID();
  const seriesIds = [randomUUID(), randomUUID()];
  let fixturesCreated = false;

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
    for (const [index, teamId] of teamIds.entries()) {
      await database.query('INSERT INTO teams (id, name) VALUES ($1,$2)', [teamId, `${stage} team ${index}`]);
    }
    const ratingSnapshot = teamIds.map((teamId) => ({ teamId, submissionId: `sub-${teamId}`, rating: 1000 }));
    await database.query(
      "INSERT INTO rounds (id, tournament_stage, idempotency_key, request_hash, schedule_seed, status, rating_snapshot, finalized_at) VALUES ($1,$2,$3,$4,$5,'FINALIZED',$6::jsonb,now())",
      [roundId, stage, 'elo-test', 'a'.repeat(64), 'private-seed', JSON.stringify(ratingSnapshot)],
    );
    await database.query(
      "INSERT INTO series (id, tournament_stage, status, round_id, team_a_id, team_b_id, team_a_score, team_b_score, finalized_at) VALUES ($1,$3,'FINALIZED',$4,$5,$6,2,0,now()),($2,$3,'CANCELLED',$4,$7,$8,NULL,NULL,now())",
      [seriesIds[0], seriesIds[1], stage, roundId, teamIds[0], teamIds[1], teamIds[2], teamIds[3]],
    );
    fixturesCreated = true;
  });

  afterAll(async () => {
    if (database !== undefined) {
      if (fixturesCreated) {
        await database.query('DELETE FROM rating_ledger WHERE series_id = ANY($1::uuid[])', [seriesIds]);
        await database.query('DELETE FROM series WHERE id = ANY($1::uuid[])', [seriesIds]);
        await database.query('DELETE FROM rounds WHERE id = $1', [roundId]);
        await database.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [teamIds]);
      }
      await database.close();
    }
  });

  it('applies one snapshot-based rating per team, skips cancelled series, and rebuilds missing entries deterministically', async () => {
    const applied = await Promise.all([applyRoundRatings(database, roundId), applyRoundRatings(database, roundId)]);
    expect(applied.reduce((count, result) => count + result.inserted, 0)).toBe(2);
    expect(applied.filter(({ replayed }) => !replayed)).toHaveLength(1);
    expect(applied.filter(({ replayed }) => replayed)).toHaveLength(1);
    const initial = await database.query<{ readonly team_id: string; readonly rating_after: number; readonly delta: number }>(
      'SELECT team_id, rating_after, delta FROM rating_ledger WHERE series_id = $1 ORDER BY team_id', [seriesIds[0]],
    );
    const expectedRows = [
      { team_id: teamIds[0]!, rating_after: 1016, delta: 16 },
      { team_id: teamIds[1]!, rating_after: 984, delta: -16 },
    ].sort((a, b) => a.team_id.localeCompare(b.team_id));
    expect(initial.rows).toEqual(expectedRows);
    expect(await database.query('SELECT id FROM rating_ledger WHERE series_id = $1', [seriesIds[1]])).toMatchObject({ rowCount: 0 });
    expect(await rebuildRatingLedger(database, stage)).toEqual({ inserted: 0 });

    await database.query('DELETE FROM rating_ledger WHERE series_id = $1 AND team_id = $2', [seriesIds[0], teamIds[1]]);
    expect(await rebuildRatingLedger(database, stage)).toEqual({ inserted: 1 });
    const rebuilt = await database.query<{ readonly team_id: string; readonly rating_after: number; readonly delta: number }>(
      'SELECT team_id, rating_after, delta FROM rating_ledger WHERE series_id = $1 ORDER BY team_id', [seriesIds[0]],
    );
    expect(rebuilt.rows).toEqual(initial.rows);
    await database.query('UPDATE rating_ledger SET rating_after = rating_after + 1, delta = delta + 1 WHERE series_id = $1 AND team_id = $2', [seriesIds[0], teamIds[0]]);
    await expect(rebuildRatingLedger(database, stage)).rejects.toThrow('RATING_LEDGER_MISMATCH');
  });
});
