import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database, ObjectStorage } from '@ott/platform-api';
import {
  createTestRun,
  getTestRunById,
  refundTestRunQuota,
  completeTestRun,
  failTestRun,
  getDailyConsumedQuota,
  getRoundTestRunQuota,
  TestRunError,
  type TestRunEnqueuer,
} from '@ott/platform-api';
import { QUEUE_PRIORITY, type MatchJobV1, type OciArtifactReference } from '@ott/job-contract';
import { ScriptedBot } from '@ott/match-runner';
import { parseAnyEventLog } from '@ott/match-runner';
import { runTestJob } from '../src/run-test-job.ts';

describe('P3-N03: Test-Run Quota, Opponent Policy & Private Artifacts', () => {
  let mockStorage: ObjectStorage;
  let storedObjects: Map<string, Uint8Array>;

  beforeEach(() => {
    storedObjects = new Map();
    mockStorage = {
      put: vi.fn().mockImplementation(async (key: string, value: Uint8Array) => {
        storedObjects.set(key, Uint8Array.from(value));
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        const val = storedObjects.get(key);
        if (!val) throw new Error(`OBJECT_NOT_FOUND: ${key}`);
        return Uint8Array.from(val);
      }),
      copy: vi.fn(),
      remove: vi.fn(),
    };
  });

  describe('Quota Calculation & Infrastructure Failure Refund', () => {
    it('uses the documented default quota of two runs when no round policy is attached', async () => {
      const mockDb = {
        query: vi.fn(),
      } as unknown as Database;

      await expect(getRoundTestRunQuota(mockDb)).resolves.toBe(2);
    });

    it('enforces daily quota limit per team', async () => {
      const teamId = randomUUID();
      const subId = randomUUID();

      let consumedCount = 0;
      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM qualification_rounds') && sql.includes('FOR SHARE')) return { rows: [{ id: 'round-1', status: 'SUBMISSION_OPEN', paused_at: null }] };
          if (sql.includes('SELECT rrs.rules')) {
            // maxQuota = 3
            return { rows: [{ rules: { testRun: { quotaPerTeamPerDay: 3 } } }] };
          }
          if (sql.includes('SELECT COUNT(*) as count')) {
            return { rows: [{ count: consumedCount }] };
          }
          if (sql.includes('COUNT(*) FILTER')) return { rows: [{ consumed: consumedCount, reserved: 0 }] };
          if (sql.includes('SELECT id, team_id, status FROM submissions')) {
            return { rows: [{ id: subId, team_id: teamId, status: 'VALID' }] };
          }
          if (sql.includes('FROM test_run_reference_bots')) return { rows: [{ id: 'FIRST_LEGAL' }] };
          if (sql.includes('INSERT INTO test_runs')) {
            consumedCount += 1;
            return {
              rows: [{
                id: randomUUID(),
                team_id: teamId,
                submission_id: subId,
                opponent_type: 'BTC_REFERENCE',
                status: 'QUEUED',
                quota_consumed: true,
              }],
            };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      // Runs 1, 2, 3 succeed
      await createTestRun(mockDb, undefined, { teamId, submissionId: subId, opponentType: 'BTC_REFERENCE', roundId: 'round-1', idempotencyKey: randomUUID() });
      await createTestRun(mockDb, undefined, { teamId, submissionId: subId, opponentType: 'BTC_REFERENCE', roundId: 'round-1', idempotencyKey: randomUUID() });
      await createTestRun(mockDb, undefined, { teamId, submissionId: subId, opponentType: 'BTC_REFERENCE', roundId: 'round-1', idempotencyKey: randomUUID() });

      // Run 4 exceeds quota of 3
      await expect(
        createTestRun(mockDb, undefined, { teamId, submissionId: subId, opponentType: 'BTC_REFERENCE', roundId: 'round-1', idempotencyKey: randomUUID() }),
      ).rejects.toThrowError(TestRunError);

      try {
        await createTestRun(mockDb, undefined, { teamId, submissionId: subId, opponentType: 'BTC_REFERENCE', roundId: 'round-1', idempotencyKey: randomUUID() });
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(TestRunError);
        expect((err as TestRunError).status).toBe(429);
        expect((err as TestRunError).code).toBe('TEST_RUN_QUOTA_EXCEEDED');
      }
    });

    it('automatically refunds quota on infrastructure failure', async () => {
      const testRunId = randomUUID();
      let quotaConsumed = true;
      let isInfraFailure = false;
      let status = 'RUNNING';

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('quota_consumed = FALSE')) {
            quotaConsumed = false;
            isInfraFailure = true;
            status = 'FAILED';
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      await refundTestRunQuota(mockDb, testRunId, 'WORKER_CRASH');

      expect(quotaConsumed).toBe(false);
      expect(isInfraFailure).toBe(true);
      expect(status).toBe('FAILED');
    });
  });

  describe('Opponent Policy (AC-21 & D-18)', () => {
    it('allows BTC_REFERENCE opponent', async () => {
      const teamId = randomUUID();
      const subId = randomUUID();

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT rrs.rules')) return { rows: [{ rules: { testRun: { quotaPerTeamPerDay: 5 } } }] };
          if (sql.includes('SELECT COUNT(*) as count')) return { rows: [{ count: 0 }] };
          if (sql.includes('COUNT(*) FILTER')) return { rows: [{ consumed: 0, reserved: 0 }] };
          if (sql.includes('SELECT id, team_id, status FROM submissions')) {
            return { rows: [{ id: subId, team_id: teamId, status: 'ACTIVE' }] };
          }
          if (sql.includes('FROM test_run_reference_bots')) return { rows: [{ id: 'FIRST_LEGAL' }] };
          if (sql.includes('INSERT INTO test_runs')) {
            return {
              rows: [{
                id: randomUUID(),
                team_id: teamId,
                submission_id: subId,
                opponent_type: 'BTC_REFERENCE',
                opponent_reference_bot: 'FIRST_LEGAL',
                status: 'QUEUED',
              }],
            };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const run = await createTestRun(mockDb, undefined, {
        teamId,
        submissionId: subId,
        opponentType: 'BTC_REFERENCE',
        opponentReferenceBot: 'FIRST_LEGAL',
        idempotencyKey: randomUUID(),
      });

      expect(run.opponentType).toBe('BTC_REFERENCE');
      expect(run.opponentReferenceBot).toBe('FIRST_LEGAL');
    });

    it('allows OWN_SUBMISSION opponent when submission belongs to the same team', async () => {
      const teamId = randomUUID();
      const sub1 = randomUUID();
      const sub2 = randomUUID();

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('SELECT rrs.rules')) return { rows: [{ rules: { testRun: { quotaPerTeamPerDay: 5 } } }] };
          if (sql.includes('SELECT COUNT(*) as count')) return { rows: [{ count: 0 }] };
          if (sql.includes('SELECT id, team_id, status FROM submissions WHERE id = $1')) {
            const requestedId = params?.[0];
            return { rows: [{ id: requestedId, team_id: teamId, status: 'VALID' }] };
          }
          if (sql.includes('INSERT INTO test_runs')) {
            return {
              rows: [{
                id: randomUUID(),
                team_id: teamId,
                submission_id: sub1,
                opponent_type: 'OWN_SUBMISSION',
                opponent_submission_id: sub2,
                status: 'QUEUED',
              }],
            };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const run = await createTestRun(mockDb, undefined, {
        teamId,
        submissionId: sub1,
        opponentType: 'OWN_SUBMISSION',
        opponentSubmissionId: sub2,
        idempotencyKey: randomUUID(),
      });

      expect(run.opponentType).toBe('OWN_SUBMISSION');
      expect(run.opponentSubmissionId).toBe(sub2);
    });

    it('rejects a non-eligible primary submission even when it is not INVALID', async () => {
      const teamId = randomUUID();
      const subId = randomUUID();
      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id, team_id, status FROM submissions WHERE id = $1')) return { rows: [{ id: subId, team_id: teamId, status: 'REVOKED' }] };
          return { rows: [] };
        }),
      } as unknown as Database;
      await expect(createTestRun(mockDb, undefined, { teamId, submissionId: subId, opponentType: 'BTC_REFERENCE', idempotencyKey: randomUUID() }))
        .rejects.toMatchObject({ code: 'SUBMISSION_NOT_ELIGIBLE' });
    });

    it('rejects a non-eligible own opponent even when it is not INVALID', async () => {
      const teamId = randomUUID();
      const primaryId = randomUUID();
      const opponentId = randomUUID();
      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('SELECT id, team_id, status FROM submissions WHERE id = $1')) {
            return { rows: [{ id: params?.[0], team_id: teamId, status: params?.[0] === primaryId ? 'VALID' : 'REPLACED' }] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;
      await expect(createTestRun(mockDb, undefined, { teamId, submissionId: primaryId, opponentType: 'OWN_SUBMISSION', opponentSubmissionId: opponentId, idempotencyKey: randomUUID() }))
        .rejects.toMatchObject({ code: 'OPPONENT_SUBMISSION_NOT_ELIGIBLE' });
    });

    it('rejects test run if opponent submission belongs to a different team', async () => {
      const team1 = randomUUID();
      const team2 = randomUUID();
      const sub1 = randomUUID();
      const subOtherTeam = randomUUID();

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('SELECT rrs.rules')) return { rows: [{ rules: { testRun: { quotaPerTeamPerDay: 5 } } }] };
          if (sql.includes('SELECT COUNT(*) as count')) return { rows: [{ count: 0 }] };
          if (sql.includes('SELECT id, team_id, status FROM submissions WHERE id = $1')) {
            const requestedId = params?.[0];
            if (requestedId === sub1) {
              return { rows: [{ id: sub1, team_id: team1, status: 'VALID' }] };
            }
            if (requestedId === subOtherTeam) {
              // Belongs to team2!
              return { rows: [{ id: subOtherTeam, team_id: team2, status: 'VALID' }] };
            }
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      await expect(
        createTestRun(mockDb, undefined, {
          teamId: team1,
          submissionId: sub1,
          opponentType: 'OWN_SUBMISSION',
          opponentSubmissionId: subOtherTeam,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'OPPONENT_SUBMISSION_NOT_OWNED' });
    });
  });

  describe('Priority Queue (AC-21)', () => {
    it('retries queue enqueue after a DB commit without duplicating the run', async () => {
      const teamId = randomUUID();
      const submissionId = randomUUID();
      const runId = randomUUID();
      let storedRun: Record<string, unknown> | null = null;
      let insertCount = 0;
      const db = {
        async query(sql: string, values?: readonly unknown[]) {
          if (sql.includes('SELECT * FROM test_runs WHERE team_id')) return { rows: storedRun ? [storedRun] : [] };
          if (sql.includes('SELECT id, payload FROM test_run_outbox')) return { rows: storedRun ? [{ id: 'outbox-1', payload: {
            schemaVersion: 'ott.match-job.v1', matchId: runId, idempotencyKey: runId, policyVersion: 'P2_BASELINE_V1',
            x: { submissionId, archiveSha256: `sha256:${'a'.repeat(64)}`, manifestDigest: `sha256:${'a'.repeat(64)}`, configDigest: `sha256:${'a'.repeat(64)}`, policyVersion: 'P2_BASELINE_V1' },
            o: { submissionId, archiveSha256: `sha256:${'b'.repeat(64)}`, manifestDigest: `sha256:${'b'.repeat(64)}`, configDigest: `sha256:${'b'.repeat(64)}`, policyVersion: 'P2_BASELINE_V1' },
          } }] : [] };
          if (sql.includes('INSERT INTO test_run_outbox')) return { rows: [] };
          if (sql.includes('COUNT(*) FILTER')) return { rows: [{ consumed: 0, reserved: 0 }] };
          if (sql.includes('SELECT id, team_id, status FROM submissions')) return { rows: [{ id: submissionId, team_id: teamId, status: 'ACTIVE' }] };
          if (sql.includes('FROM test_run_reference_bots')) return { rows: [{ id: 'btc-v1' }] };
          if (sql.includes('INSERT INTO test_runs')) {
            insertCount++;
            storedRun = {
              id: runId, team_id: values?.[1], round_id: values?.[2], submission_id: values?.[3],
              opponent_type: values?.[4], opponent_submission_id: values?.[5], opponent_reference_bot: values?.[6],
              map_checksum: values?.[7], seed: values?.[8], created_at: values?.[9], idempotency_key: values?.[10],
              request_hash: values?.[11], status: 'QUEUED', quota_consumed: false,
            };
            return { rows: [storedRun] };
          }
          if (sql.includes('UPDATE test_run_outbox')) return { rows: [] };
          return { rows: [] };
        },
        async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this as unknown as Database); },
        async close() {},
      } as unknown as Database;
      let enqueueAttempts = 0;
      const enqueuer: TestRunEnqueuer = {
        async enqueue(job) {
          enqueueAttempts++;
          if (enqueueAttempts === 1) throw new Error('temporary redis outage');
          return { jobId: job.matchId };
        },
      };
      const input = { teamId, submissionId, opponentType: 'BTC_REFERENCE' as const, opponentReferenceBot: 'btc-v1', idempotencyKey: 'retryable-run-key-01' };
      await expect(createTestRun(db, enqueuer, input)).rejects.toThrow('temporary redis outage');
      const retry = await createTestRun(db, enqueuer, input);
      expect(retry.id).toBe(runId);
      expect(insertCount).toBe(1);
      expect(enqueueAttempts).toBe(2);
      await expect(createTestRun(db, enqueuer, { ...input, submissionId: randomUUID() }))
        .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      expect(insertCount).toBe(1);
    });

    it('enqueues test-run with QUEUE_PRIORITY.TEST_RUN (priority 3)', async () => {
      const teamId = randomUUID();
      const subId = randomUUID();
      let enqueuedPriority: number | undefined;
      let enqueuedCategory: string | undefined;

      const mockEnqueuer: TestRunEnqueuer = {
        enqueue: vi.fn().mockImplementation(async (_job: MatchJobV1, opts?: { category?: string; priority?: number }) => {
          enqueuedPriority = opts?.priority;
          enqueuedCategory = opts?.category;
          return { jobId: 'test-job-1' };
        }),
      };

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT rrs.rules')) return { rows: [{ rules: { testRun: { quotaPerTeamPerDay: 5 } } }] };
          if (sql.includes('SELECT COUNT(*) as count')) return { rows: [{ count: 0 }] };
          if (sql.includes('COUNT(*) FILTER')) return { rows: [{ consumed: 0, reserved: 0 }] };
          if (sql.includes('SELECT id, team_id, status FROM submissions')) {
            return { rows: [{ id: subId, team_id: teamId, status: 'ACTIVE' }] };
          }
          if (sql.includes('FROM test_run_reference_bots')) return { rows: [{ id: 'FIRST_LEGAL' }] };
          if (sql.includes('INSERT INTO test_run_outbox')) return { rows: [] };
          if (sql.includes('SELECT id, payload FROM test_run_outbox')) return { rows: [{ id: 'outbox-1', payload: {
            schemaVersion: 'ott.match-job.v1', matchId: 'test-job-1', idempotencyKey: 'test-job-1', policyVersion: 'P2_BASELINE_V1',
            x: { submissionId: subId, archiveSha256: `sha256:${'a'.repeat(64)}`, manifestDigest: `sha256:${'a'.repeat(64)}`, configDigest: `sha256:${'a'.repeat(64)}`, policyVersion: 'P2_BASELINE_V1' },
            o: { submissionId: subId, archiveSha256: `sha256:${'b'.repeat(64)}`, manifestDigest: `sha256:${'b'.repeat(64)}`, configDigest: `sha256:${'b'.repeat(64)}`, policyVersion: 'P2_BASELINE_V1' },
          } }] };
          if (sql.includes('UPDATE test_run_outbox')) return { rows: [] };
          if (sql.includes('INSERT INTO test_runs')) {
            return {
              rows: [{
                id: randomUUID(),
                team_id: teamId,
                submission_id: subId,
                opponent_type: 'BTC_REFERENCE',
                status: 'QUEUED',
              }],
            };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      await createTestRun(mockDb, mockEnqueuer, {
        teamId,
        submissionId: subId,
        opponentType: 'BTC_REFERENCE',
        idempotencyKey: randomUUID(),
      });

      expect(enqueuedCategory).toBe('test-run');
      expect(enqueuedPriority).toBe(QUEUE_PRIORITY.TEST_RUN);
      expect(enqueuedPriority).toBe(3); // Lower priority than OFFICIAL (1) and PREFLIGHT (2)
    });
  });

  describe('Private Artifacts & RBAC Isolation', () => {
    it('allows owner team and BTC_ADMIN to read test run, but forbids another team', async () => {
      const ownerTeam = randomUUID();
      const otherTeam = randomUUID();
      const testRunId = randomUUID();

      const testRunRecord = {
        id: testRunId,
        team_id: ownerTeam,
        status: 'COMPLETED',
        replay_key: `replays/test-runs/${testRunId}.json`,
      };

      const mockDb = {
        query: vi.fn().mockImplementation(async () => ({ rows: [testRunRecord] })),
      } as unknown as Database;

      // 1. Owner team reads: OK
      const ownerResult = await getTestRunById(mockDb, testRunId, { role: 'TEAM_ACCOUNT', teamId: ownerTeam });
      expect(ownerResult.id).toBe(testRunId);

      // 2. BTC Admin reads: OK
      const adminResult = await getTestRunById(mockDb, testRunId, { role: 'BTC_ADMIN' });
      expect(adminResult.id).toBe(testRunId);

      // 3. Another team reads: 404 TEST_RUN_NOT_FOUND (not accessible)
      await expect(
        getTestRunById(mockDb, testRunId, { role: 'TEAM_ACCOUNT', teamId: otherTeam }),
      ).rejects.toThrowError(TestRunError);
    });
  });

  describe('Test Run Execution & Replay Storage', () => {
    it('executes test run job and stores private replay in storage without touching ratings', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const dummyArchive = new TextEncoder().encode('dummy_bot_archive');
      const dummySha = 'sha256:' + createHash('sha256').update(dummyArchive).digest('hex');
      const subKey = 'submissions/bot-1.tar';

      storedObjects.set(subKey, dummyArchive);

      let completedResult: Record<string, unknown> | null = null;
      let completedReplayKey: string | null = null;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs')) {
            return {
              rows: [{
                id: testRunId,
                team_id: teamId,
                status: 'QUEUED',
                submission_id: subId,
                opponent_type: 'BTC_REFERENCE',
                opponent_submission_id: null,
                opponent_reference_bot: 'FIRST_LEGAL',
                seed: 'seed123',
                sub_object_key: subKey,
                sub_archive_sha256: dummySha,
                sub_manifest_digest: 'sha256:' + '1'.repeat(64),
                sub_config_digest: 'sha256:' + '2'.repeat(64),
                sub_entrypoint: JSON.stringify(['/bot']),
                sub_policy_version: 'P2_BASELINE_V1',
              }],
            };
          }
          if (sql.includes("status = 'RUNNING'")) {
            return { rows: [{ id: testRunId }] };
          }
          if (sql.includes('UPDATE test_runs SET status = $1')) {
            return { rows: [] };
          }
          if (sql.includes("status = 'COMPLETED'")) {
            completedResult = JSON.parse(params?.[0] as string);
            completedReplayKey = params?.[1] as string;
            return { rows: [] };
          }
          if (sql.includes('ratings_ledger') || sql.includes('UPDATE teams SET rating')) {
            throw new Error('TEST_RUN_MUST_NOT_TOUCH_RATINGS');
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const result = await runTestJob({
        testRunId,
        database: mockDb,
        storage: mockStorage,
        getReferenceBot: async () => ({
          archive: dummyArchive,
          entrypoint: ['/bot'],
          reference: { submissionId: 'reference:FIRST_LEGAL', archiveSha256: dummySha, manifestDigest: 'sha256:' + '3'.repeat(64), configDigest: 'sha256:' + '4'.repeat(64), policyVersion: 'P2_BASELINE_V1' },
        }),
        createBotPort: async () =>
          new ScriptedBot({
            replies: [{ kind: 'error', code: 'BOT_TIMEOUT' }],
          }),
      });

      expect(result.alreadyFinished).toBe(false);
      expect(result.replayKey).toBe(`replays/test-runs/${testRunId}.json`);
      expect(completedReplayKey).toBe(`replays/test-runs/${testRunId}.json`);
      expect(completedResult).not.toBeNull();
      expect(storedObjects.has(`replays/test-runs/${testRunId}.json`)).toBe(true);
      const storedReplay = parseAnyEventLog(
        new TextDecoder().decode(storedObjects.get(`replays/test-runs/${testRunId}.json`)),
      );
      expect(storedReplay.header.matchId).toBe(testRunId);
      // The API replay projection requires header.game.gameId === matchId (replays/service.ts publicEventLog).
      expect(storedReplay.header.game.gameId).toBe(testRunId);
      expect(storedReplay.footer.result.finalStateHash).toBeDefined();
    });

    it('fails closed and refunds the reservation when a BTC reference bot is not configured', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const ownArchive = new TextEncoder().encode('team-bot');
      const ownSha = 'sha256:' + createHash('sha256').update(ownArchive).digest('hex');
      storedObjects.set('submissions/team-bot.tar', ownArchive);
      let failedWith: string | null = null;
      let quotaConsumed = true;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs tr')) {
            return { rows: [{
              id: testRunId,
              team_id: teamId,
              status: 'QUEUED',
              submission_id: subId,
              opponent_type: 'BTC_REFERENCE',
              opponent_submission_id: null,
              opponent_reference_bot: 'FIRST_LEGAL',
              seed: 'seed123',
              sub_object_key: 'submissions/team-bot.tar',
              sub_archive_sha256: ownSha,
              sub_manifest_digest: 'sha256:' + '1'.repeat(64),
              sub_config_digest: 'sha256:' + '2'.repeat(64),
              sub_entrypoint: JSON.stringify(['/bot']),
              sub_policy_version: 'P2_BASELINE_V1',
            }] };
          }
          if (sql.includes("status = 'RUNNING'")) return { rows: [{ id: testRunId }] };
          if (sql.includes('UPDATE test_runs SET status = $1')) return { rows: [] };
          if (sql.includes("status = 'FAILED'")) {
            failedWith = String(params?.[0]);
            quotaConsumed = params?.[1] === false;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const result = await runTestJob({ testRunId, database: mockDb, storage: mockStorage });

      expect(result.isInfraFailure).toBe(true);
      expect(failedWith).toBe('REFERENCE_BOT_UNAVAILABLE');
      expect(quotaConsumed).toBe(false);
      expect(storedObjects.has(`replays/test-runs/${testRunId}.json`)).toBe(false);
    });

    it('fails closed when opponent_reference_bot is null for BTC_REFERENCE test run', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const ownArchive = new TextEncoder().encode('team-bot');
      const ownSha = 'sha256:' + createHash('sha256').update(ownArchive).digest('hex');
      storedObjects.set('submissions/team-bot.tar', ownArchive);
      let failedWith: string | null = null;
      let quotaConsumed = true;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs tr')) {
            return { rows: [{
              id: testRunId,
              team_id: teamId,
              status: 'QUEUED',
              submission_id: subId,
              opponent_type: 'BTC_REFERENCE',
              opponent_submission_id: null,
              opponent_reference_bot: null,
              seed: 'seed123',
              sub_object_key: 'submissions/team-bot.tar',
              sub_archive_sha256: ownSha,
              sub_manifest_digest: 'sha256:' + '1'.repeat(64),
              sub_config_digest: 'sha256:' + '2'.repeat(64),
              sub_entrypoint: JSON.stringify(['/bot']),
              sub_policy_version: 'P2_BASELINE_V1',
            }] };
          }
          if (sql.includes("status = 'RUNNING'")) return { rows: [{ id: testRunId }] };
          if (sql.includes('UPDATE test_runs SET status = $1')) return { rows: [] };
          if (sql.includes("status = 'FAILED'")) {
            failedWith = String(params?.[0]);
            quotaConsumed = params?.[1] === false;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const result = await runTestJob({ testRunId, database: mockDb, storage: mockStorage });

      expect(result.isInfraFailure).toBe(true);
      expect(failedWith).toBe('REFERENCE_BOT_UNAVAILABLE');
      expect(quotaConsumed).toBe(false);
      expect(storedObjects.has(`replays/test-runs/${testRunId}.json`)).toBe(false);
    });

    it('rejects a BTC reference archive whose bytes do not match its catalog digest', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const ownArchive = new TextEncoder().encode('team-bot');
      const ownSha = 'sha256:' + createHash('sha256').update(ownArchive).digest('hex');
      storedObjects.set('submissions/team-bot.tar', ownArchive);
      let failedWith: string | null = null;
      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs tr')) return { rows: [{
            id: testRunId, team_id: teamId, status: 'QUEUED', submission_id: subId,
            opponent_type: 'BTC_REFERENCE', opponent_submission_id: null, opponent_reference_bot: 'btc-v1', seed: 'seed',
            sub_object_key: 'submissions/team-bot.tar', sub_archive_sha256: ownSha,
            sub_manifest_digest: 'sha256:' + '1'.repeat(64), sub_config_digest: 'sha256:' + '2'.repeat(64),
            sub_entrypoint: JSON.stringify(['/bot']), sub_policy_version: 'P2_BASELINE_V1',
          }] };
          if (sql.includes("status = 'RUNNING'")) return { rows: [{ id: testRunId }] };
          if (sql.includes("status = 'FAILED'")) { failedWith = String(params?.[0]); return { rows: [] }; }
          return { rows: [] };
        }),
      } as unknown as Database;
      const badArchive = new TextEncoder().encode('tampered reference archive');
      const result = await runTestJob({ testRunId, database: mockDb, storage: mockStorage, getReferenceBot: async () => ({
        archive: badArchive,
        entrypoint: ['/bot'],
        reference: { submissionId: 'reference:btc-v1', archiveSha256: `sha256:${'0'.repeat(64)}`, manifestDigest: `sha256:${'3'.repeat(64)}`, configDigest: `sha256:${'4'.repeat(64)}`, policyVersion: 'P2_BASELINE_V1' },
      }) });
      expect(result.isInfraFailure).toBe(true);
      expect(failedWith).toBe('OPPONENT_ARCHIVE_CHECKSUM_MISMATCH');
      expect(storedObjects.has(`replays/test-runs/${testRunId}.json`)).toBe(false);
    });

    it('resolves a BTC_REFERENCE opponent from test_run_reference_bots in DB and runs against it without getReferenceBot option', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const ownArchive = new TextEncoder().encode('team-bot-code');
      const ownSha = 'sha256:' + createHash('sha256').update(ownArchive).digest('hex');
      const refArchive = new TextEncoder().encode('btc-baseline-bot-code');
      const refSha = 'sha256:' + createHash('sha256').update(refArchive).digest('hex');
      storedObjects.set('submissions/team-bot.tar', ownArchive);
      storedObjects.set('reference-bots/btc-baseline.oci.tar', refArchive);

      let completedWithResult: Record<string, unknown> | null = null;
      let completedReplayKey: string | null = null;
      let failedWith: string | null = null;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs tr')) {
            return {
              rows: [{
                id: testRunId,
                team_id: teamId,
                status: 'QUEUED',
                submission_id: subId,
                opponent_type: 'BTC_REFERENCE',
                opponent_submission_id: null,
                opponent_reference_bot: 'btc-baseline',
                seed: 'seed-btc-test',
                sub_object_key: 'submissions/team-bot.tar',
                sub_archive_sha256: ownSha,
                sub_manifest_digest: 'sha256:' + '1'.repeat(64),
                sub_config_digest: 'sha256:' + '2'.repeat(64),
                sub_entrypoint: JSON.stringify(['/bot']),
                sub_policy_version: 'P2_BASELINE_V1',
              }],
            };
          }
          if (sql.includes("status = 'RUNNING'")) return { rows: [{ id: testRunId }] };
          if (sql.includes('FROM test_run_reference_bots WHERE id = $1 AND enabled = TRUE')) {
            return {
              rows: [{
                id: 'btc-baseline',
                object_key: 'reference-bots/btc-baseline.oci.tar',
                archive_sha256: refSha,
                manifest_digest: 'sha256:' + '3'.repeat(64),
                config_digest: 'sha256:' + '4'.repeat(64),
                entrypoint: JSON.stringify(['/bot']),
                policy_version: 'P2_BASELINE_V1',
              }],
            };
          }
          if (sql.includes("status = 'FAILED'")) {
            failedWith = String(params?.[0]);
            return { rows: [] };
          }
          if (sql.includes("status = 'COMPLETED'")) {
            completedWithResult = typeof params?.[0] === 'string' ? JSON.parse(params[0]) : (params?.[0] as Record<string, unknown>);
            completedReplayKey = String(params?.[1]);
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const createdBots: Array<{ role: string }> = [];
      const capturedReferences: Array<OciArtifactReference> = [];
      const fakeBotFactory = (
        _archive: Uint8Array,
        reference: OciArtifactReference,
        _entrypoint: readonly string[],
      ) => {
        capturedReferences.push(reference);
        createdBots.push({ role: reference.submissionId });
        return new ScriptedBot({
          replies: [{ kind: 'error', code: 'BOT_TIMEOUT' }],
        });
      };

      const result = await runTestJob({
        testRunId,
        database: mockDb,
        storage: mockStorage,
        createBotPort: fakeBotFactory,
      });

      expect(result.alreadyFinished).toBe(false);
      expect(result.outcome).toBeDefined();
      expect(completedWithResult).toBeDefined();
      expect(completedReplayKey).toBe(`replays/test-runs/${testRunId}.json`);
      expect(createdBots).toHaveLength(2);
      expect(createdBots[0]!.role).toBe(subId);
      expect(createdBots[1]!.role).toBe('reference:btc-baseline');
      expect(capturedReferences).toHaveLength(2);
      expect(capturedReferences[0]!.policyVersion).toBe('OTT_SANDBOX_V1');
      expect(capturedReferences[1]!.policyVersion).toBe('OTT_SANDBOX_V1');
      expect(failedWith).toBeNull();
    });

    it('fails closed with REFERENCE_BOT_POLICY_MISMATCH when catalog row policy is unsupported or mismatched', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const ownArchive = new TextEncoder().encode('team-bot-code');
      const ownSha = 'sha256:' + createHash('sha256').update(ownArchive).digest('hex');
      const refArchive = new TextEncoder().encode('btc-baseline-bot-code');
      const refSha = 'sha256:' + createHash('sha256').update(refArchive).digest('hex');
      storedObjects.set('submissions/team-bot.tar', ownArchive);
      storedObjects.set('reference-bots/btc-baseline.oci.tar', refArchive);

      let failedWith: string | null = null;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs tr')) {
            return {
              rows: [{
                id: testRunId,
                team_id: teamId,
                status: 'QUEUED',
                submission_id: subId,
                opponent_type: 'BTC_REFERENCE',
                opponent_submission_id: null,
                opponent_reference_bot: 'btc-baseline',
                seed: 'seed-btc-test',
                sub_object_key: 'submissions/team-bot.tar',
                sub_archive_sha256: ownSha,
                sub_manifest_digest: 'sha256:' + '1'.repeat(64),
                sub_config_digest: 'sha256:' + '2'.repeat(64),
                sub_entrypoint: JSON.stringify(['/bot']),
                sub_policy_version: 'P2_BASELINE_V1',
              }],
            };
          }
          if (sql.includes("status = 'RUNNING'")) return { rows: [{ id: testRunId }] };
          if (sql.includes('FROM test_run_reference_bots WHERE id = $1 AND enabled = TRUE')) {
            return {
              rows: [{
                id: 'btc-baseline',
                object_key: 'reference-bots/btc-baseline.oci.tar',
                archive_sha256: refSha,
                manifest_digest: 'sha256:' + '3'.repeat(64),
                config_digest: 'sha256:' + '4'.repeat(64),
                entrypoint: JSON.stringify(['/bot']),
                policy_version: 'UNSUPPORTED_POLICY_VER',
              }],
            };
          }
          if (sql.includes("status = 'FAILED'")) {
            failedWith = String(params?.[0]);
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const result = await runTestJob({
        testRunId,
        database: mockDb,
        storage: mockStorage,
      });

      expect(result.alreadyFinished).toBe(false);
      expect(result.isInfraFailure).toBe(true);
      expect(failedWith).toBe('REFERENCE_BOT_POLICY_MISMATCH');
    });

    it('executes self-play test runs and records the resolved map metadata', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const subKey = `submissions/${teamId}/${subId}.tar`;
      const dummyArchive = new TextEncoder().encode('dummy-self-play-bot');
      const dummySha = 'sha256:' + createHash('sha256').update(dummyArchive).digest('hex');
      storedObjects.set(subKey, dummyArchive);

      let completedResult: Record<string, unknown> | null = null;
      let completedReplayKey: string | null = null;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs tr')) {
            return {
              rows: [{
                id: testRunId,
                team_id: teamId,
                status: 'QUEUED',
                submission_id: subId,
                opponent_type: 'OWN_SUBMISSION',
                opponent_submission_id: subId, // Self-play
                opponent_reference_bot: null,
                seed: 'seed-self-play',
                map_checksum: 'a'.repeat(64), // DEFAULT_MAP
                sub_object_key: subKey,
                sub_archive_sha256: dummySha,
                sub_manifest_digest: 'sha256:' + '1'.repeat(64),
                sub_config_digest: 'sha256:' + '2'.repeat(64),
                sub_entrypoint: JSON.stringify(['/bot']),
                sub_policy_version: 'P2_BASELINE_V1',
              }],
            };
          }
          if (sql.includes('FROM submissions')) {
            return {
              rows: [{
                object_key: subKey,
                archive_sha256: dummySha,
                oci_manifest_digest: 'sha256:' + '1'.repeat(64),
                oci_config_digest: 'sha256:' + '2'.repeat(64),
                entrypoint: JSON.stringify(['/bot']),
              }],
            };
          }
          if (sql.includes("status = 'RUNNING'")) {
            return { rows: [{ id: testRunId }] };
          }
          if (sql.includes("status = 'COMPLETED'")) {
            completedResult = JSON.parse(params?.[0] as string);
            completedReplayKey = params?.[1] as string;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const result = await runTestJob({
        testRunId,
        database: mockDb,
        storage: mockStorage,
        createBotPort: async () =>
          new ScriptedBot({
            replies: [{ kind: 'error', code: 'BOT_TIMEOUT' }],
          }),
      });

      expect(result.alreadyFinished).toBe(false);
      expect(result.replayKey).toBe(`replays/test-runs/${testRunId}.json`);
      expect(completedReplayKey).toBe(`replays/test-runs/${testRunId}.json`);
      const res = completedResult as Record<string, unknown> | null;
      expect(res).not.toBeNull();
      expect(res?.mapId).toBe('default');
      expect(res?.mapChecksum).toBe('a'.repeat(64));
    });

    it('falls back to DEFAULT_MAP when map_checksum is test_map_default', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const subKey = `submissions/${teamId}/${subId}.tar`;
      const dummyArchive = new TextEncoder().encode('dummy-legacy-bot');
      const dummySha = 'sha256:' + createHash('sha256').update(dummyArchive).digest('hex');
      storedObjects.set(subKey, dummyArchive);

      let completedResult: Record<string, unknown> | null = null;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs tr')) {
            return {
              rows: [{
                id: testRunId,
                team_id: teamId,
                status: 'QUEUED',
                submission_id: subId,
                opponent_type: 'OWN_SUBMISSION',
                opponent_submission_id: subId,
                opponent_reference_bot: null,
                seed: 'seed-legacy',
                map_checksum: 'test_map_default',
                sub_object_key: subKey,
                sub_archive_sha256: dummySha,
                sub_manifest_digest: 'sha256:' + '1'.repeat(64),
                sub_config_digest: 'sha256:' + '2'.repeat(64),
                sub_entrypoint: JSON.stringify(['/bot']),
                sub_policy_version: 'P2_BASELINE_V1',
              }],
            };
          }
          if (sql.includes('FROM submissions')) {
            return {
              rows: [{
                object_key: subKey,
                archive_sha256: dummySha,
                oci_manifest_digest: 'sha256:' + '1'.repeat(64),
                oci_config_digest: 'sha256:' + '2'.repeat(64),
                entrypoint: JSON.stringify(['/bot']),
              }],
            };
          }
          if (sql.includes("status = 'RUNNING'")) {
            return { rows: [{ id: testRunId }] };
          }
          if (sql.includes("status = 'COMPLETED'")) {
            completedResult = JSON.parse(params?.[0] as string);
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const result = await runTestJob({
        testRunId,
        database: mockDb,
        storage: mockStorage,
        createBotPort: async () =>
          new ScriptedBot({
            replies: [{ kind: 'error', code: 'BOT_TIMEOUT' }],
          }),
      });

      expect(result.alreadyFinished).toBe(false);
      const res = completedResult as Record<string, unknown> | null;
      expect(res?.mapId).toBe('default');
      expect(res?.mapChecksum).toBe('a'.repeat(64));
    });

    it('fails test run with MAP_UNKNOWN when map checksum is not found in catalog', async () => {
      const testRunId = randomUUID();
      const teamId = randomUUID();
      const subId = randomUUID();
      const subKey = `submissions/${teamId}/${subId}.tar`;
      const dummyArchive = new TextEncoder().encode('dummy-bot');
      const dummySha = 'sha256:' + createHash('sha256').update(dummyArchive).digest('hex');
      storedObjects.set(subKey, dummyArchive);

      let failedWith: string | null = null;
      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('FROM test_runs tr')) {
            return {
              rows: [{
                id: testRunId,
                team_id: teamId,
                status: 'QUEUED',
                submission_id: subId,
                opponent_type: 'OWN_SUBMISSION',
                opponent_submission_id: subId,
                opponent_reference_bot: null,
                seed: 'seed-unknown-map',
                map_checksum: 'non_existent_map_checksum',
                sub_object_key: subKey,
                sub_archive_sha256: dummySha,
                sub_manifest_digest: 'sha256:' + '1'.repeat(64),
                sub_config_digest: 'sha256:' + '2'.repeat(64),
                sub_entrypoint: JSON.stringify(['/bot']),
                sub_policy_version: 'P2_BASELINE_V1',
              }],
            };
          }
          if (sql.includes('FROM submissions')) {
            return {
              rows: [{
                object_key: subKey,
                archive_sha256: dummySha,
                oci_manifest_digest: 'sha256:' + '1'.repeat(64),
                oci_config_digest: 'sha256:' + '2'.repeat(64),
                entrypoint: JSON.stringify(['/bot']),
              }],
            };
          }
          if (sql.includes("status = 'RUNNING'")) {
            return { rows: [{ id: testRunId }] };
          }
          if (sql.includes("status = 'FAILED'")) {
            failedWith = String(params?.[0]);
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const result = await runTestJob({
        testRunId,
        database: mockDb,
        storage: mockStorage,
      });

      expect(result.alreadyFinished).toBe(false);
      expect(failedWith).toBe('MAP_UNKNOWN');
    });
  });
});

