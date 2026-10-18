import { createHash } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import { canonicalJson } from '../rounds/types.ts';

export const RESULTS_HASH_VERSION = 1;

interface MatchHashRow {
  readonly match_id: string;
  readonly final_state_hash: string;
  readonly event_log_sha256: string | null;
}

interface LedgerHashRow {
  readonly series_id: string;
  readonly team_id: string;
  readonly rating_before: number;
  readonly rating_after: number;
  readonly delta: number;
}

/**
 * SHA-256 over the canonical JSON of the round's finalized match results and rating ledger rows,
 * both ordered by id so the hash is independent of insertion order.
 */
export async function computeRoundResultsHash(tx: Database, scheduleRoundId: string | null): Promise<string> {
  const matches = scheduleRoundId === null ? [] : (await tx.query<MatchHashRow>(
    `SELECT m.id AS match_id, r.final_state_hash, r.event_log_sha256
     FROM matches m
     JOIN series s ON s.id = m.series_id
     JOIN match_results r ON r.match_id = m.id
     WHERE s.round_id = $1 AND m.status = 'FINALIZED'
     ORDER BY m.id`,
    [scheduleRoundId],
  )).rows;
  const ledger = scheduleRoundId === null ? [] : (await tx.query<LedgerHashRow>(
    `SELECT l.series_id, l.team_id, l.rating_before, l.rating_after, l.delta
     FROM rating_ledger l
     JOIN series s ON s.id = l.series_id
     WHERE s.round_id = $1
     ORDER BY l.series_id, l.team_id`,
    [scheduleRoundId],
  )).rows;
  const document = {
    version: RESULTS_HASH_VERSION,
    matches: matches.map((row) => ({
      matchId: row.match_id,
      finalStateHash: row.final_state_hash,
      eventLogSha256: row.event_log_sha256,
    })),
    ratings: ledger.map((row) => ({
      seriesId: row.series_id,
      teamId: row.team_id,
      ratingBefore: row.rating_before,
      ratingAfter: row.rating_after,
      delta: row.delta,
    })),
  };
  return createHash('sha256').update(canonicalJson(document)).digest('hex');
}
