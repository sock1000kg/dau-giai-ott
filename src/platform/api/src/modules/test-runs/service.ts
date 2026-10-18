import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/client.ts';
import { QUEUE_PRIORITY, type MatchJobV1 } from '@ott/job-contract';

export type TestRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type TestRunOpponentType = 'BTC_REFERENCE' | 'OWN_SUBMISSION';

export class TestRunError extends Error {
  public readonly status: number;
  public readonly code: string;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TestRunError';
    this.status = status;
    this.code = code;
  }
}

export interface TestRunRecord {
  readonly id: string;
  readonly teamId: string;
  readonly roundId: string | null;
  readonly submissionId: string;
  readonly opponentType: TestRunOpponentType;
  readonly opponentSubmissionId: string | null;
  readonly opponentReferenceBot: string | null;
  readonly status: TestRunStatus;
  readonly quotaConsumed: boolean;
  readonly mapChecksum: string;
  readonly seed: string;
  readonly result: Record<string, unknown> | null;
  readonly replayKey: string | null;
  readonly stderrX: string | null;
  readonly stderrO: string | null;
  readonly failureReason: string | null;
  readonly isInfraFailure: boolean;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface CreateTestRunInput {
  readonly teamId: string;
  readonly submissionId: string;
  readonly opponentType: TestRunOpponentType;
  readonly opponentSubmissionId?: string | undefined;
  readonly opponentReferenceBot?: string | undefined;
  readonly roundId?: string | undefined;
  readonly mapChecksum?: string | undefined;
  readonly now?: Date | undefined;
}

export interface CompleteTestRunInput {
  readonly testRunId: string;
  readonly result: Record<string, unknown>;
  readonly replayKey?: string | undefined;
  readonly stderrX?: string | undefined;
  readonly stderrO?: string | undefined;
}

export interface FailTestRunInput {
  readonly testRunId: string;
  readonly failureReason: string;
  readonly isInfraFailure: boolean;
}

export interface TestRunEnqueuer {
  enqueue(
    job: MatchJobV1,
    options?: { readonly category?: string; readonly priority?: number; readonly generation?: number },
  ): Promise<unknown>;
}

/**
 * Calculates start of day in UTC for daily quota resets.
 */
export function getUtcStartOfDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Gets count of consumed test runs for team today.
 */
export async function getDailyConsumedQuota(
  db: Database,
  teamId: string,
  now: Date = new Date(),
): Promise<number> {
  const startOfDay = getUtcStartOfDay(now);
  const result = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM test_runs
     WHERE team_id = $1
       AND created_at >= $2
       AND quota_consumed = TRUE
       AND status <> 'CANCELLED'`,
    [teamId, startOfDay],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Resolves the daily quota limit for a round or defaults to 5.
 */
export async function getRoundTestRunQuota(
  db: Database,
  roundId?: string,
): Promise<number> {
  if (!roundId) return 5;

  const result = await db.query<{ rules: { testRun?: { quotaPerTeamPerDay?: number } } }>(
    `SELECT rrs.rules
     FROM qualification_rounds qr
     JOIN round_rule_sets rrs ON rrs.id = qr.rule_set_id
     WHERE qr.id = $1`,
    [roundId],
  );

  return result.rows[0]?.rules?.testRun?.quotaPerTeamPerDay ?? 5;
}

/**
 * Creates a new test run with quota verification, opponent policy validation,
 * and low-priority queue scheduling.
 */
export async function createTestRun(
  db: Database,
  enqueuer: TestRunEnqueuer | undefined,
  input: CreateTestRunInput,
): Promise<TestRunRecord> {
  const now = input.now ?? new Date();

  // 1. Quota check
  const maxQuota = await getRoundTestRunQuota(db, input.roundId);
  const consumedQuota = await getDailyConsumedQuota(db, input.teamId, now);

  if (consumedQuota >= maxQuota) {
    throw new TestRunError(
      429,
      'TEST_RUN_QUOTA_EXCEEDED',
      `Daily test-run quota of ${maxQuota} exceeded for team`,
    );
  }

  // 2. Validate primary submission ownership & status
  const subRes = await db.query<{ id: string; team_id: string; status: string }>(
    `SELECT id, team_id, status FROM submissions WHERE id = $1`,
    [input.submissionId],
  );
  const submission = subRes.rows[0];

  if (!submission) {
    throw new TestRunError(404, 'SUBMISSION_NOT_FOUND', 'Submission not found');
  }
  if (submission.team_id !== input.teamId) {
    throw new TestRunError(403, 'SUBMISSION_NOT_OWNED', 'Submission does not belong to team');
  }
  if (submission.status === 'INVALID') {
    throw new TestRunError(400, 'SUBMISSION_INVALID', 'Cannot run test with INVALID submission');
  }

  // 3. Validate Opponent Policy
  let opponentReferenceBot: string | null = null;
  let opponentSubmissionId: string | null = null;

  if (input.opponentType === 'BTC_REFERENCE') {
    opponentReferenceBot = input.opponentReferenceBot ?? 'FIRST_LEGAL';
  } else if (input.opponentType === 'OWN_SUBMISSION') {
    if (!input.opponentSubmissionId) {
      throw new TestRunError(
        400,
        'INVALID_TEST_RUN_OPPONENT',
        'opponentSubmissionId is required when opponentType is OWN_SUBMISSION',
      );
    }
    const oppSubRes = await db.query<{ id: string; team_id: string; status: string }>(
      `SELECT id, team_id, status FROM submissions WHERE id = $1`,
      [input.opponentSubmissionId],
    );
    const oppSubmission = oppSubRes.rows[0];

    if (!oppSubmission) {
      throw new TestRunError(404, 'OPPONENT_SUBMISSION_NOT_FOUND', 'Opponent submission not found');
    }
    // Strict opponent policy: must be SAME team!
    if (oppSubmission.team_id !== input.teamId) {
      throw new TestRunError(
        403,
        'INVALID_TEST_RUN_OPPONENT',
        'Test run cannot face submissions belonging to other teams',
      );
    }
    if (oppSubmission.status === 'INVALID') {
      throw new TestRunError(400, 'OPPONENT_SUBMISSION_INVALID', 'Opponent submission is INVALID');
    }
    opponentSubmissionId = oppSubmission.id;
  } else {
    throw new TestRunError(400, 'INVALID_TEST_RUN_OPPONENT', 'Unsupported opponentType');
  }

  // 4. Create record
  const testRunId = randomUUID();
  const mapChecksum = input.mapChecksum ?? 'test_map_default';
  const seed = randomUUID();

  const insertRes = await db.query<TestRunRecord>(
    `INSERT INTO test_runs (
       id, team_id, round_id, submission_id, opponent_type,
       opponent_submission_id, opponent_reference_bot, status,
       quota_consumed, map_checksum, seed, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'QUEUED', TRUE, $8, $9, $10)
     RETURNING *`,
    [
      testRunId,
      input.teamId,
      input.roundId ?? null,
      input.submissionId,
      input.opponentType,
      opponentSubmissionId,
      opponentReferenceBot,
      mapChecksum,
      seed,
      now,
    ],
  );

  const testRun = insertRes.rows[0]!;

  // 5. Enqueue low-priority job if enqueuer available
  if (enqueuer) {
    await enqueuer.enqueue(
      {
        schemaVersion: 'ott.match-job.v1',
        matchId: testRunId,
        idempotencyKey: testRunId,
        policyVersion: 'P2_BASELINE_V1',
        x: {
          submissionId: input.submissionId,
          archiveSha256: 'sha256:' + 'a'.repeat(64),
          manifestDigest: 'sha256:' + 'a'.repeat(64),
          configDigest: 'sha256:' + 'a'.repeat(64),
          policyVersion: 'P2_BASELINE_V1',
        },
        o: {
          submissionId: opponentSubmissionId ?? input.submissionId,
          archiveSha256: 'sha256:' + 'b'.repeat(64),
          manifestDigest: 'sha256:' + 'b'.repeat(64),
          configDigest: 'sha256:' + 'b'.repeat(64),
          policyVersion: 'P2_BASELINE_V1',
        },
      },
      {
        category: 'test-run',
        priority: QUEUE_PRIORITY.TEST_RUN,
      },
    );
  }

  return mapTestRunRow(insertRes.rows[0] as unknown as Record<string, unknown>);
}

function mapTestRunRow(row: Record<string, unknown>): TestRunRecord {
  return {
    id: String(row.id),
    teamId: String(row.team_id ?? row.teamId),
    roundId: (row.round_id ?? row.roundId) ? String(row.round_id ?? row.roundId) : null,
    submissionId: String(row.submission_id ?? row.submissionId),
    opponentType: (row.opponent_type ?? row.opponentType) as TestRunOpponentType,
    opponentSubmissionId: (row.opponent_submission_id ?? row.opponentSubmissionId)
      ? String(row.opponent_submission_id ?? row.opponentSubmissionId)
      : null,
    opponentReferenceBot: (row.opponent_reference_bot ?? row.opponentReferenceBot)
      ? String(row.opponent_reference_bot ?? row.opponentReferenceBot)
      : null,
    status: (row.status as TestRunStatus) ?? 'QUEUED',
    quotaConsumed: Boolean(row.quota_consumed ?? row.quotaConsumed ?? true),
    mapChecksum: String(row.map_checksum ?? row.mapChecksum ?? ''),
    seed: String(row.seed ?? ''),
    result: (row.result as Record<string, unknown>) ?? null,
    replayKey: (row.replay_key ?? row.replayKey) ? String(row.replay_key ?? row.replayKey) : null,
    stderrX: (row.stderr_x ?? row.stderrX) ? String(row.stderr_x ?? row.stderrX) : null,
    stderrO: (row.stderr_o ?? row.stderrO) ? String(row.stderr_o ?? row.stderrO) : null,
    failureReason: (row.failure_reason ?? row.failureReason) ? String(row.failure_reason ?? row.failureReason) : null,
    isInfraFailure: Boolean(row.is_infra_failure ?? row.isInfraFailure ?? false),
    createdAt: (row.created_at ?? row.createdAt) instanceof Date
      ? ((row.created_at ?? row.createdAt) as Date)
      : new Date(String(row.created_at ?? row.createdAt ?? Date.now())),
    startedAt: (row.started_at ?? row.startedAt) ? new Date(String(row.started_at ?? row.startedAt)) : null,
    finishedAt: (row.finished_at ?? row.finishedAt) ? new Date(String(row.finished_at ?? row.finishedAt)) : null,
  };
}

/**
 * Gets test run by ID with strict RBAC: only owner team or BTC_ADMIN can read.
 */
export async function getTestRunById(
  db: Database,
  testRunId: string,
  caller: { role: string; teamId?: string | undefined },
): Promise<TestRunRecord> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM test_runs WHERE id = $1`,
    [testRunId],
  );
  const raw = result.rows[0];

