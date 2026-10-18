import { createHash, randomUUID } from 'node:crypto';
import { validateMatchJob, type MatchJobV1 } from '@ott/job-contract';
import type { Database } from '../../db/client.ts';
import { createPairingPlan, pairKey, type PairingParticipant } from './pairing.ts';
import { scoreQualificationSeries, type SeriesMatchInput } from '../series/scoring.ts';
import { applyRoundRatings } from '../ratings/service.ts';

const INITIAL_RATING_BAND = 200;
const RATING_BAND_STEP = 100;
const RECENT_ROUNDS = 3;

interface SubmissionRow extends PairingParticipant {
  readonly archive_sha256: string;
  readonly manifest_digest: string;
  readonly config_digest: string;
  readonly policy_version: string;
}

interface RoundRow {
  readonly id: string;
  readonly request_hash: string;
}

export interface ScheduleRoundInput {
  readonly tournamentStage: string;
  readonly idempotencyKey: string;
}

export interface ScheduledRound {
  readonly roundId: string;
  readonly seriesIds: readonly string[];
  readonly matchIds: readonly string[];
  readonly byeTeamId: string | null;
  readonly replayed: boolean;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requestHash(input: ScheduleRoundInput): string {
  return sha256(JSON.stringify({ tournamentStage: input.tournamentStage }));
}

function validateInput(input: ScheduleRoundInput): void {
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(input.tournamentStage)) throw new Error('TOURNAMENT_STAGE_INVALID');
  if (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128) throw new Error('IDEMPOTENCY_KEY_INVALID');
}

async function existingRound(transaction: Database, input: ScheduleRoundInput, expectedHash: string): Promise<ScheduledRound | null> {
  const found = await transaction.query<RoundRow>(
    'SELECT id, request_hash FROM rounds WHERE tournament_stage = $1 AND idempotency_key = $2',
    [input.tournamentStage, input.idempotencyKey],
  );
  const round = found.rows[0];
  if (round === undefined) return null;
  if (round.request_hash !== expectedHash) throw new Error('SCHEDULE_IDEMPOTENCY_CONFLICT');
  const series = await transaction.query<{ readonly id: string }>('SELECT id FROM series WHERE round_id = $1 ORDER BY id', [round.id]);
  const matches = await transaction.query<{ readonly id: string }>('SELECT id FROM matches WHERE series_id IN (SELECT id FROM series WHERE round_id = $1) ORDER BY id', [round.id]);
  const byes = await transaction.query<{ readonly team_id: string }>("SELECT team_id FROM round_participants WHERE round_id = $1 AND assignment = 'BYE'", [round.id]);
  return {
    roundId: round.id,
    seriesIds: series.rows.map(({ id }) => id).sort(),
    matchIds: matches.rows.map(({ id }) => id).sort(),
    byeTeamId: byes.rows[0]?.team_id ?? null,
    replayed: true,
  };
}

async function activeRoster(transaction: Database, stage: string): Promise<SubmissionRow[]> {
  const result = await transaction.query<SubmissionRow>(`
    SELECT t.id AS "teamId", s.id AS "submissionId",
      COALESCE(latest.rating_after, 1000)::integer AS rating,
      s.archive_sha256, s.oci_manifest_digest AS manifest_digest,
      s.oci_config_digest AS config_digest, s.policy_version
    FROM teams t
    JOIN submissions s ON s.team_id = t.id AND s.tournament_stage = $1 AND s.status = 'ACTIVE'
    LEFT JOIN LATERAL (
      SELECT ledger.rating_after
      FROM rating_ledger ledger
      JOIN series prior_series ON prior_series.id = ledger.series_id
      WHERE ledger.team_id = t.id
      ORDER BY prior_series.created_at DESC, ledger.created_at DESC, ledger.id DESC
      LIMIT 1
    ) latest ON TRUE
    ORDER BY t.id`, [stage]);
  return result.rows;
}

