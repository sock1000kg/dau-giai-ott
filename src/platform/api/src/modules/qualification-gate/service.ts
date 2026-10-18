import { randomUUID } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import { evaluateGate, GateError, type GateGameInput, type GateSide } from './gate.ts';

export interface GateContext {
  readonly actorAccountId: string;
  readonly correlationId: string;
  readonly reason: string;
}

export interface RecordGateInput {
  readonly submissionId: string;
  readonly gateBotId: string;
  readonly gateBotDigest: string;
  readonly game1MatchId: string;
  readonly game2MatchId: string;
}

export interface GateResultView {
  readonly id: string;
  readonly submissionId: string;
  readonly gateBotId: string;
  readonly gateBotDigest: string;
  readonly game1MatchId: string | null;
  readonly game2MatchId: string | null;
  readonly game1Points: number;
  readonly game2Points: number;
  readonly points: number;
  readonly outcome: 'PASS' | 'FAIL';
  readonly reason: string;
  readonly createdAt: Date;
}

interface GateRow {
  readonly id: string;
  readonly submission_id: string;
  readonly gate_bot_id: string;
  readonly gate_bot_digest: string;
  readonly game1_match_id: string | null;
  readonly game2_match_id: string | null;
  readonly game1_points: string;
  readonly game2_points: string;
  readonly points: string;
  readonly outcome: 'PASS' | 'FAIL';
  readonly reason: string;
  readonly created_at: Date;
}

const gateColumns = 'id, submission_id, gate_bot_id, gate_bot_digest, game1_match_id, game2_match_id, game1_points, game2_points, points, outcome, reason, created_at';

function view(row: GateRow): GateResultView {
  return {
    id: row.id,
    submissionId: row.submission_id,
    gateBotId: row.gate_bot_id,
    gateBotDigest: row.gate_bot_digest,
    game1MatchId: row.game1_match_id,
    game2MatchId: row.game2_match_id,
    game1Points: Number(row.game1_points),
    game2Points: Number(row.game2_points),
    points: Number(row.points),
    outcome: row.outcome,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

interface MatchRow {
  readonly id: string;
  readonly status: string;
  readonly x_submission_id: string;
  readonly o_submission_id: string;
  readonly x_digest: string;
  readonly o_digest: string;
  readonly has_result: boolean;
  readonly winner_side: GateSide | null;
}

async function loadGame(tx: Database, input: RecordGateInput, matchId: string): Promise<GateGameInput> {
  const found = await tx.query<MatchRow>(`
    SELECT m.id, m.status, m.x_submission_id, m.o_submission_id,
      sx.oci_manifest_digest AS x_digest, so.oci_manifest_digest AS o_digest,
      (r.match_id IS NOT NULL) AS has_result, r.winner_side
    FROM matches m
    JOIN submissions sx ON sx.id = m.x_submission_id
    JOIN submissions so ON so.id = m.o_submission_id
    LEFT JOIN match_results r ON r.match_id = m.id
    WHERE m.id = $1`, [matchId]);
  const match = found.rows[0];
  if (match === undefined) throw new GateError(404, 'GATE_MATCH_NOT_FOUND', 'Gate match not found');
  const submissionSide: GateSide | null = match.x_submission_id === input.submissionId ? 'X'
    : match.o_submission_id === input.submissionId ? 'O' : null;
  if (submissionSide === null) throw new GateError(422, 'GATE_MATCH_FOREIGN', 'Match does not belong to the submission');
  const opponentDigest = submissionSide === 'X' ? match.o_digest : match.x_digest;
  if (opponentDigest !== input.gateBotDigest) throw new GateError(422, 'GATE_MATCH_FOREIGN', 'Match was not played against the pinned gate bot');
  if (match.status === 'FINALIZED' && match.has_result) return { state: 'FINALIZED', submissionSide, winnerSide: match.winner_side };
  if (match.status === 'FAILED') return { state: 'INFRA_FAILED', submissionSide };
  if (match.status === 'CANCELLED') return { state: 'CANCELLED', submissionSide };
  return { state: 'PENDING', submissionSide };
}

/**
 * Compute and persist the capture-first gate decision from two finalized `match_results` rows.
 * Points are derived here, never taken from the caller. Retries with identical data replay the stored
 * row; a different match pair for the same (submission, gate bot, digest) is a 409.
 */
export async function recordGateResult(
  database: Database,
  ctx: GateContext,
  input: RecordGateInput,
): Promise<{ readonly result: GateResultView; readonly replayed: boolean }> {
  return database.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`qualification-gate:${input.submissionId}:${input.gateBotId}:${input.gateBotDigest}`]);
    const submission = await tx.query('SELECT id FROM submissions WHERE id = $1', [input.submissionId]);
    if (submission.rows.length === 0) throw new GateError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found');

    const existing = await tx.query<GateRow>(
      `SELECT ${gateColumns} FROM submission_gate_results WHERE submission_id = $1 AND gate_bot_id = $2 AND gate_bot_digest = $3`,
      [input.submissionId, input.gateBotId, input.gateBotDigest],
    );
    const stored = existing.rows[0];
    if (stored !== undefined) {
      if (stored.game1_match_id !== input.game1MatchId || stored.game2_match_id !== input.game2MatchId) {
        throw new GateError(409, 'GATE_RESULT_CONFLICT', 'A gate result with different matches already exists');
      }
      return { result: view(stored), replayed: true };
    }

    const game1 = await loadGame(tx, input, input.game1MatchId);
    const game2 = await loadGame(tx, input, input.game2MatchId);
    const evaluation = evaluateGate(game1, game2);
    if (evaluation.state === 'PENDING') throw new GateError(409, 'GATE_PENDING', 'Both gate games must be finalized before a result exists');

    const id = randomUUID();
    const inserted = await tx.query<GateRow>(
      `INSERT INTO submission_gate_results (id, submission_id, gate_bot_id, gate_bot_digest, game1_match_id, game2_match_id,
         game1_points, game2_points, points, outcome, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${gateColumns}`,
      [id, input.submissionId, input.gateBotId, input.gateBotDigest, input.game1MatchId, input.game2MatchId,
        evaluation.game1Points, evaluation.game2Points, evaluation.points, evaluation.outcome, ctx.reason],
    );
    const row = inserted.rows[0]!;
    await tx.query(
      `INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, correlation_id, details)
       VALUES ($1, $2, 'qualification_gate.record', 'submission', $3, $4, $5, $6::jsonb)`,
      [randomUUID(), ctx.actorAccountId, input.submissionId, ctx.reason, ctx.correlationId,
        JSON.stringify({ before: {}, after: { gateResultId: id, outcome: evaluation.outcome, points: evaluation.points } })],
    );
    return { result: view(row), replayed: false };
  });
}

export async function listGateResults(database: Database, submissionId: string): Promise<{ readonly rankable: boolean; readonly results: readonly GateResultView[] } | null> {
  const submission = await database.query('SELECT id FROM submissions WHERE id = $1', [submissionId]);
  if (submission.rows.length === 0) return null;
  const rows = await database.query<GateRow>(
    `SELECT ${gateColumns} FROM submission_gate_results WHERE submission_id = $1 ORDER BY created_at, id`, [submissionId],
  );
  const results = rows.rows.map(view);
  return { rankable: results.some(({ outcome }) => outcome === 'PASS'), results };
}