  if (!raw) {
    throw new TestRunError(404, 'TEST_RUN_NOT_FOUND', 'Test run not found');
  }

  const testRun = mapTestRunRow(raw);

  // RBAC: BTC_ADMIN can view all; TEAM_ACCOUNT can only view its own
  if (caller.role === 'TEAM_ACCOUNT' && caller.teamId !== testRun.teamId) {
    throw new TestRunError(404, 'TEST_RUN_NOT_FOUND', 'Test run not found');
  }

  return testRun;
}

/**
 * Lists test runs for a team.
 */
export async function listTestRuns(
  db: Database,
  caller: { role: string; teamId?: string | undefined },
): Promise<readonly TestRunRecord[]> {
  if (caller.role === 'BTC_ADMIN') {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM test_runs ORDER BY created_at DESC LIMIT 100`,
    );
    return res.rows.map(mapTestRunRow);
  }

  if (caller.role === 'TEAM_ACCOUNT' && caller.teamId) {
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM test_runs WHERE team_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [caller.teamId],
    );
    return res.rows.map(mapTestRunRow);
  }

  return [];
}

/**
 * Refunds quota for a test run when an infrastructure failure occurs.
 */
export async function refundTestRunQuota(
  db: Database,
  testRunId: string,
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE test_runs
     SET quota_consumed = FALSE,
         is_infra_failure = TRUE,
         failure_reason = $1,
         status = 'FAILED',
         finished_at = now()
     WHERE id = $2`,
    [reason, testRunId],
  );
}

