import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import * as os from 'node:os';
import {
  DEAD_LETTER_QUEUE_NAME,
  MATCH_QUEUE_NAME,
  QUEUE_PRIORITY,
  validateMatchJob,
  type JobQueueCategory,
  type MatchJobV1,
  type QueuePriority,
} from '@ott/job-contract';
import { Redis } from 'ioredis';
import type { MatchWorkerAttemptContext, MatchWorkerLogger } from './worker.ts';

export interface SystemLoad {
  readonly cpuPercent: number;
  readonly memoryPercent: number;
}

export interface CapacityProbe {
  getLoad(): Promise<SystemLoad>;
}

export class DefaultCapacityProbe implements CapacityProbe {
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastTime: number = 0;

  public async getLoad(): Promise<SystemLoad> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memoryPercent = totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0;

    const now = Date.now();
    const currentCpu = process.cpuUsage();
    let cpuPercent = 0;

    if (this.lastCpuUsage !== null && this.lastTime > 0) {
      const elapsedMs = now - this.lastTime;
      if (elapsedMs > 0) {
        const userDiffMs = (currentCpu.user - this.lastCpuUsage.user) / 1000;
        const sysDiffMs = (currentCpu.system - this.lastCpuUsage.system) / 1000;
        const totalCpuMs = userDiffMs + sysDiffMs;
        const numCores = os.cpus().length || 1;
        cpuPercent = Math.min(100, Math.round((totalCpuMs / (elapsedMs * numCores)) * 100));
      }
    }

    this.lastCpuUsage = currentCpu;
    this.lastTime = now;

    return { cpuPercent, memoryPercent };
  }
}

export interface CapacityPolicy {
  readonly maxConcurrency: number;
  readonly minConcurrency: number;
  readonly cpuHighThresholdPercent: number;
  readonly cpuLowThresholdPercent: number;
  readonly memHighThresholdPercent: number;
  readonly memLowThresholdPercent: number;
}

export const DEFAULT_CAPACITY_POLICY: CapacityPolicy = {
  maxConcurrency: 4,
  minConcurrency: 1,
  cpuHighThresholdPercent: 80,
  cpuLowThresholdPercent: 60,
  memHighThresholdPercent: 85,
  memLowThresholdPercent: 70,
};

export function calculateAdaptiveCapacity(
  currentCapacity: number,
  load: SystemLoad,
  policy: CapacityPolicy = DEFAULT_CAPACITY_POLICY,
): number {
  if (load.cpuPercent >= policy.cpuHighThresholdPercent || load.memoryPercent >= policy.memHighThresholdPercent) {
    return Math.max(policy.minConcurrency, currentCapacity - 1);
  }
  if (load.cpuPercent < policy.cpuLowThresholdPercent && load.memoryPercent < policy.memLowThresholdPercent) {
    return Math.min(policy.maxConcurrency, currentCapacity + 1);
  }
  return currentCapacity;
}

export interface WorkerHeartbeatPayload {
  readonly workerId: string;
  readonly capacity: number;
  readonly activeCount: number;
  readonly cpuPercent: number;
  readonly memoryPercent: number;
  readonly paused: boolean;
  readonly timestamp: number;
}

export interface WorkerPoolOptions {
  readonly redisUrl: string;
  readonly processMatch: (job: MatchJobV1, attempt: MatchWorkerAttemptContext) => Promise<void>;
  readonly logger?: MatchWorkerLogger | undefined;
  readonly workerId?: string | undefined;
  readonly queueName?: string | undefined;
  readonly deadLetterQueueName?: string | undefined;
  readonly attempts?: number | undefined;
  readonly capacityPolicy?: Partial<CapacityPolicy> | undefined;
  readonly capacityProbe?: CapacityProbe | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly heartbeatTtlSeconds?: number | undefined;
  readonly onHeartbeat?: ((payload: WorkerHeartbeatPayload) => Promise<void> | void) | undefined;
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

export class WorkerPool {
  private readonly workerId: string;
  private readonly redisUrl: string;
  private readonly queueName: string;
  private readonly deadLetterQueueName: string;
  private readonly processMatch: (job: MatchJobV1, attempt: MatchWorkerAttemptContext) => Promise<void>;
  private readonly logger: MatchWorkerLogger;
  private readonly capacityPolicy: CapacityPolicy;
  private readonly capacityProbe: CapacityProbe;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTtlSeconds: number;
  private readonly onHeartbeat?: ((payload: WorkerHeartbeatPayload) => Promise<void> | void) | undefined;
  private readonly attempts: number;

  private currentCapacity: number;
  private activeJobsCount: number = 0;
  private paused: boolean = false;
  private pauseReason?: string | undefined;

  private worker?: Worker<MatchJobV1> | undefined;
  private queue?: Queue<MatchJobV1> | undefined;
  private deadLetters?: Queue<DeadLetterJob> | undefined;
  private redisConnection?: Redis | undefined;
  private heartbeatTimer?: NodeJS.Timeout | undefined;
  private closing?: Promise<void> | undefined;

