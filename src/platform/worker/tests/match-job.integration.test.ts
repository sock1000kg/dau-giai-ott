import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MATCH_QUEUE_NAME, type MatchJobV1 } from '@ott/job-contract';
import { MatchQueue } from '@ott/platform-api';
import { Redis } from 'ioredis';
import { createMatchWorker, type MatchWorkerAttemptContext } from '../src/worker.ts';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:16379';
const namespace = `ott-p2-t09-${randomUUID()}`;
const queueName = `${namespace}-match`;
const deadLetterQueueName = `${namespace}-dead`;
const digest = `sha256:${'b'.repeat(64)}`;
const matchId = '0f54d8cb-85ee-4a6e-a63c-cace24e58120';
const job: MatchJobV1 = {
  schemaVersion: 'ott.match-job.v1',
  matchId,
  idempotencyKey: matchId,
  policyVersion: 'P2_BASELINE_V1',
  x: { submissionId: '82185759-bbdb-4115-b04f-8e6050fd3561', archiveSha256: digest, manifestDigest: digest, configDigest: digest, policyVersion: 'P2_BASELINE_V1' },
  o: { submissionId: 'dc1db9c5-79b8-4d00-bc67-9d8da97d4538', archiveSha256: digest, manifestDigest: digest, configDigest: digest, policyVersion: 'P2_BASELINE_V1' },
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: () => resolvePromise() };
}
let matchQueue: MatchQueue;
let matchQueueInspector: Queue<MatchJobV1>;
let deadLetterQueue: Queue<Record<string, unknown>>;

async function cleanQueue(queue: Queue): Promise<void> {
  await queue.obliterate({ force: true });
  await queue.close();
}

