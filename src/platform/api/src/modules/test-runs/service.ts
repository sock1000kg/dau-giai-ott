import { createHash, randomUUID } from 'node:crypto';
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
  readonly replaySha256: string | null;
  readonly finalStateHash: string | null;
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
  readonly idempotencyKey: string;
}

export interface TestRunPolicy {
  readonly roundId: string | null;
  readonly quota: Readonly<{
    limit: number;
    consumed: number;
    reserved: number;
    remaining: number;
    resetsAt: string;
  }>;
  readonly admissionPaused: boolean;
  readonly submissions: readonly Readonly<{ id: string; status: string; createdAt: string }>[];
  readonly opponents: Readonly<{
    referenceBots: readonly Readonly<{ id: string; displayName: string }>[];
    ownSubmissionAllowed: boolean;
  }>;
}

export interface CompleteTestRunInput {
  readonly testRunId: string;
  readonly result: Record<string, unknown>;
  readonly replayKey?: string | undefined;
  readonly stderrX?: string | undefined;
  readonly stderrO?: string | undefined;
  readonly replaySha256?: string | undefined;
  readonly finalStateHash?: string | undefined;
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
  isPaused?(): Promise<boolean>;
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
       AND COALESCE(started_at, created_at) >= $2
       AND quota_consumed = TRUE
       AND status <> 'CANCELLED'`,
    [teamId, startOfDay],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Resolves the daily quota limit for a round or defaults to 2.
 */
export async function getRoundTestRunQuota(
  db: Database,
  roundId?: string,
): Promise<number> {
  if (!roundId) return 2;

  const result = await db.query<{ rules: { testRun?: { quotaPerTeamPerDay?: number } } }>(
    `SELECT rrs.rules
     FROM qualification_rounds qr
     JOIN round_rule_sets rrs ON rrs.id = qr.rule_set_id
     WHERE qr.id = $1`,
    [roundId],
  );

  return result.rows[0]?.rules?.testRun?.quotaPerTeamPerDay ?? 2;
}

interface TestRunPolicyRow {
  readonly id: string;
  readonly status: string;
  readonly paused_at: Date | string | null;
  readonly rules: { testRun?: { quotaPerTeamPerDay?: number } } | null;
}

/** Team portal policy. Quota is the consumed count plus queued reservations for today. */
export async function getTestRunPolicy(
  db: Database,
  teamId: string,
  enqueuer?: Pick<TestRunEnqueuer, 'isPaused'>,
  requestedRoundId?: string,
  now: Date = new Date(),
): Promise<TestRunPolicy> {
  const roundResult = requestedRoundId
    ? await db.query<TestRunPolicyRow>(
      `SELECT qr.id, qr.status, qr.paused_at, rrs.rules
       FROM qualification_rounds qr
       LEFT JOIN round_rule_sets rrs ON rrs.id = qr.rule_set_id
       WHERE qr.id = $1`,
      [requestedRoundId],
    )
    : await db.query<TestRunPolicyRow>(
      `SELECT qr.id, qr.status, qr.paused_at, rrs.rules
       FROM qualification_rounds qr
       LEFT JOIN round_rule_sets rrs ON rrs.id = qr.rule_set_id
       ORDER BY CASE qr.status WHEN 'SUBMISSION_OPEN' THEN 0 ELSE 1 END,
         qr.created_at DESC, qr.id DESC
       LIMIT 1`,
    );
  const round = roundResult.rows[0];
  if (requestedRoundId && !round) {
    throw new TestRunError(404, 'ROUND_NOT_FOUND', 'Round not found');
  }

  const startOfDay = getUtcStartOfDay(now);
  const [quotaResult, submissionsResult, referencesResult, admissionPaused] = await Promise.all([
    db.query<{ consumed: string | number; reserved: string | number }>(
      `SELECT
         COUNT(*) FILTER (WHERE quota_consumed = TRUE) AS consumed,
         COUNT(*) FILTER (WHERE status = 'QUEUED' AND quota_consumed = FALSE) AS reserved
       FROM test_runs
       WHERE team_id = $1
         AND status <> 'CANCELLED'
         AND ((quota_consumed = TRUE AND COALESCE(started_at, created_at) >= $2)
           OR (quota_consumed = FALSE AND created_at >= $2))`,
      [teamId, startOfDay],
    ),
    db.query<{ id: string; status: string; created_at: Date | string }>(
      `SELECT id, status, created_at FROM submissions
       WHERE team_id = $1 AND status IN ('ACTIVE', 'VALID')
       ORDER BY created_at DESC, id DESC`,
      [teamId],
    ),
    db.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM test_run_reference_bots
       WHERE enabled = TRUE ORDER BY display_name, id`,
    ),
    enqueuer?.isPaused ? enqueuer.isPaused() : Promise.resolve(false),
  ]);
  const quota = quotaResult.rows[0];
  const consumed = Number(quota?.consumed ?? 0);
  const reserved = Number(quota?.reserved ?? 0);
  const limit = round?.rules?.testRun?.quotaPerTeamPerDay ?? 2;
  return {
    roundId: round?.id ?? null,
    quota: {
      limit,
      consumed,
      reserved,
      remaining: Math.max(0, limit - consumed - reserved),
      resetsAt: new Date(startOfDay.getTime() + 86_400_000).toISOString(),
    },
    admissionPaused: admissionPaused || Boolean(round?.paused_at) || (round !== undefined && round.status !== 'SUBMISSION_OPEN'),
    submissions: submissionsResult.rows.map((row) => ({
      id: row.id,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
    })),
    opponents: {
      referenceBots: referencesResult.rows.map(({ id, display_name }) => ({ id, displayName: display_name })),
      ownSubmissionAllowed: submissionsResult.rows.length > 1,
    },
  };
}