async function recentPairHistory(transaction: Database, stage: string): Promise<{ pairs: Set<string>; byes: Set<string> }> {
  const recentRounds = await transaction.query<{ readonly id: string }>(
    'SELECT id FROM rounds WHERE tournament_stage = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [stage, RECENT_ROUNDS],
  );
  const roundIds = recentRounds.rows.map(({ id }) => id);
  if (roundIds.length === 0) return { pairs: new Set(), byes: new Set() };
  const series = await transaction.query<{ readonly team_a_id: string; readonly team_b_id: string }>(
    'SELECT team_a_id, team_b_id FROM series WHERE round_id = ANY($1::uuid[])', [roundIds]);
  const byes = await transaction.query<{ readonly team_id: string }>(
    "SELECT team_id FROM round_participants WHERE round_id = ANY($1::uuid[]) AND assignment = 'BYE'", [roundIds]);
  return {
    pairs: new Set(series.rows.map(({ team_a_id, team_b_id }) => pairKey(team_a_id, team_b_id))),
    byes: new Set(byes.rows.map(({ team_id }) => team_id)),
  };
}

async function assertPreviousRoundRatingsApplied(transaction: Database, stage: string): Promise<void> {
  const pending = await transaction.query<{ readonly round_id: string }>(`
    SELECT r.id AS round_id
    FROM rounds r
    JOIN series s ON s.round_id = r.id AND s.status = 'FINALIZED'
    WHERE r.tournament_stage = $1 AND r.status = 'FINALIZED'
      AND (NOT EXISTS (SELECT 1 FROM rating_ledger l WHERE l.series_id = s.id AND l.team_id = s.team_a_id)
        OR NOT EXISTS (SELECT 1 FROM rating_ledger l WHERE l.series_id = s.id AND l.team_id = s.team_b_id))
    LIMIT 1`, [stage]);
  if (pending.rows.length > 0) throw new Error('ROUND_RATING_PENDING');
}

async function assertNoRoundInProgress(transaction: Database, stage: string): Promise<void> {
  const running = await transaction.query<{ readonly id: string }>(
    "SELECT id FROM rounds WHERE tournament_stage = $1 AND status = 'SCHEDULED' LIMIT 1", [stage],
  );
  if (running.rows.length > 0) throw new Error('ROUND_IN_PROGRESS');
}

function jobFor(matchId: string, policyVersion: string, x: SubmissionRow, o: SubmissionRow): MatchJobV1 {
  const job: MatchJobV1 = {
    schemaVersion: 'ott.match-job.v1',
    matchId,
    idempotencyKey: matchId,
    policyVersion,
    x: { submissionId: x.submissionId, archiveSha256: x.archive_sha256, manifestDigest: x.manifest_digest, configDigest: x.config_digest, policyVersion: x.policy_version },
    o: { submissionId: o.submissionId, archiveSha256: o.archive_sha256, manifestDigest: o.manifest_digest, configDigest: o.config_digest, policyVersion: o.policy_version },
  };
  if (!validateMatchJob(job).ok) throw new Error('MATCH_JOB_INVALID');
  return job;
}