describe('BullMQ MatchJob worker integration', () => {
  beforeAll(async () => {
    matchQueue = new MatchQueue({ redisUrl, queueName });
    matchQueueInspector = new Queue<MatchJobV1>(queueName, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
    deadLetterQueue = new Queue<Record<string, unknown>>(deadLetterQueueName, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
    await Promise.all([matchQueueInspector.waitUntilReady(), deadLetterQueue.waitUntilReady()]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await cleanQueue(matchQueueInspector);
    await cleanQueue(deadLetterQueue);
    await matchQueue.close();
  });

  it('retains completed duplicate IDs and rejects an attempt to replace the pinned image', async () => {
    const duplicateMatchId = randomUUID();
    const duplicateJob = { ...job, matchId: duplicateMatchId, idempotencyKey: duplicateMatchId };
    const first = await matchQueue.enqueue(duplicateJob);
    const processMatch = vi.fn(async () => undefined);
    const runtime = createMatchWorker({ redisUrl, processMatch, logger, queueName, deadLetterQueueName });
    try {
      await runtime.worker.waitUntilReady();
      await vi.waitFor(async () => {
        const queued = await matchQueueInspector.getJob(first.jobId);
        expect(await queued?.getState()).toBe('completed');
      }, { timeout: 5_000 });
      const duplicate = await matchQueue.enqueue(duplicateJob);
      expect(duplicate.jobId).toBe(first.jobId);
      await expect(matchQueue.enqueue({ ...duplicateJob, x: { ...duplicateJob.x, manifestDigest: `sha256:${'c'.repeat(64)}` } })).rejects.toThrow('MATCH_IDEMPOTENCY_CONFLICT');
      expect(processMatch).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
    }
  });

  it('retries with backoff, writes a dead letter once, and logs without bot output', async () => {
    await matchQueue.enqueue(job);
    const attemptsSeen: Array<{ attemptNumber: number; maxAttempts: number }> = [];
    const processMatch = vi.fn(async (_matchJob: MatchJobV1, attempt: MatchWorkerAttemptContext) => {
      attemptsSeen.push(attempt);
      throw new Error('SANDBOX_TIMEOUT stdout SECRET_DATA');
    });
    const runtime = createMatchWorker({ redisUrl, processMatch, logger, queueName, deadLetterQueueName, attempts: 3 });
    try {
      await runtime.worker.waitUntilReady();
      await vi.waitFor(async () => {
        const failed = await matchQueueInspector.getFailedCount();
        const deadLetters = await deadLetterQueue.getJobCountByTypes('waiting');
        expect(failed).toBe(1);
        expect(deadLetters).toBe(1);
      }, { timeout: 15_000, interval: 250 });
      expect(processMatch).toHaveBeenCalledTimes(3);
      expect(attemptsSeen).toEqual([
        { attemptNumber: 1, maxAttempts: 3 },
        { attemptNumber: 2, maxAttempts: 3 },
        { attemptNumber: 3, maxAttempts: 3 },
      ]);
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'match_job_started' }), 'Match job started');
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'MATCH_WORKER_FAILED' }), 'Match job attempt failed');
      expect(JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls])).not.toMatch(/stdout|stderr|SECRET_DATA/i);
    } finally {
      await runtime.close();
    }
  });

  it('quarantines malformed jobs without retrying or copying their payload into the dead letter', async () => {
    const poisonQueueName = `${namespace}-poison`;
    const poisonDeadLetterName = `${poisonQueueName}-dead`;
    const poisonQueue = new Queue<Record<string, unknown>>(poisonQueueName, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
    const poisonDeadLetters = new Queue<Record<string, unknown>>(poisonDeadLetterName, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
    const processMatch = vi.fn(async () => undefined);
    const runtime = createMatchWorker({ redisUrl, processMatch, logger, queueName: poisonQueueName, deadLetterQueueName: poisonDeadLetterName });
    try {
      await Promise.all([poisonQueue.waitUntilReady(), poisonDeadLetters.waitUntilReady(), runtime.worker.waitUntilReady()]);
      const malformed = { ...job, command: ['python', 'bot.py'] };
      await poisonQueue.add('run-match', malformed, { jobId: 'malformed-test-job', attempts: 3 });
      await vi.waitFor(async () => {
        expect(await poisonQueue.getFailedCount()).toBe(1);
        expect(await poisonDeadLetters.getJobCountByTypes('waiting')).toBe(1);
      }, { timeout: 5_000 });
      expect(processMatch).not.toHaveBeenCalled();
      const [deadLetter] = await poisonDeadLetters.getJobs(['waiting']);
      expect(deadLetter?.data).toMatchObject({ errorCode: 'MATCH_JOB_INVALID', attemptsMade: 1 });
      expect(deadLetter?.data).not.toHaveProperty('command');
    } finally {
      await runtime.close();
      await cleanQueue(poisonQueue);
      await cleanQueue(poisonDeadLetters);
    }
  });

  it('graceful close waits for an in-flight match before returning', async () => {
    const separateQueue = `${namespace}-shutdown`;
    const queue = new MatchQueue({ redisUrl, queueName: separateQueue });
    const inspector = new Queue<MatchJobV1>(separateQueue, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) });
    const started = deferred();
    const finish = deferred();
    const runtime = createMatchWorker({
      redisUrl,
      processMatch: async () => { started.resolve(); await finish.promise; },
      logger,
      queueName: separateQueue,
      deadLetterQueueName: `${separateQueue}-dead`,
    });
    try {
      await runtime.worker.waitUntilReady();
      await inspector.waitUntilReady();
      const shutdownMatchId = randomUUID();
      const shutdownJob = { ...job, matchId: shutdownMatchId, idempotencyKey: shutdownMatchId };
      await queue.enqueue(shutdownJob);
      const queued = await inspector.getJob(`match-${shutdownJob.matchId}`);
      expect(queued?.data.matchId).toBe(shutdownJob.matchId);
      await Promise.race([started.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('WORKER_DID_NOT_START')), 3_000))]);
      let closed = false;
      const closing = runtime.close().then(() => { closed = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(closed).toBe(false);
      finish.resolve();
      await closing;
      expect(closed).toBe(true);
    } finally {
      finish.resolve();
      await runtime.close();
      await cleanQueue(inspector);
      await queue.close();
      await cleanQueue(new Queue(`${separateQueue}-dead`, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }) }));
    }
  }, 15_000);
});
