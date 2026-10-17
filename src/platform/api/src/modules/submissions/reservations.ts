import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/client.ts';

export class SubmissionReservationError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SubmissionReservationError';
    this.status = status;
    this.code = code;
  }
}

export interface RoundSchedule {
  readonly submissionOpensAt: Date;
  readonly submissionDeadlineAt: Date;
  readonly graceEndsAt: Date;
}

export interface OpenSubmissionRound {
  readonly id: string;
  readonly tournamentStage: string;
  readonly roundNumber: number;
  readonly ruleSetId: string | null;
  readonly schedule: RoundSchedule;
}

export interface SubmissionReservationRow {
  readonly id: string;
  readonly team_id: string;
  readonly qualification_round_id: string;
  readonly archive_sha256: string;
  readonly reserved_at: Date;
  readonly grace_ends_at: Date;
  readonly status: 'RESERVED' | 'COMPLETED';
  readonly submission_id: string | null;
  readonly completed_at: Date | null;
}

export interface ReservationData {
  readonly id: string;
  readonly archiveSha256: string;
  readonly roundId: string;
  readonly reservedAt: string;
  readonly graceEndsAt: string;
  readonly status: 'RESERVED' | 'COMPLETED';
}

const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReservationRow(row: SubmissionReservationRow): ReservationData {
  return {
    id: row.id,
    archiveSha256: row.archive_sha256,
    roundId: row.qualification_round_id,
    reservedAt: row.reserved_at instanceof Date ? row.reserved_at.toISOString() : new Date(row.reserved_at).toISOString(),
    graceEndsAt: row.grace_ends_at instanceof Date ? row.grace_ends_at.toISOString() : new Date(row.grace_ends_at).toISOString(),
    status: row.status,
  };
}

export async function getOpenSubmissionRound(db: Database, _now?: Date): Promise<OpenSubmissionRound | null> {
  const result = await db.query<{
    readonly id: string;
    readonly tournament_stage: string;
    readonly round_number: number;
    readonly status: string;
    readonly rule_set_id: string | null;
    readonly rules: unknown;
  }>(
    `SELECT qr.id, qr.tournament_stage, qr.round_number, qr.status, qr.rule_set_id, rrs.rules
     FROM qualification_rounds qr
     LEFT JOIN round_rule_sets rrs ON qr.rule_set_id = rrs.id
     WHERE qr.status = 'SUBMISSION_OPEN'
     LIMIT 1`
  );

  if (result.rows.length === 0 || !result.rows[0]) return null;
  const row = result.rows[0];
  const rules = row.rules as Record<string, unknown> | null | undefined;
  const schedule = rules?.schedule as Record<string, unknown> | null | undefined;
  if (!schedule) return null;

  const opensAt = typeof schedule.submissionOpensAt === 'string' ? new Date(schedule.submissionOpensAt) : null;
  const deadlineAt = typeof schedule.submissionDeadlineAt === 'string' ? new Date(schedule.submissionDeadlineAt) : null;
  const graceAt = typeof schedule.graceEndsAt === 'string' ? new Date(schedule.graceEndsAt) : null;

  if (!opensAt || isNaN(opensAt.getTime()) || !deadlineAt || isNaN(deadlineAt.getTime()) || !graceAt || isNaN(graceAt.getTime())) {
    return null;
  }

  return {
    id: row.id,
    tournamentStage: row.tournament_stage,
    roundNumber: row.round_number,
    ruleSetId: row.rule_set_id,
    schedule: {
      submissionOpensAt: opensAt,
      submissionDeadlineAt: deadlineAt,
      graceEndsAt: graceAt,
    },
  };
}

export interface CreateReservationInput {
  readonly teamId: string;
  readonly archiveSha256: string;
  readonly now?: Date | undefined;
}

export interface CreateReservationResult {
  readonly statusCode: 200 | 201;
  readonly data: ReservationData;
}