/**
 * Records successful completion of a test run.
 * Truncates stderr to 4 KiB to prevent oversized records.
 */
export async function completeTestRun(
  db: Database,
  input: CompleteTestRunInput,
): Promise<void> {
  const truncate = (val?: string) => (val && val.length > 4096 ? val.slice(0, 4096) + '... [truncated]' : val ?? null);

  await db.query(
    `UPDATE test_runs
     SET status = 'COMPLETED',
         result = $1,
         replay_key = $2,
         stderr_x = $3,
         stderr_o = $4,
         finished_at = now()
     WHERE id = $5`,
    [
      JSON.stringify(input.result),
      input.replayKey ?? null,
      truncate(input.stderrX),
      truncate(input.stderrO),
      input.testRunId,
    ],
  );
}

/**
 * Records failure of a test run. Automatically refunds quota if isInfraFailure is true.
 */
export async function failTestRun(
  db: Database,
  input: FailTestRunInput,
): Promise<void> {
  await db.query(
    `UPDATE test_runs
     SET status = 'FAILED',
         failure_reason = $1,
         is_infra_failure = $2,
         quota_consumed = CASE WHEN $2 = TRUE THEN FALSE ELSE quota_consumed END,
         finished_at = now()
     WHERE id = $3`,
    [input.failureReason, input.isInfraFailure, input.testRunId],
  );
}