function testRunRequestHash(input: CreateTestRunInput): string {
  const canonical = JSON.stringify({
    teamId: input.teamId,
    submissionId: input.submissionId,
    opponentType: input.opponentType,
    opponentSubmissionId: input.opponentSubmissionId ?? null,
    opponentReferenceBot: input.opponentReferenceBot ?? null,
    roundId: input.roundId ?? null,
    mapChecksum: input.mapChecksum ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
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
  const requestHash = testRunRequestHash(input);
  const idempotencyKey = input.idempotencyKey;

  const createOrReplay = async (transaction: Database): Promise<{ run: TestRunRecord; shouldEnqueue: boolean }> => {
    // Serialize admission for a team so concurrent requests cannot over-reserve.
    await transaction.query('SELECT id FROM teams WHERE id = $1 FOR UPDATE', [input.teamId]);
    const existing = await transaction.query<Record<string, unknown>>(
      `SELECT * FROM test_runs WHERE team_id = $1 AND idempotency_key = $2`,
      [input.teamId, idempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.request_hash !== requestHash) {
        throw new TestRunError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
      }
      const run = mapTestRunRow(row);
      if (run.status === 'QUEUED' && enqueuer?.isPaused && await enqueuer.isPaused()) {
        throw new TestRunError(503, 'TEST_RUN_ADMISSION_PAUSED', 'Test-run admission is paused');
      }
      return { run, shouldEnqueue: run.status === 'QUEUED' };
    }

    if (enqueuer?.isPaused && await enqueuer.isPaused()) {
      throw new TestRunError(503, 'TEST_RUN_ADMISSION_PAUSED', 'Test-run admission is paused');
    }

    const activeRound = input.roundId
      ? await transaction.query<{ id: string; status: string; paused_at: Date | string | null }>(
        `SELECT id, status, paused_at FROM qualification_rounds WHERE id = $1 FOR SHARE`, [input.roundId],
      )
      : await transaction.query<{ id: string; status: string; paused_at: Date | string | null }>(
        `SELECT id, status, paused_at FROM qualification_rounds
         ORDER BY CASE status WHEN 'SUBMISSION_OPEN' THEN 0 ELSE 1 END,
           created_at DESC, id DESC LIMIT 1 FOR SHARE`,
      );
    const round = activeRound.rows[0];
    if (input.roundId && !round) throw new TestRunError(404, 'ROUND_NOT_FOUND', 'Round not found');
    if (round && (round.status !== 'SUBMISSION_OPEN' || round.paused_at)) {
      throw new TestRunError(503, 'TEST_RUN_ADMISSION_PAUSED', 'Test-run admission is closed for this round');
    }
    const roundId = round?.id ?? null;
    // 1. Quota admission counts both started runs and queued reservations.
    const maxQuota = await getRoundTestRunQuota(transaction, roundId ?? undefined);
    const quotaResult = await transaction.query<{ consumed: string | number; reserved: string | number }>(
      `SELECT
         COUNT(*) FILTER (WHERE quota_consumed = TRUE) AS consumed,
         COUNT(*) FILTER (WHERE status = 'QUEUED' AND quota_consumed = FALSE) AS reserved
       FROM test_runs
       WHERE team_id = $1 AND status <> 'CANCELLED'
         AND ((quota_consumed = TRUE AND COALESCE(started_at, created_at) >= $2)
           OR (quota_consumed = FALSE AND created_at >= $2))`,
      [input.teamId, getUtcStartOfDay(now)],
    );
    const consumed = Number(quotaResult.rows[0]?.consumed ?? 0);
    const reserved = Number(quotaResult.rows[0]?.reserved ?? 0);
    if (consumed + reserved >= maxQuota) {
      throw new TestRunError(429, 'TEST_RUN_QUOTA_EXCEEDED', `Daily test-run quota of ${maxQuota} exceeded for team`);
    }

    // 2. Validate primary submission ownership & status
    const subRes = await transaction.query<{ id: string; team_id: string; status: string }>(
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
    if (submission.status !== 'ACTIVE' && submission.status !== 'VALID') {
      const isInvalid = submission.status === 'INVALID';
      throw new TestRunError(400, isInvalid ? 'SUBMISSION_INVALID' : 'SUBMISSION_NOT_ELIGIBLE', 'Submission is not eligible for test runs');
    }

    // 3. Validate opponent policy.
    let opponentReferenceBot: string | null = null;
    let opponentSubmissionId: string | null = null;

    if (input.opponentType === 'BTC_REFERENCE') {
      const requestedReferenceBot = input.opponentReferenceBot;
      const reference = await transaction.query<{ id: string }>(
        requestedReferenceBot
          ? `SELECT id FROM test_run_reference_bots WHERE id = $1 AND enabled = TRUE`
          : `SELECT id FROM test_run_reference_bots WHERE enabled = TRUE ORDER BY display_name, id LIMIT 1`,
        requestedReferenceBot ? [requestedReferenceBot] : undefined,
      );
      if (!reference.rows[0]) {
        throw new TestRunError(422, 'REFERENCE_BOT_UNAVAILABLE', 'Selected reference bot is not available');
      }
      opponentReferenceBot = reference.rows[0].id;
    } else if (input.opponentType === 'OWN_SUBMISSION') {
      if (!input.opponentSubmissionId) {
        throw new TestRunError(
          400,
          'INVALID_TEST_RUN_OPPONENT',
          'opponentSubmissionId is required when opponentType is OWN_SUBMISSION',
        );
      }
      const oppSubRes = await transaction.query<{ id: string; team_id: string; status: string }>(
        `SELECT id, team_id, status FROM submissions WHERE id = $1`,
        [input.opponentSubmissionId],
      );
      const oppSubmission = oppSubRes.rows[0];

      if (!oppSubmission) {
        throw new TestRunError(404, 'OPPONENT_SUBMISSION_NOT_FOUND', 'Opponent submission not found');
      }
      if (oppSubmission.team_id !== input.teamId) {
        throw new TestRunError(403, 'OPPONENT_SUBMISSION_NOT_OWNED', 'Opponent submission does not belong to team');
      }
      if (oppSubmission.id === input.submissionId) {
        throw new TestRunError(400, 'INVALID_TEST_RUN_OPPONENT', 'A submission cannot test against itself');
      }
      if (oppSubmission.status !== 'ACTIVE' && oppSubmission.status !== 'VALID') {
        const isInvalid = oppSubmission.status === 'INVALID';
        throw new TestRunError(400, isInvalid ? 'OPPONENT_SUBMISSION_INVALID' : 'OPPONENT_SUBMISSION_NOT_ELIGIBLE', 'Opponent submission is not eligible for test runs');
      }
      opponentSubmissionId = oppSubmission.id;
    } else {
      throw new TestRunError(400, 'INVALID_TEST_RUN_OPPONENT', 'Unsupported opponentType');
    }

    // 4. Create the queued run and its durable queue payload in one transaction.
    const testRunId = randomUUID();
    const mapChecksum = input.mapChecksum ?? 'test_map_default';
    const seed = randomUUID();

    const insertRes = await transaction.query<Record<string, unknown>>(
      `INSERT INTO test_runs (
         id, team_id, round_id, submission_id, opponent_type,
         opponent_submission_id, opponent_reference_bot, status,
         quota_consumed, map_checksum, seed, created_at, idempotency_key, request_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'QUEUED', FALSE, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        testRunId,
        input.teamId,
        roundId,
        input.submissionId,
        input.opponentType,
        opponentSubmissionId,
        opponentReferenceBot,
        mapChecksum,
        seed,
        now,
        idempotencyKey,
        requestHash,
      ],
    );

    const createdRun = mapTestRunRow(insertRes.rows[0]!);
    await transaction.query(
      'INSERT INTO test_run_outbox (test_run_id, payload) VALUES ($1, $2::jsonb)',
      [createdRun.id, JSON.stringify(testRunJob(createdRun))],
    );

    return { run: createdRun, shouldEnqueue: true };
  };

  // Unit-level legacy callers may use a query-only fake; real Database always has transaction().
  const created = typeof db.transaction === 'function'
    ? await db.transaction(createOrReplay)
    : await createOrReplay(db);
  const testRun = created.run;

  // 5. Publish the transactional outbox entry. A failed queue write remains retryable.
  if (enqueuer && created.shouldEnqueue) {
    const pending = await db.query<{ id: string; payload: MatchJobV1 }>(
      'SELECT id, payload FROM test_run_outbox WHERE test_run_id = $1 AND dispatched_at IS NULL', [testRun.id],
    );
    for (const row of pending.rows) {
      await enqueuer.enqueue(row.payload, {
        category: 'test-run',
        priority: QUEUE_PRIORITY.TEST_RUN,
      });
      await db.query('UPDATE test_run_outbox SET dispatched_at = now() WHERE id = $1 AND dispatched_at IS NULL', [row.id]);
    }
  }

  return testRun;
}

function testRunJob(testRun: TestRunRecord): MatchJobV1 {
  return {
    schemaVersion: 'ott.match-job.v1',
    matchId: testRun.id,
    idempotencyKey: testRun.id,
    policyVersion: 'P2_BASELINE_V1',
    x: {
      submissionId: testRun.submissionId,
      archiveSha256: `sha256:${'a'.repeat(64)}`,
      manifestDigest: `sha256:${'a'.repeat(64)}`,
      configDigest: `sha256:${'a'.repeat(64)}`,
      policyVersion: 'P2_BASELINE_V1',
    },
    o: {
      submissionId: testRun.opponentSubmissionId ?? testRun.submissionId,
      archiveSha256: `sha256:${'b'.repeat(64)}`,
      manifestDigest: `sha256:${'b'.repeat(64)}`,
      configDigest: `sha256:${'b'.repeat(64)}`,
      policyVersion: 'P2_BASELINE_V1',
    },
  };
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
    quotaConsumed: Boolean(row.quota_consumed ?? row.quotaConsumed ?? false),
    mapChecksum: String(row.map_checksum ?? row.mapChecksum ?? ''),
    seed: String(row.seed ?? ''),
    result: (row.result as Record<string, unknown>) ?? null,
    replayKey: (row.replay_key ?? row.replayKey) ? String(row.replay_key ?? row.replayKey) : null,
    replaySha256: (row.replay_sha256 ?? row.replaySha256) ? String(row.replay_sha256 ?? row.replaySha256) : null,
    finalStateHash: (row.final_state_hash ?? row.finalStateHash) ? String(row.final_state_hash ?? row.finalStateHash) : null,
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
  if (caller.role !== 'TEAM_ACCOUNT' && caller.role !== 'BTC_ADMIN') {
    throw new TestRunError(403, 'FORBIDDEN', 'You are not allowed to access this resource');
  }
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
export interface TestRunPage {
  readonly data: readonly TestRunRecord[];
  readonly totalItems: number;
}

export async function listTestRunsPage(
  db: Database,
  caller: { role: string; teamId?: string | undefined },
  page: number,
  pageSize: number,
): Promise<TestRunPage> {
  const teamScoped = caller.role !== 'BTC_ADMIN';
  if (teamScoped && (caller.role !== 'TEAM_ACCOUNT' || !caller.teamId)) return { data: [], totalItems: 0 };
  const values: unknown[] = [];
  const where = teamScoped ? `WHERE team_id = $${values.push(caller.teamId)}` : '';
  const count = await db.query<{ total: string | number }>(`SELECT COUNT(*) AS total FROM test_runs ${where}`, values);
  values.push(pageSize, (page - 1) * pageSize);
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM test_runs ${where} ORDER BY created_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { data: rows.rows.map(mapTestRunRow), totalItems: Number(count.rows[0]?.total ?? 0) };
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
         replay_sha256 = $5,
         final_state_hash = $6,
         finished_at = now()
     WHERE id = $7`,
    [
      JSON.stringify(input.result),
      input.replayKey ?? null,
      truncate(input.stderrX),
      truncate(input.stderrO),
      input.replaySha256 ?? null,
      input.finalStateHash ?? null,
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