export async function createReservation(
  db: Database,
  input: CreateReservationInput
): Promise<CreateReservationResult> {
  if (!SHA256_RE.test(input.archiveSha256)) {
    throw new SubmissionReservationError(400, 'INVALID_ARCHIVE_SHA256', 'Invalid archive SHA-256 format');
  }

  const now = input.now ?? new Date();
  const round = await getOpenSubmissionRound(db, now);
  if (!round || now < round.schedule.submissionOpensAt) {
    throw new SubmissionReservationError(409, 'SUBMISSION_NOT_OPEN', 'Submission round is not open');
  }

  if (now > round.schedule.submissionDeadlineAt) {
    throw new SubmissionReservationError(403, 'SUBMISSION_DEADLINE_PASSED', 'Submission deadline has passed');
  }

  const id = randomUUID();
  const insertResult = await db.query<SubmissionReservationRow>(
    `INSERT INTO submission_reservations (
       id, team_id, qualification_round_id, archive_sha256, reserved_at, grace_ends_at, status
     ) VALUES ($1, $2, $3, $4, $5, $6, 'RESERVED')
     ON CONFLICT (team_id, qualification_round_id, archive_sha256) DO NOTHING
     RETURNING id, team_id, qualification_round_id, archive_sha256, reserved_at, grace_ends_at, status, submission_id, completed_at`,
    [id, input.teamId, round.id, input.archiveSha256, now, round.schedule.graceEndsAt]
  );

  const inserted = insertResult.rows[0];
  if (inserted) {
    return {
      statusCode: 201,
      data: parseReservationRow(inserted),
    };
  }

  const existingResult = await db.query<SubmissionReservationRow>(
    `SELECT id, team_id, qualification_round_id, archive_sha256, reserved_at, grace_ends_at, status, submission_id, completed_at
     FROM submission_reservations
     WHERE team_id = $1 AND qualification_round_id = $2 AND archive_sha256 = $3`,
    [input.teamId, round.id, input.archiveSha256]
  );

  const existing = existingResult.rows[0];
  if (!existing) {
    throw new Error('Failed to find existing reservation after conflict');
  }

  return {
    statusCode: 200,
    data: parseReservationRow(existing),
  };
}

export async function getCurrentReservation(
  db: Database,
  teamId: string,
  now?: Date
): Promise<ReservationData | null> {
  const currentNow = now ?? new Date();
  const round = await getOpenSubmissionRound(db, currentNow);
  if (!round) return null;

  const result = await db.query<SubmissionReservationRow>(
    `SELECT id, team_id, qualification_round_id, archive_sha256, reserved_at, grace_ends_at, status, submission_id, completed_at
     FROM submission_reservations
     WHERE team_id = $1 AND qualification_round_id = $2
     ORDER BY reserved_at DESC, seq DESC
     LIMIT 1`,
    [teamId, round.id]
  );

  const row = result.rows[0];
  if (!row) return null;
  return parseReservationRow(row);
}

export interface ResolveUploadInput {
  readonly teamId: string;
  readonly reservationId?: string | null | undefined;
  readonly now?: Date | undefined;
}

export interface ResolveUploadResult {
  readonly round: OpenSubmissionRound;
  readonly reservation: SubmissionReservationRow | null;
}

export async function resolveUpload(
  db: Database,
  input: ResolveUploadInput
): Promise<ResolveUploadResult> {
  const now = input.now ?? new Date();
  const round = await getOpenSubmissionRound(db, now);

  if (!round || now < round.schedule.submissionOpensAt) {
    throw new SubmissionReservationError(409, 'SUBMISSION_NOT_OPEN', 'Submission round is not open');
  }

  if (now > round.schedule.graceEndsAt) {
    throw new SubmissionReservationError(403, 'SUBMISSION_CLOSED', 'Submission window has closed');
  }

  const reservationId = input.reservationId?.trim() || null;

  if (now > round.schedule.submissionDeadlineAt && !reservationId) {
    throw new SubmissionReservationError(403, 'RESERVATION_REQUIRED', 'Reservation required for upload during grace period');
  }

  let reservationRow: SubmissionReservationRow | null = null;

  if (reservationId) {
    if (!UUID_RE.test(reservationId)) {
      throw new SubmissionReservationError(403, 'RESERVATION_INVALID', 'Invalid reservation');
    }

    const resResult = await db.query<SubmissionReservationRow>(
      `SELECT id, team_id, qualification_round_id, archive_sha256, reserved_at, grace_ends_at, status, submission_id, completed_at
       FROM submission_reservations
       WHERE id = $1`,
      [reservationId]
    );

    const row = resResult.rows[0];
    if (!row) {
      throw new SubmissionReservationError(403, 'RESERVATION_INVALID', 'Reservation not found');
    }

    if (row.team_id !== input.teamId || row.qualification_round_id !== round.id) {
      throw new SubmissionReservationError(403, 'RESERVATION_INVALID', 'Reservation does not match team or round');
    }

    reservationRow = row;
  }

  return {
    round,
    reservation: reservationRow,
  };
}
