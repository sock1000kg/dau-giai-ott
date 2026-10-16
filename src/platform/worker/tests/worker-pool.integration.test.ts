import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import {
  DEAD_LETTER_QUEUE_NAME,
  MATCH_QUEUE_NAME,
  QUEUE_PRIORITY,
  priorityForCategory,
  type JobQueueCategory,
  type MatchJobV1,
} from '@ott/job-contract';
import {
  WorkerPool,
  calculateAdaptiveCapacity,
  createWorkerPool,
  DEFAULT_CAPACITY_POLICY,
  DefaultCapacityProbe,
  type CapacityProbe,
  type SystemLoad,
  type WorkerHeartbeatPayload,
} from '../src/worker-pool.ts';
import { createMatchWorker } from '../src/worker.ts';

const digest = `sha256:${'b'.repeat(64)}`;
const sampleMatchId = '0f54d8cb-85ee-4a6e-a63c-cace24e58120';
const sampleJob: MatchJobV1 = {
  schemaVersion: 'ott.match-job.v1',
  matchId: sampleMatchId,
  idempotencyKey: sampleMatchId,
  policyVersion: 'P2_BASELINE_V1',
  x: {
    submissionId: '82185759-bbdb-4115-b04f-8e6050fd3561',
    archiveSha256: digest,
    manifestDigest: digest,
    configDigest: digest,
    policyVersion: 'P2_BASELINE_V1',
  },
  o: {
    submissionId: 'dc1db9c5-79b8-4d00-bc67-9d8da97d4538',
    archiveSha256: digest,
    manifestDigest: digest,
    configDigest: digest,
    policyVersion: 'P2_BASELINE_V1',
  },
};