/** Create a frozen, retry-safe qualification round and queue outbox in one transaction. */
export async function scheduleRound(database: Database, input: ScheduleRoundInput): Promise<ScheduledRound> {
  validateInput(input);
  const hash = requestHash(input);
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`schedule:${input.tournamentStage}`]);
    const replay = await existingRound(transaction, input, hash);
    if (replay !== null) return replay;
    await assertNoRoundInProgress(transaction, input.tournamentStage);
    await assertPreviousRoundRatingsApplied(transaction, input.tournamentStage);

    const roster = await activeRoster(transaction, input.tournamentStage);
    if (roster.length < 2) throw new Error('SCHEDULING_INSUFFICIENT_TEAMS');
    if (new Set(roster.map(({ policy_version }) => policy_version)).size !== 1) throw new Error('SCHEDULING_POLICY_MISMATCH');
    const history = await recentPairHistory(transaction, input.tournamentStage);
    const plan = createPairingPlan(roster, {
      previousPairs: history.pairs,
      previousByes: history.byes,
      initialRatingBand: INITIAL_RATING_BAND,
      ratingBandStep: RATING_BAND_STEP,
    });
    const roundId = randomUUID();
    const scheduleSeed = randomUUID();
    const snapshot = roster.map(({ teamId, submissionId, rating }) => ({ teamId, submissionId, rating }));
    await transaction.query(
      "INSERT INTO rounds (id, tournament_stage, idempotency_key, request_hash, schedule_seed, rating_snapshot) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
      [roundId, input.tournamentStage, input.idempotencyKey, hash, scheduleSeed, JSON.stringify(snapshot)],
    );
    const bySubmission = new Map(roster.map((entry) => [entry.submissionId, entry]));
    const seriesRows: { readonly id: string; readonly teamAId: string; readonly teamBId: string }[] = [];
    const participantRows: { readonly seriesId: string; readonly teamId: string; readonly slot: 'A' | 'B' }[] = [];
    const matchRows: {
      readonly id: string;
      readonly seriesId: string;
      readonly xSubmissionId: string;
      readonly oSubmissionId: string;
      readonly seed: string;
      readonly policyVersion: string;
      readonly gameNumber: 1 | 2;
      readonly job: MatchJobV1;
    }[] = [];
    for (const pairing of plan.pairings) {
      const teamA = bySubmission.get(pairing.x.submissionId)!;
      const teamB = bySubmission.get(pairing.o.submissionId)!;
      const seriesId = randomUUID();
      seriesRows.push({ id: seriesId, teamAId: teamA.teamId, teamBId: teamB.teamId });
      participantRows.push({ seriesId, teamId: teamA.teamId, slot: 'A' }, { seriesId, teamId: teamB.teamId, slot: 'B' });
      for (const gameNumber of [1, 2] as const) {
        const matchId = randomUUID();
        const x = gameNumber === 1 ? teamA : teamB;
        const o = gameNumber === 1 ? teamB : teamA;
        const seed = sha256(`${scheduleSeed}:${seriesId}:${gameNumber}`);
        const policyVersion = x.policy_version;
        const job = jobFor(matchId, policyVersion, x, o);
        matchRows.push({
          id: matchId,
          seriesId,
          xSubmissionId: x.submissionId,
          oSubmissionId: o.submissionId,
          seed,
          policyVersion,
          gameNumber,
          job,
        });
      }
    }
    await transaction.query(`
      INSERT INTO series (id, tournament_stage, status, round_id, team_a_id, team_b_id, format)
      SELECT pair.id, $2, 'SCHEDULED', $3, pair.team_a_id, pair.team_b_id, 'BO2'
      FROM unnest($1::uuid[], $4::uuid[], $5::uuid[]) AS pair(id, team_a_id, team_b_id)`,
    [seriesRows.map(({ id }) => id), input.tournamentStage, roundId, seriesRows.map(({ teamAId }) => teamAId), seriesRows.map(({ teamBId }) => teamBId)]);
    const assignmentRows = [...participantRows, ...(plan.bye === null ? [] : [{ seriesId: null, teamId: plan.bye.teamId, slot: null }])];
    await transaction.query(`
      INSERT INTO round_participants (round_id, series_id, team_id, assignment, series_slot)
      SELECT $1, assignment.series_id, assignment.team_id,
        CASE WHEN assignment.series_id IS NULL THEN 'BYE' ELSE 'PAIRED' END,
        assignment.series_slot
      FROM unnest($2::uuid[], $3::uuid[], $4::char[]) AS assignment(series_id, team_id, series_slot)`,
    [roundId, assignmentRows.map(({ seriesId }) => seriesId), assignmentRows.map(({ teamId }) => teamId), assignmentRows.map(({ slot }) => slot)]);
    await transaction.query(`
      INSERT INTO matches (id, series_id, x_submission_id, o_submission_id, status, seed, policy_version, game_number)
      SELECT match.id, match.series_id, match.x_submission_id, match.o_submission_id, 'SCHEDULED', match.seed, match.policy_version, match.game_number
      FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::smallint[])
        AS match(id, series_id, x_submission_id, o_submission_id, seed, policy_version, game_number)`,
    [
      matchRows.map(({ id }) => id),
      matchRows.map(({ seriesId }) => seriesId),
      matchRows.map(({ xSubmissionId }) => xSubmissionId),
      matchRows.map(({ oSubmissionId }) => oSubmissionId),
      matchRows.map(({ seed }) => seed),
      matchRows.map(({ policyVersion }) => policyVersion),
      matchRows.map(({ gameNumber }) => gameNumber),
    ]);
    await transaction.query(`
      INSERT INTO match_outbox (match_id, event_type, payload)
      SELECT outbox.match_id, 'MATCH_SCHEDULED', outbox.payload
      FROM unnest($1::uuid[], $2::jsonb[]) AS outbox(match_id, payload)`,
    [matchRows.map(({ id }) => id), matchRows.map(({ job }) => JSON.stringify(job))]);
    return {
      roundId,
      seriesIds: seriesRows.map(({ id }) => id).sort(),
      matchIds: matchRows.map(({ id }) => id).sort(),
      byeTeamId: plan.bye?.teamId ?? null,
      replayed: false,
    };
  });
}

