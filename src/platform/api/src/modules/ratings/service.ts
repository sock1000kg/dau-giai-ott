import type { Database } from '../../db/client.ts';
import { calculateEloDelta } from './elo.ts';

interface RatingSnapshotEntry {
  readonly teamId: string;
  readonly rating: number;
}

interface RoundRow {
  readonly id: string;
  readonly tournament_stage: string;
  readonly status: 'SCHEDULED' | 'FINALIZED';
  readonly rating_snapshot: unknown;
  readonly rating_applied_at: Date | null;
}

interface SeriesRow {
  readonly id: string;
  readonly status: 'SCHEDULED' | 'FINALIZED' | 'CANCELLED';
  readonly team_a_id: string;
  readonly team_b_id: string;
  readonly team_a_score: string | null;
  readonly team_b_score: string | null;
}

interface ExpectedLedgerEntry {
  readonly teamId: string;
  readonly seriesId: string;
  readonly ratingBefore: number;
  readonly delta: number;
  readonly ratingAfter: number;
}

interface LedgerRow {
  readonly team_id: string;
  readonly series_id: string;
  readonly rating_before: number;
  readonly rating_after: number;
  readonly delta: number;
}

function parseSnapshot(value: unknown): Map<string, number> {
  if (!Array.isArray(value)) throw new Error('RATING_SNAPSHOT_INVALID');
  const ratings = new Map<string, number>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null || !('teamId' in item) || !('rating' in item)) {
      throw new Error('RATING_SNAPSHOT_INVALID');
    }
    const entry = item as RatingSnapshotEntry;
    if (typeof entry.teamId !== 'string' || !Number.isSafeInteger(entry.rating) || ratings.has(entry.teamId)) {
      throw new Error('RATING_SNAPSHOT_INVALID');
    }
    ratings.set(entry.teamId, entry.rating);
  }
  return ratings;
}

function expectedEntries(round: RoundRow, series: readonly SeriesRow[]): ExpectedLedgerEntry[] {
  const snapshot = parseSnapshot(round.rating_snapshot);
  const rows: ExpectedLedgerEntry[] = [];
  const seenTeams = new Set<string>();
  for (const item of series) {
    if (item.status === 'CANCELLED') continue;
    if (item.status !== 'FINALIZED' || item.team_a_score === null || item.team_b_score === null) {
      throw new Error('ROUND_NOT_TERMINAL');
    }
    if (seenTeams.has(item.team_a_id) || seenTeams.has(item.team_b_id)) throw new Error('ROUND_TEAM_DUPLICATE');
    seenTeams.add(item.team_a_id);
    seenTeams.add(item.team_b_id);
    const ratingA = snapshot.get(item.team_a_id);
    const ratingB = snapshot.get(item.team_b_id);
    if (ratingA === undefined || ratingB === undefined) throw new Error('RATING_SNAPSHOT_TEAM_MISSING');
    const scoreA = Number(item.team_a_score) > Number(item.team_b_score) ? 1
      : Number(item.team_a_score) < Number(item.team_b_score) ? 0 : 0.5;
    const deltaA = calculateEloDelta(ratingA, ratingB, scoreA);
    rows.push(
      { teamId: item.team_a_id, seriesId: item.id, ratingBefore: ratingA, delta: deltaA, ratingAfter: ratingA + deltaA },
      { teamId: item.team_b_id, seriesId: item.id, ratingBefore: ratingB, delta: -deltaA, ratingAfter: ratingB - deltaA },
    );
  }
  return rows;
}

async function applyRoundInTransaction(
  transaction: Database,
  roundId: string,
  repair: boolean,
): Promise<{ readonly inserted: number; readonly wasApplied: boolean }> {
  const selected = await transaction.query<RoundRow>(
    'SELECT id, tournament_stage, status, rating_snapshot, rating_applied_at FROM rounds WHERE id = $1 FOR UPDATE', [roundId],
  );
  const round = selected.rows[0];
  if (round === undefined) throw new Error('ROUND_NOT_FOUND');
  if (round.status !== 'FINALIZED') throw new Error('ROUND_NOT_FINALIZED');
  const result = await transaction.query<SeriesRow>(
    'SELECT id, status, team_a_id, team_b_id, team_a_score, team_b_score FROM series WHERE round_id = $1 ORDER BY id', [roundId],
  );
  const expected = expectedEntries(round, result.rows);
  const expectedByKey = new Map(expected.map((entry) => [`${entry.seriesId}:${entry.teamId}`, entry]));
  const existing = await transaction.query<LedgerRow>(
    'SELECT team_id, series_id, rating_before, rating_after, delta FROM rating_ledger WHERE series_id = ANY($1::uuid[])',
    [result.rows.map(({ id }) => id)],
  );
  for (const row of existing.rows) {
    const item = expectedByKey.get(`${row.series_id}:${row.team_id}`);
    if (item === undefined || item.ratingBefore !== row.rating_before || item.ratingAfter !== row.rating_after || item.delta !== row.delta) {
      throw new Error('RATING_LEDGER_MISMATCH');
    }
  }
  if (!repair && round.rating_applied_at !== null && existing.rows.length !== expected.length) throw new Error('RATING_LEDGER_INCOMPLETE');
  if (round.rating_applied_at !== null && !repair) return { inserted: 0, wasApplied: true };

  let inserted = 0;
  for (const entry of expected) {
    const insert = await transaction.query(
      'INSERT INTO rating_ledger (team_id, series_id, rating_before, rating_after, delta) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (team_id, series_id) DO NOTHING',
      [entry.teamId, entry.seriesId, entry.ratingBefore, entry.ratingAfter, entry.delta],
    );
    inserted += insert.rowCount ?? 0;
  }
  await transaction.query('UPDATE rounds SET rating_applied_at = COALESCE(rating_applied_at, now()) WHERE id = $1', [roundId]);
  return { inserted, wasApplied: round.rating_applied_at !== null };
}

/** Atomically apply all Elo entries for one fully terminal round; retries are idempotent. */
export async function applyRoundRatings(database: Database, roundId: string): Promise<{ readonly inserted: number; readonly replayed: boolean }> {
  return database.transaction(async (transaction) => {
    const applied = await applyRoundInTransaction(transaction, roundId, false);
    return { inserted: applied.inserted, replayed: applied.wasApplied };
  });
}

/** Reconstruct missing rows from immutable round snapshots/results without rewriting ledger history. */
export async function rebuildRatingLedger(database: Database, tournamentStage: string): Promise<{ readonly inserted: number }> {
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`rating-rebuild:${tournamentStage}`]);
    const rounds = await transaction.query<{ readonly id: string }>(
      "SELECT id FROM rounds WHERE tournament_stage = $1 AND status = 'FINALIZED' ORDER BY finalized_at, id", [tournamentStage],
    );
    let inserted = 0;
    for (const { id } of rounds.rows) inserted += (await applyRoundInTransaction(transaction, id, true)).inserted;
    return { inserted };
  });
}
