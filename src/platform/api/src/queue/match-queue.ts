import { createHash } from 'node:crypto';

import { Queue } from 'bullmq';
import { MATCH_QUEUE_NAME, validateMatchJob, type MatchJobV1 } from '@ott/job-contract';
import { createRedisConnection } from './redis-connection.ts';

export { MATCH_QUEUE_NAME } from '@ott/job-contract';

export interface MatchQueueOptions {
  readonly redisUrl: string;
  readonly queueName?: string;
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

  public async enqueue(job: MatchJobV1): Promise<EnqueuedMatch> {
    if (!validateMatchJob(job).ok) throw new Error('MATCH_JOB_INVALID');
    const jobId = `match-${job.matchId}`;
    const existing = await this.queue.getJob(jobId) as QueueJob | undefined;
    if (existing !== undefined) {
      if (payloadHash(existing.data) !== payloadHash(job)) {
        throw new Error('MATCH_IDEMPOTENCY_CONFLICT');
      }
      return { jobId };
    }

    await this.queue.add('run-match', job, { jobId });
    // Re-read after add to detect a concurrent producer that won this ID.
    const created = await this.queue.getJob(jobId) as QueueJob | undefined;
    if (created === undefined) throw new Error('MATCH_JOB_ENQUEUE_FAILED');
    if (payloadHash(created.data) !== payloadHash(job)) {
      throw new Error('MATCH_IDEMPOTENCY_CONFLICT');
    }
    return { jobId };
  }

  public async close(): Promise<void> {
    await this.queue.close();
  }

}
