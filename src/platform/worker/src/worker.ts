import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { createHash } from 'node:crypto';
import { DEAD_LETTER_QUEUE_NAME, MATCH_QUEUE_NAME, validateMatchJob, type MatchJobV1 } from '@ott/job-contract';
import { Redis } from 'ioredis';

export interface MatchWorkerLogger {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
  error(fields: Readonly<Record<string, unknown>>, message: string): void;
}

export interface MatchWorkerAttemptContext {
  readonly attemptNumber: number;
  readonly maxAttempts: number;
}

export interface MatchWorkerOptions {
  readonly redisUrl: string;
  readonly processMatch: (job: MatchJobV1, attempt: MatchWorkerAttemptContext) => Promise<void>;
  readonly logger: MatchWorkerLogger;
  readonly queueName?: string;
  readonly deadLetterQueueName?: string;
  readonly attempts?: number;
}

interface DeadLetterJob {
  readonly match?: MatchJobV1;
  readonly messageHash?: string;
  readonly errorCode: string;
  readonly attemptsMade: number;
  readonly failedAt: string;
}

function stableErrorCode(error: unknown): string {
  return error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
    ? error.message
    : 'MATCH_WORKER_FAILED';
}

async function persistDeadLetter(
  deadLetters: Queue<DeadLetterJob>,
  deadLetterId: string,
  deadLetter: DeadLetterJob,
): Promise<void> {
  if (await deadLetters.getJob(deadLetterId) === undefined) {
    await deadLetters.add('dead-match', deadLetter, { jobId: deadLetterId });
  }
}

/** Creates a BullMQ worker with strict payload validation, retries, DLQ, and drain-on-close. */
export function createMatchWorker(options: MatchWorkerOptions): {
  readonly worker: Worker<MatchJobV1>;
  close(): Promise<void>;
} {
  const connection = new Redis(options.redisUrl, { maxRetriesPerRequest: null });
  const deadLetters = new Queue<DeadLetterJob>(options.deadLetterQueueName ?? DEAD_LETTER_QUEUE_NAME, {
    connection: new Redis(options.redisUrl, { maxRetriesPerRequest: null }),
    defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
  });
  const worker = new Worker<MatchJobV1>(options.queueName ?? MATCH_QUEUE_NAME, async (job: Job<MatchJobV1>) => {
    const validation = validateMatchJob(job.data);
    if (!validation.ok) {
      options.logger.error({ event: 'match_job_invalid', errorCode: 'MATCH_JOB_INVALID' }, 'Rejected invalid match job');
      const messageHash = createHash('sha256').update(JSON.stringify(job.data) ?? 'null').digest('hex');
      try {
        await persistDeadLetter(deadLetters, `invalid-${messageHash}`, {
          messageHash,
          errorCode: 'MATCH_JOB_INVALID',
          attemptsMade: job.attemptsMade + 1,
          failedAt: new Date().toISOString(),
        });
      } catch {
        options.logger.error({ event: 'match_dead_letter_failed', errorCode: 'DEAD_LETTER_PERSIST_FAILED' }, 'Could not persist invalid job dead letter');
      }
      throw new UnrecoverableError('MATCH_JOB_INVALID');
    }
    options.logger.info({ event: 'match_job_started', matchId: job.data.matchId, attempt: job.attemptsMade + 1 }, 'Match job started');
    try {
      await options.processMatch(validation.value, {
        attemptNumber: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? options.attempts ?? 3,
      });
    } catch (error) {
      const attempts = job.opts.attempts ?? options.attempts ?? 3;
      if (job.attemptsMade + 1 >= attempts) {
        const errorCode = stableErrorCode(error);
        try {
          await persistDeadLetter(deadLetters, `match-${job.data.matchId}`, {
            match: job.data,
            errorCode,
            attemptsMade: job.attemptsMade + 1,
            failedAt: new Date().toISOString(),
          });
        } catch (deadLetterError) {
          options.logger.error({ event: 'match_dead_letter_failed', matchId: job.data.matchId, errorCode: 'DEAD_LETTER_PERSIST_FAILED' }, 'Could not persist dead letter');
        }
      }
      throw error;
    }
    options.logger.info({ event: 'match_job_completed', matchId: job.data.matchId }, 'Match job completed');
  }, { connection, concurrency: 1 });

  worker.on('failed', (job, error) => {
    if (job === undefined) return;
    const validation = validateMatchJob(job.data);
    const errorCode = stableErrorCode(error);
    options.logger.warn({ event: 'match_job_failed', ...(validation.ok ? { matchId: validation.value.matchId } : {}), attemptsMade: job.attemptsMade, errorCode }, 'Match job attempt failed');
  });

  let closing: Promise<void> | undefined;
  return {
    worker,
    close: () => {
      closing ??= worker.close().then(async () => {
        await Promise.all([deadLetters.close(), connection.quit()]);
      });
      return closing;
    },
  };
}