export interface MatchJobEnqueuer {
  enqueue(job: MatchJobV1, options?: { readonly generation?: number }): Promise<unknown>;
}

/** Queue publication can be retried safely because the DB outbox and BullMQ key are stable. */
export async function dispatchScheduledMatches(database: Database, enqueuer: MatchJobEnqueuer, limit = 100): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('OUTBOX_LIMIT_INVALID');
  const pending = await database.query<{ readonly id: string; readonly payload: unknown; readonly generation: number }>(
    "SELECT id, payload, generation FROM match_outbox WHERE event_type IN ('MATCH_SCHEDULED', 'MATCH_RERUN') AND dispatched_at IS NULL ORDER BY created_at, id LIMIT $1", [limit],
  );
  let dispatched = 0;
  for (const row of pending.rows) {
    const validation = validateMatchJob(row.payload);
    if (!validation.ok) throw new Error('SCHEDULED_OUTBOX_PAYLOAD_INVALID');
    if (row.generation > 0) await enqueuer.enqueue(validation.value, { generation: row.generation });
    else await enqueuer.enqueue(validation.value);
    const marked = await database.query(
      "UPDATE match_outbox SET dispatched_at = now() WHERE id = $1 AND dispatched_at IS NULL", [row.id],
    );
    dispatched += marked.rowCount ?? 0;
  }
  return dispatched;
}

export type SeriesSettlement =
  | { readonly state: 'PENDING' }
  | { readonly state: 'CANCELLED'; readonly reason: 'MATCH_CANCELLED' | 'INFRASTRUCTURE_FAILURE' }
  | { readonly state: 'FINALIZED'; readonly teamAScore: number; readonly teamBScore: number; readonly winnerTeamId: string | null };

interface SeriesRow {
  readonly id: string;
  readonly status: string;
  readonly round_id: string;
  readonly team_a_id: string;
  readonly team_b_id: string;
  readonly team_a_score: string | null;
  readonly team_b_score: string | null;
  readonly winner_team_id: string | null;
  readonly cancellation_reason: 'MATCH_CANCELLED' | 'INFRASTRUCTURE_FAILURE' | null;
}

async function finalizeRoundIfTerminal(transaction: Database, roundId: string): Promise<void> {
  await transaction.query(
    "UPDATE rounds r SET status = 'FINALIZED', finalized_at = now() WHERE r.id = $1 AND r.status = 'SCHEDULED' AND NOT EXISTS (SELECT 1 FROM series s WHERE s.round_id = r.id AND s.status NOT IN ('FINALIZED','CANCELLED'))",
    [roundId],
  );
}

