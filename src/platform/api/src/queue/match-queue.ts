import { createHash } from 'node:crypto';

import { Queue } from 'bullmq';
import {
  DEAD_LETTER_QUEUE_NAME,
  MATCH_QUEUE_NAME,
  PREFLIGHT_QUEUE_NAME,
  QUEUE_PRIORITY,
  TEST_RUN_QUEUE_NAME,
  priorityForCategory,
  validateMatchJob,
  type JobQueueCategory,
  type MatchJobV1,
  type QueuePriority,
} from '@ott/job-contract';
import { createRedisConnection } from './redis-connection.ts';

export {
  DEAD_LETTER_QUEUE_NAME,
  MATCH_QUEUE_NAME,
  PREFLIGHT_QUEUE_NAME,
  QUEUE_PRIORITY,
  TEST_RUN_QUEUE_NAME,
  priorityForCategory,
  type JobQueueCategory,
  type QueuePriority,
} from '@ott/job-contract';

export interface MatchQueueOptions {
  readonly redisUrl: string;
  readonly queueName?: string;
}

export interface EnqueueMatchOptions {
  readonly category?: JobQueueCategory;
  readonly priority?: QueuePriority;
  /** Rerun generation; 0/undefined keeps the original job id, N>0 publishes a fresh `-rN` job. */
  readonly generation?: number;
}

export interface EnqueuedMatch {
  readonly jobId: string;
}

type QueueJob = {
  readonly id?: string;
  readonly data: MatchJobV1;
};

function canonicalPayload(job: MatchJobV1): string {
  return JSON.stringify({
    schemaVersion: job.schemaVersion,
    matchId: job.matchId,
    idempotencyKey: job.idempotencyKey,
    policyVersion: job.policyVersion,
    x: {
      submissionId: job.x.submissionId,
      archiveSha256: job.x.archiveSha256,
      manifestDigest: job.x.manifestDigest,
      configDigest: job.x.configDigest,
      policyVersion: job.x.policyVersion,
    },
    o: {
      submissionId: job.o.submissionId,
      archiveSha256: job.o.archiveSha256,
      manifestDigest: job.o.manifestDigest,
      configDigest: job.o.configDigest,
      policyVersion: job.o.policyVersion,
    },
  });
}

function payloadHash(job: MatchJobV1): string {
  return createHash('sha256').update(canonicalPayload(job)).digest('hex');
}

/**
 * BullMQ custom job IDs are retained on completion/failure to make delivery
 * idempotent. The stable key is the database match UUID, never a user string.
 */
export class MatchQueue {
  private readonly queue: Queue<MatchJobV1>;

  public constructor(options: MatchQueueOptions) {
    const connection = createRedisConnection(options.redisUrl);
    this.queue = new Queue<MatchJobV1>(options.queueName ?? MATCH_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }

  public async enqueue(job: MatchJobV1, options?: EnqueueMatchOptions): Promise<EnqueuedMatch> {
    if (!validateMatchJob(job).ok) throw new Error('MATCH_JOB_INVALID');
    const generation = options?.generation ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('MATCH_GENERATION_INVALID');
    const jobId = generation > 0 ? `match-${job.matchId}-r${generation}` : `match-${job.matchId}`;
    const existing = await this.queue.getJob(jobId) as QueueJob | undefined;
    if (existing !== undefined) {
      if (payloadHash(existing.data) !== payloadHash(job)) {
        throw new Error('MATCH_IDEMPOTENCY_CONFLICT');
      }
      return { jobId };
    }

    const priority = options?.priority ?? (options?.category ? priorityForCategory(options.category) : QUEUE_PRIORITY.OFFICIAL);
    await this.queue.add('run-match', job, { jobId, priority });
    // Re-read after add to detect a concurrent producer that won this ID.
    const created = await this.queue.getJob(jobId) as QueueJob | undefined;
    if (created === undefined) throw new Error('MATCH_JOB_ENQUEUE_FAILED');
    if (payloadHash(created.data) !== payloadHash(job)) {
      throw new Error('MATCH_IDEMPOTENCY_CONFLICT');
    }
    return { jobId };
  }

  public async pause(): Promise<void> {
    await this.queue.pause();
  }

  public async resume(): Promise<void> {
    await this.queue.resume();
  }

  public async isPaused(): Promise<boolean> {
    return this.queue.isPaused();
  }

  public async getWaitingCount(): Promise<number> {
    return this.queue.getWaitingCount();
  }

  public async getActiveCount(): Promise<number> {
    return this.queue.getActiveCount();
  }

  public async getCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: boolean;
  }> {
    const [counts, paused] = await Promise.all([
      this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      this.queue.isPaused(),
    ]);
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      paused,
    };
  }

  public async close(): Promise<void> {
    await this.queue.close();
  }

}