  public constructor(options: WorkerPoolOptions) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.redisUrl = options.redisUrl;
    this.queueName = options.queueName ?? MATCH_QUEUE_NAME;
    this.deadLetterQueueName = options.deadLetterQueueName ?? DEAD_LETTER_QUEUE_NAME;
    this.processMatch = options.processMatch;
    this.logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    this.capacityPolicy = {
      ...DEFAULT_CAPACITY_POLICY,
      ...(options.capacityPolicy ?? {}),
    };
    this.capacityProbe = options.capacityProbe ?? new DefaultCapacityProbe();
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000;
    this.heartbeatTtlSeconds = options.heartbeatTtlSeconds ?? 15;
    this.onHeartbeat = options.onHeartbeat;
    this.attempts = options.attempts ?? 3;
    this.currentCapacity = this.capacityPolicy.maxConcurrency;
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  public getCapacity(): number {
    return this.currentCapacity;
  }

  public getActiveCount(): number {
    return this.activeJobsCount;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public getPauseReason(): string | undefined {
    return this.pauseReason;
  }

  public async start(): Promise<void> {
    const connection = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.redisConnection = connection;

    this.queue = new Queue<MatchJobV1>(this.queueName, {
      connection: new Redis(this.redisUrl, { maxRetriesPerRequest: null }),
    });

    this.deadLetters = new Queue<DeadLetterJob>(this.deadLetterQueueName, {
      connection: new Redis(this.redisUrl, { maxRetriesPerRequest: null }),
      defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
    });

    // Start with maxConcurrency on the underlying BullMQ worker.
    // The pool dynamically throttles admission via internal capacity gates.
    this.worker = new Worker<MatchJobV1>(
      this.queueName,
      async (job: Job<MatchJobV1>) => {
        return this.handleJob(job);
      },
      {
        connection: new Redis(this.redisUrl, { maxRetriesPerRequest: null }),
        concurrency: this.capacityPolicy.maxConcurrency,
      },
    );

    this.worker.on('failed', (job, error) => {
      if (job === undefined) return;
      const validation = validateMatchJob(job.data);
      const errorCode = stableErrorCode(error);
      this.logger.warn(
        {
          event: 'match_job_failed',
          ...(validation.ok ? { matchId: validation.value.matchId } : {}),
          attemptsMade: job.attemptsMade,
          errorCode,
        },
        'Match job attempt failed',
      );
    });

    // Initial heartbeat
    await this.sendHeartbeat();

    // Start periodic heartbeat and capacity probe
    this.heartbeatTimer = setInterval(() => {
      void this.updateHeartbeatAndCapacity();
    }, this.heartbeatIntervalMs);
  }

  private async handleJob(job: Job<MatchJobV1>): Promise<void> {
    // 1. Check if paused: in-flight jobs complete, but no new jobs should proceed
    if (this.paused) {
      // Delay job until resumed
      await job.moveToDelayed(Date.now() + 1_000, job.token);
      return;
    }

    // 2. Strict Priority Guard: Lower priority jobs must NOT run when official jobs are waiting
    const jobPriority = job.opts.priority ?? QUEUE_PRIORITY.OFFICIAL;
    if (jobPriority > QUEUE_PRIORITY.OFFICIAL && this.queue) {
      const waitingJobs = await this.queue.getJobs(['waiting'], 0, 50);
      const hasOfficialWaiting = waitingJobs.some(
        (w) => (w.opts.priority ?? QUEUE_PRIORITY.OFFICIAL) === QUEUE_PRIORITY.OFFICIAL,
      );
      if (hasOfficialWaiting) {
        // Yield to official job
        this.logger.info(
          { event: 'lower_priority_job_yielded', jobId: job.id, priority: jobPriority },
          'Lower priority job yielded to waiting official job',
        );
        await job.moveToDelayed(Date.now() + 500, job.token);
        return;
      }
    }

    // 3. Adaptive Concurrency Gate: Throttle if at or above current capacity
    if (this.activeJobsCount >= this.currentCapacity) {
      // Re-delay job briefly until capacity opens up
      await job.moveToDelayed(Date.now() + 500, job.token);
      return;
    }

    // Admit job
    this.activeJobsCount++;
    try {
      const validation = validateMatchJob(job.data);
      if (!validation.ok) {
        this.logger.error(
          { event: 'match_job_invalid', errorCode: 'MATCH_JOB_INVALID' },
          'Rejected invalid match job',
        );
        const messageHash = createHash('sha256').update(JSON.stringify(job.data) ?? 'null').digest('hex');
        if (this.deadLetters) {
          try {
            await this.persistDeadLetter(`invalid-${messageHash}`, {
              messageHash,
              errorCode: 'MATCH_JOB_INVALID',
              attemptsMade: job.attemptsMade + 1,
              failedAt: new Date().toISOString(),
            });
          } catch {
            this.logger.error(
              { event: 'match_dead_letter_failed', errorCode: 'DEAD_LETTER_PERSIST_FAILED' },
              'Could not persist invalid job dead letter',
            );
          }
        }
        throw new UnrecoverableError('MATCH_JOB_INVALID');
      }

      this.logger.info(
        { event: 'match_job_started', matchId: job.data.matchId, attempt: job.attemptsMade + 1, workerId: this.workerId },
        'Match job started',
      );

      try {
        await this.processMatch(validation.value, {
          attemptNumber: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? this.attempts,
        });
      } catch (error) {
        const attempts = job.opts.attempts ?? this.attempts;
        if (job.attemptsMade + 1 >= attempts && this.deadLetters) {
          const errorCode = stableErrorCode(error);
          try {
            await this.persistDeadLetter(`match-${job.data.matchId}`, {
              match: job.data,
              errorCode,
              attemptsMade: job.attemptsMade + 1,
              failedAt: new Date().toISOString(),
            });
          } catch {
            this.logger.error(
              { event: 'match_dead_letter_failed', matchId: job.data.matchId, errorCode: 'DEAD_LETTER_PERSIST_FAILED' },
              'Could not persist dead letter',
            );
          }
        }
        throw error;
      }

      this.logger.info(
        { event: 'match_job_completed', matchId: job.data.matchId, workerId: this.workerId },
        'Match job completed',
      );
    } finally {
      this.activeJobsCount = Math.max(0, this.activeJobsCount - 1);
    }
  }

  private async persistDeadLetter(deadLetterId: string, deadLetter: DeadLetterJob): Promise<void> {
    if (!this.deadLetters) return;
    if ((await this.deadLetters.getJob(deadLetterId)) === undefined) {
      await this.deadLetters.add('dead-match', deadLetter, { jobId: deadLetterId });
    }
  }

  public async pause(reason?: string): Promise<void> {
    this.paused = true;
    this.pauseReason = reason;
    if (this.worker) {
      await this.worker.pause(true);
    }
    this.logger.info(
      { event: 'worker_pool_paused', workerId: this.workerId, reason },
      'Worker pool paused (in-flight jobs will complete)',
    );
    await this.sendHeartbeat();
  }

  public async resume(): Promise<void> {
    this.paused = false;
    this.pauseReason = undefined;
    if (this.worker) {
      this.worker.resume();
    }
    this.logger.info(
      { event: 'worker_pool_resumed', workerId: this.workerId },
      'Worker pool resumed',
    );
    await this.sendHeartbeat();
  }

  public async updateHeartbeatAndCapacity(): Promise<WorkerHeartbeatPayload> {
    const load = await this.capacityProbe.getLoad();
    this.currentCapacity = calculateAdaptiveCapacity(this.currentCapacity, load, this.capacityPolicy);
    return this.sendHeartbeat(load);
  }

  private async sendHeartbeat(systemLoad?: SystemLoad): Promise<WorkerHeartbeatPayload> {
    const load = systemLoad ?? (await this.capacityProbe.getLoad());
    const payload: WorkerHeartbeatPayload = {
      workerId: this.workerId,
      capacity: this.currentCapacity,
      activeCount: this.activeJobsCount,
      cpuPercent: load.cpuPercent,
      memoryPercent: load.memoryPercent,
      paused: this.paused,
      timestamp: Date.now(),
    };

    if (this.redisConnection) {
      try {
        const key = `ott:worker:heartbeat:${this.workerId}`;
        await this.redisConnection.set(key, JSON.stringify(payload), 'EX', this.heartbeatTtlSeconds);
        await this.redisConnection.sadd('ott:worker:active-set', this.workerId);
      } catch (err) {
        this.logger.warn({ event: 'heartbeat_write_failed', error: String(err) }, 'Failed to write heartbeat to Redis');
      }
    }

    if (this.onHeartbeat) {
      try {
        await this.onHeartbeat(payload);
      } catch (err) {
        this.logger.warn({ event: 'on_heartbeat_failed', error: String(err) }, 'Heartbeat callback failed');
      }
    }

    return payload;
  }

  public async close(): Promise<void> {
    this.closing ??= (async () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }

      if (this.worker) {
        await this.worker.close();
      }

      if (this.redisConnection) {
        try {
          await this.redisConnection.del(`ott:worker:heartbeat:${this.workerId}`);
          await this.redisConnection.srem('ott:worker:active-set', this.workerId);
        } catch {}
      }

      await Promise.all([
        this.queue?.close(),
        this.deadLetters?.close(),
        this.redisConnection?.quit(),
      ]);
    })();

    return this.closing;
  }
}

export function createWorkerPool(options: WorkerPoolOptions): WorkerPool {
  return new WorkerPool(options);
}