/** Settle exactly once only after both games become terminal; cancellation never earns score. */
export async function settleSeries(database: Database, seriesId: string): Promise<SeriesSettlement> {
  const settlement = await database.transaction<SeriesSettlement>(async (transaction) => {
    const selected = await transaction.query<SeriesRow>('SELECT * FROM series WHERE id = $1 FOR UPDATE', [seriesId]);
    const series = selected.rows[0];
    if (series === undefined) throw new Error('SERIES_NOT_FOUND');
    if (series.status === 'FINALIZED') return {
      state: 'FINALIZED', teamAScore: Number(series.team_a_score), teamBScore: Number(series.team_b_score), winnerTeamId: series.winner_team_id,
    };
    if (series.status === 'CANCELLED') return { state: 'CANCELLED', reason: series.cancellation_reason ?? 'MATCH_CANCELLED' };

    const matchRows = await transaction.query<{
      readonly game_number: number;
      readonly status: 'SCHEDULED' | 'RUNNING' | 'FINALIZED' | 'FAILED' | 'CANCELLED';
      readonly winner_side: 'X' | 'O' | null;
      readonly has_result: boolean;
    }>(`
      SELECT m.game_number, m.status, result.winner_side, (result.match_id IS NOT NULL) AS has_result
      FROM matches m LEFT JOIN match_results result ON result.match_id = m.id
      WHERE m.series_id = $1 ORDER BY m.game_number`, [seriesId]);
    if (matchRows.rows.length !== 2 || matchRows.rows.some(({ game_number }, index) => game_number !== index + 1)
      || matchRows.rows.some(({ status, has_result }) => status === 'FINALIZED' && !has_result)) {
      throw new Error('SERIES_MATCH_SET_INVALID');
    }
    const scoreInputs: SeriesMatchInput[] = matchRows.rows.map(({ game_number, status, winner_side }) => {
      const teamASide = game_number === 1 ? 'X' : 'O';
      if (status === 'FINALIZED') return { status: 'FINALIZED', teamASide, winnerSide: winner_side };
      if (status === 'FAILED') return { status: 'FAILED', teamASide };
      if (status === 'CANCELLED') return { status: 'CANCELLED', teamASide };
      if (status === 'RUNNING') return { status: 'RUNNING', teamASide };
      return { status: 'SCHEDULED', teamASide };
    });
    const scored = scoreQualificationSeries(scoreInputs);
    if (scored.state === 'PENDING') return { state: 'PENDING' };
    if (scored.state === 'CANCELLED') {
      await transaction.query(
        "UPDATE series SET status = 'CANCELLED', cancellation_reason = $2, finalized_at = now() WHERE id = $1 AND status = 'SCHEDULED'",
        [seriesId, scored.reason],
      );
      await finalizeRoundIfTerminal(transaction, series.round_id);
      return { state: 'CANCELLED', reason: scored.reason };
    }
    const winnerTeamId = scored.winnerSide === null ? null : scored.winnerSide === 'X' ? series.team_a_id : series.team_b_id;
    await transaction.query(
      "UPDATE series SET status = 'FINALIZED', team_a_score = $2, team_b_score = $3, winner_team_id = $4, finalized_at = now() WHERE id = $1 AND status = 'SCHEDULED'",
      [seriesId, scored.xScore, scored.oScore, winnerTeamId],
    );
    await finalizeRoundIfTerminal(transaction, series.round_id);
    return { state: 'FINALIZED', teamAScore: scored.xScore, teamBScore: scored.oScore, winnerTeamId };
  });
  const round = await database.query<{ readonly round_id: string; readonly status: string }>(
    'SELECT r.id AS round_id, r.status FROM series s JOIN rounds r ON r.id = s.round_id WHERE s.id = $1', [seriesId],
  );
  if (round.rows[0]?.status === 'FINALIZED') await applyRoundRatings(database, round.rows[0].round_id);
  return settlement;
}