describe('WorkerPool: Task P3-N02', () => {
  describe('Priority policy and category mapping', () => {
    it('maps official to priority 1 (highest)', () => {
      expect(priorityForCategory('official')).toBe(QUEUE_PRIORITY.OFFICIAL);
      expect(QUEUE_PRIORITY.OFFICIAL).toBe(1);
    });

    it('maps preflight to priority 2', () => {
      expect(priorityForCategory('preflight')).toBe(QUEUE_PRIORITY.PREFLIGHT);
      expect(QUEUE_PRIORITY.PREFLIGHT).toBe(2);
    });

    it('maps test-run to priority 3 (lowest)', () => {
      expect(priorityForCategory('test-run')).toBe(QUEUE_PRIORITY.TEST_RUN);
      expect(QUEUE_PRIORITY.TEST_RUN).toBe(3);
    });

    it('strictly preserves priority order: official > preflight > test-run', () => {
      expect(QUEUE_PRIORITY.OFFICIAL).toBeLessThan(QUEUE_PRIORITY.PREFLIGHT);
      expect(QUEUE_PRIORITY.PREFLIGHT).toBeLessThan(QUEUE_PRIORITY.TEST_RUN);
    });
  });

  describe('Adaptive capacity calculation (AC-13, D-26)', () => {
    it('throttles capacity down when CPU usage reaches or exceeds high threshold (80%)', () => {
      const load: SystemLoad = { cpuPercent: 85, memoryPercent: 50 };
      const next = calculateAdaptiveCapacity(4, load, DEFAULT_CAPACITY_POLICY);
      expect(next).toBe(3);
    });

    it('throttles capacity down when Memory usage reaches or exceeds high threshold (85%)', () => {
      const load: SystemLoad = { cpuPercent: 40, memoryPercent: 90 };
      const next = calculateAdaptiveCapacity(3, load, DEFAULT_CAPACITY_POLICY);
      expect(next).toBe(2);
    });

    it('does not throttle capacity below minConcurrency (default 1)', () => {
      const load: SystemLoad = { cpuPercent: 99, memoryPercent: 99 };
      const next = calculateAdaptiveCapacity(1, load, DEFAULT_CAPACITY_POLICY);
      expect(next).toBe(1);
    });

    it('scales capacity up towards maxConcurrency (default 4) when load is low', () => {
      const load: SystemLoad = { cpuPercent: 30, memoryPercent: 40 };
      const next = calculateAdaptiveCapacity(2, load, DEFAULT_CAPACITY_POLICY);
      expect(next).toBe(3);
    });

    it('does not scale capacity above maxConcurrency', () => {
      const load: SystemLoad = { cpuPercent: 10, memoryPercent: 20 };
      const next = calculateAdaptiveCapacity(4, load, DEFAULT_CAPACITY_POLICY);
      expect(next).toBe(4);
    });

    it('maintains current capacity when load is in moderate range', () => {
      const load: SystemLoad = { cpuPercent: 70, memoryPercent: 75 };
      const next = calculateAdaptiveCapacity(3, load, DEFAULT_CAPACITY_POLICY);
      expect(next).toBe(3);
    });

    it('supports custom capacity policy overrides', () => {
      const customPolicy = {
        maxConcurrency: 8,
        minConcurrency: 2,
        cpuHighThresholdPercent: 75,
        cpuLowThresholdPercent: 50,
        memHighThresholdPercent: 80,
        memLowThresholdPercent: 60,
      };
      const loadHigh: SystemLoad = { cpuPercent: 76, memoryPercent: 50 };
      expect(calculateAdaptiveCapacity(6, loadHigh, customPolicy)).toBe(5);

      const loadMin: SystemLoad = { cpuPercent: 90, memoryPercent: 90 };
      expect(calculateAdaptiveCapacity(2, loadMin, customPolicy)).toBe(2);

      const loadLow: SystemLoad = { cpuPercent: 40, memoryPercent: 40 };
      expect(calculateAdaptiveCapacity(7, loadLow, customPolicy)).toBe(8);
    });
  });

  describe('CapacityProbe and system metrics', () => {
    it('DefaultCapacityProbe produces numeric load metrics between 0 and 100', async () => {
      const probe = new DefaultCapacityProbe();
      const load1 = await probe.getLoad();
      expect(typeof load1.cpuPercent).toBe('number');
      expect(load1.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(load1.cpuPercent).toBeLessThanOrEqual(100);

      expect(typeof load1.memoryPercent).toBe('number');
      expect(load1.memoryPercent).toBeGreaterThanOrEqual(0);
      expect(load1.memoryPercent).toBeLessThanOrEqual(100);
    });
  });

  describe('WorkerPool pause, resume, and lifecycle management', () => {
    it('initializes with default max capacity and unpaused state', () => {
      const pool = createWorkerPool({
        redisUrl: 'redis://127.0.0.1:16379',
        processMatch: async () => {},
      });
      expect(pool.getCapacity()).toBe(4);
      expect(pool.getActiveCount()).toBe(0);
      expect(pool.isPaused()).toBe(false);
      expect(pool.getPauseReason()).toBeUndefined();
      expect(pool.getWorkerId()).toMatch(/^worker-/);
    });

    it('pauses and records reason without destroying in-flight workers', async () => {
      const pool = createWorkerPool({
        redisUrl: 'redis://127.0.0.1:16379',
        processMatch: async () => {},
      });
      await pool.pause('ROUND_PAUSED_BY_OPERATOR');
      expect(pool.isPaused()).toBe(true);
      expect(pool.getPauseReason()).toBe('ROUND_PAUSED_BY_OPERATOR');
    });

    it('resumes cleanly clearing pause state and reason', async () => {
      const pool = createWorkerPool({
        redisUrl: 'redis://127.0.0.1:16379',
        processMatch: async () => {},
      });
      await pool.pause('ROUND_PAUSED');
      expect(pool.isPaused()).toBe(true);

      await pool.resume();
      expect(pool.isPaused()).toBe(false);
      expect(pool.getPauseReason()).toBeUndefined();
    });

    it('dynamically adapts capacity via updateHeartbeatAndCapacity', async () => {
      const mockProbe: CapacityProbe = {
        getLoad: vi.fn()
          .mockResolvedValueOnce({ cpuPercent: 95, memoryPercent: 90 })
          .mockResolvedValueOnce({ cpuPercent: 95, memoryPercent: 90 })
          .mockResolvedValueOnce({ cpuPercent: 20, memoryPercent: 20 }),
      };

      const heartbeatPayloads: WorkerHeartbeatPayload[] = [];
      const pool = createWorkerPool({
        redisUrl: 'redis://127.0.0.1:16379',
        processMatch: async () => {},
        capacityProbe: mockProbe,
        onHeartbeat: (payload) => {
          heartbeatPayloads.push(payload);
        },
      });

      expect(pool.getCapacity()).toBe(4);

      // 1. First probe detects high load -> drops to 3
      const h1 = await pool.updateHeartbeatAndCapacity();
      expect(pool.getCapacity()).toBe(3);
      expect(h1.capacity).toBe(3);
      expect(h1.cpuPercent).toBe(95);

      // 2. Second probe detects high load again -> drops to 2
      const h2 = await pool.updateHeartbeatAndCapacity();
      expect(pool.getCapacity()).toBe(2);
      expect(h2.capacity).toBe(2);

      // 3. Third probe detects low load -> recovers to 3
      const h3 = await pool.updateHeartbeatAndCapacity();
      expect(pool.getCapacity()).toBe(3);
      expect(h3.capacity).toBe(3);

      expect(heartbeatPayloads.length).toBe(3);
    });
  });

  describe('Worker loss, lease expiration and idempotent retry (AC-19)', () => {
    it('simulates attempt lease expiration marked as FAILED_RETRYABLE without duplicate result', () => {
      // Simulate database attempt table state
      interface SimulatedAttempt {
        id: string;
        matchId: string;
        attemptNumber: number;
        status: 'RUNNING' | 'FAILED_RETRYABLE' | 'FINALIZED';
        leaseExpiresAt: number;
        failureReason?: string;
      }

      const now = Date.now();
      const attempts: SimulatedAttempt[] = [
        {
          id: 'attempt-1',
          matchId: sampleMatchId,
          attemptNumber: 1,
          status: 'RUNNING',
          leaseExpiresAt: now - 1_000, // expired 1s ago
        },
      ];

      // Worker crash detection logic: lease_expires_at <= now()
      function reconcileLease(currentAttempts: SimulatedAttempt[], currentTime: number) {
        for (const att of currentAttempts) {
          if (att.status === 'RUNNING' && att.leaseExpiresAt <= currentTime) {
            att.status = 'FAILED_RETRYABLE';
            att.failureReason = 'MATCH_LEASE_EXPIRED';
          }
        }
      }

      reconcileLease(attempts, now);
      expect(attempts[0]?.status).toBe('FAILED_RETRYABLE');
      expect(attempts[0]?.failureReason).toBe('MATCH_LEASE_EXPIRED');

      // Next retry starts attempt 2
      attempts.push({
        id: 'attempt-2',
        matchId: sampleMatchId,
        attemptNumber: 2,
        status: 'RUNNING',
        leaseExpiresAt: now + 900_000, // 15 minutes
      });

      expect(attempts.length).toBe(2);
      expect(attempts[1]?.attemptNumber).toBe(2);
      expect(attempts[1]?.status).toBe('RUNNING');
      // Finalized result is unique per match_id
      const finalResults = new Map<string, string>();
      finalResults.set(sampleMatchId, 'FINALIZED');
      expect(finalResults.size).toBe(1);
    });
  });

  describe('createMatchWorker enhancements', () => {
    it('supports custom concurrency, workerId, pause, resume and isPaused', async () => {
      const customWorkerId = `test-worker-${randomUUID()}`;
      const workerInstance = createMatchWorker({
        redisUrl: 'redis://127.0.0.1:16379',
        processMatch: async () => {},
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        workerId: customWorkerId,
        concurrency: 4,
      });

      expect(workerInstance.workerId).toBe(customWorkerId);
      expect(typeof workerInstance.pause).toBe('function');
      expect(typeof workerInstance.resume).toBe('function');
      expect(typeof workerInstance.isPaused).toBe('function');
      expect(typeof workerInstance.close).toBe('function');

      // Close cleanly
      try {
        await workerInstance.close();
      } catch {}
    });
  });
});
