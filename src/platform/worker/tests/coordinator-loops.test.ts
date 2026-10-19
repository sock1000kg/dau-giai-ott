import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CoordinatorLoopRunner,
  CoordinatorMetrics,
  runDispatchIteration,
  runPreflightIteration,
  runRetentionIteration,
  runSettleIteration,
  SETTLE_CANDIDATE_SERIES_SQL,
  type LoopDefinition,
} from '../src/index.ts';

describe('Coordinator Loops (P2-T32)', () => {
  describe('Loop Scheduler (Non-overlapping, Isolation & Timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('fires each loop at its configured interval', async () => {
      const metrics = new CoordinatorMetrics();
      const loop1Runs: number[] = [];
      const loop2Runs: number[] = [];

      const loop1: LoopDefinition = {
        name: 'dispatch',
        intervalMs: 1000,
        run: async () => {
          loop1Runs.push(Date.now());
        },
      };

      const loop2: LoopDefinition = {
        name: 'settle',
        intervalMs: 2500,
        run: async () => {
          loop2Runs.push(Date.now());
        },
      };

      const runner = new CoordinatorLoopRunner({
        loops: [loop1, loop2],
        metrics,
      });

      runner.resume();
      // Tick 0: immediate start
      await vi.advanceTimersByTimeAsync(0);
      expect(loop1Runs.length).toBe(1);
      expect(loop2Runs.length).toBe(1);

      // Advance by 1000ms: loop1 runs again
      await vi.advanceTimersByTimeAsync(1000);
      expect(loop1Runs.length).toBe(2);
      expect(loop2Runs.length).toBe(1);

      // Advance by 1500ms (total 2500ms): loop1 ran at 2000ms, loop2 runs at 2500ms
      await vi.advanceTimersByTimeAsync(1500);
      expect(loop1Runs.length).toBe(3);
      expect(loop2Runs.length).toBe(2);

      await runner.stop(1000);
    });

    it('prevents overlapping iterations of the same loop (Mutation 1 guard)', async () => {
      const metrics = new CoordinatorMetrics();
      let concurrentExecutions = 0;
      let maxConcurrency = 0;

      let resolveSlowRun: (() => void) | undefined;
      const slowPromise = new Promise<void>((resolve) => {
        resolveSlowRun = resolve;
      });

      const loop: LoopDefinition = {
        name: 'dispatch',
        intervalMs: 500,
        run: async () => {
          concurrentExecutions++;
          if (concurrentExecutions > maxConcurrency) {
            maxConcurrency = concurrentExecutions;
          }
          await slowPromise;
          concurrentExecutions--;
        },
      };

      const runner = new CoordinatorLoopRunner({
        loops: [loop],
        metrics,
      });

      runner.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(concurrentExecutions).toBe(1);

      // Try triggering a concurrent iteration while the first is still in flight
      await runner.triggerIteration('dispatch');
      await vi.advanceTimersByTimeAsync(500);

      // Max concurrent executions MUST NEVER exceed 1
      expect(maxConcurrency).toBe(1);
      expect(concurrentExecutions).toBe(1);

      // Now resolve the in-flight execution
      resolveSlowRun!();
      await vi.advanceTimersByTimeAsync(0);
      expect(concurrentExecutions).toBe(0);

      await runner.stop(1000);
    });

    it('isolates errors so a failure in one loop does not stop other loops (Mutation 2 guard)', async () => {
      const metrics = new CoordinatorMetrics();
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const failingLoop: LoopDefinition = {
        name: 'preflight',
        intervalMs: 1000,
        run: async () => {
          throw new Error('PREFLIGHT_CRASH_TEST');
        },
      };

      let healthyLoopRuns = 0;
      const healthyLoop: LoopDefinition = {
        name: 'dispatch',
        intervalMs: 1000,
        run: async () => {
          healthyLoopRuns++;
        },
      };

      const runner = new CoordinatorLoopRunner({
        loops: [failingLoop, healthyLoop],
        metrics,
        logger,
      });

      runner.resume();
      await vi.advanceTimersByTimeAsync(0);

      expect(metrics.getErrors('preflight')).toBe(1);
      expect(metrics.getIterations('preflight')).toBe(1);
      expect(healthyLoopRuns).toBe(1);
      expect(logger.error).toHaveBeenCalledWith('coordinator loop error', { loop: 'preflight' });

      // Advance by another tick: healthy loop MUST keep running despite errors in preflight
      await vi.advanceTimersByTimeAsync(1000);
      expect(metrics.getErrors('preflight')).toBe(2);
      expect(healthyLoopRuns).toBe(2);

      await runner.stop(1000);
    });

    it('skips loop iterations when stopping and pauses during standby', async () => {
      const metrics = new CoordinatorMetrics();
      let runs = 0;

      const loop: LoopDefinition = {
        name: 'dispatch',
        intervalMs: 1000,
        run: async () => {
          runs++;
        },
      };

      const runner = new CoordinatorLoopRunner({
        loops: [loop],
        metrics,
      });

      // While paused (standby), no loops run
      await vi.advanceTimersByTimeAsync(5000);
      expect(runs).toBe(0);

      runner.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs).toBe(1);

      runner.pause();
      await vi.advanceTimersByTimeAsync(5000);
      expect(runs).toBe(1); // paused: no more runs

      runner.resume();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs).toBe(2);

      await runner.stop(1000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(runs).toBe(2); // stopped: no more runs
    });
  });

  describe('Preflight Classification & Resilience (AC-3 & Mutation 3 guard)', () => {
    it('skips the preflight batch when Docker dependency is down', async () => {
      const mockDb = { query: vi.fn() } as any;
      const mockStorage = {} as any;
      const preflightFn = vi.fn();
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const processed = await runPreflightIteration({
        database: mockDb,
        storage: mockStorage,
        batch: 2,
        requireDocker: true,
        checkDocker: vi.fn().mockResolvedValue(false), // Docker down!
        checkS3: vi.fn().mockResolvedValue(true),
        preflightSubmission: preflightFn,
        logger,
      });

      expect(processed).toBe(0);
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(preflightFn).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'preflight dependencies unavailable, skipping batch',
        { dependency: 'docker' },
      );
    });

    it('skips the preflight batch when S3 dependency is down', async () => {
      const mockDb = { query: vi.fn() } as any;
      const mockStorage = {} as any;
      const preflightFn = vi.fn();
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const processed = await runPreflightIteration({
        database: mockDb,
        storage: mockStorage,
        batch: 2,
        requireDocker: true,
        checkDocker: vi.fn().mockResolvedValue(true),
        checkS3: vi.fn().mockResolvedValue(false), // S3 down!
        preflightSubmission: preflightFn,
        logger,
      });

      expect(processed).toBe(0);
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(preflightFn).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        'preflight dependencies unavailable, skipping batch',
        { dependency: 's3' },
      );
    });

    it('passes dockerReachable bound to checkDocker and configured dockerSocketPath to preflightSubmission', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'sub-options-check' }] }),
      } as any;
      const mockStorage = {} as any;

      const configs = [
        { socket: '/var/run/docker.sock' },
        { socket: '/custom/docker.sock' },
      ];

      for (const cfg of configs) {
        const capturedOptions: any[] = [];
        const fakeCheckDocker = vi.fn().mockResolvedValue(true);
        const fakePreflight = vi.fn().mockImplementation(async (opts) => {
          capturedOptions.push(opts);
          return { submissionId: opts.submissionId, status: 'ACTIVE', replayed: false };
        });

        await runPreflightIteration({
          database: mockDb,
          storage: mockStorage,
          batch: 1,
          requireDocker: false,
          checkDocker: fakeCheckDocker,
          checkS3: vi.fn().mockResolvedValue(true),
          dockerSocketPath: cfg.socket,
          preflightSubmission: fakePreflight,
        });

        expect(capturedOptions.length).toBe(1);
        expect(capturedOptions[0].dockerSocketPath).toBe(cfg.socket);
        expect(typeof capturedOptions[0].dockerReachable).toBe('function');
        await capturedOptions[0].dockerReachable();
        expect(fakeCheckDocker).toHaveBeenCalledTimes(1);
      }
    });

    it('models real contract for bot fault vs infrastructure fault (Mutation 3 guard)', async () => {
      // (a) Bot fault: fake marks row INVALID and throws PREFLIGHT_FAILED => coordinator logs rejection,
      // NO kind="infra" increment, NO backoff (next iteration processes normally)
      {
        let submissionStatus = 'PREFLIGHT';
        const mockDb = {
          query: vi.fn().mockResolvedValue({ rows: [{ id: 'sub-bot-fault' }] }),
        } as any;
        const mockStorage = {} as any;
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const metrics = new CoordinatorMetrics();
        const backoffState = { skipCount: 0 };

        const fakeBotFaultPreflight = vi.fn().mockImplementation(async () => {
          submissionStatus = 'INVALID';
          throw new Error('PREFLIGHT_FAILED');
        });

        const processed = await runPreflightIteration({
          database: mockDb,
          storage: mockStorage,
          batch: 1,
          requireDocker: false,
          checkDocker: vi.fn().mockResolvedValue(true),
          checkS3: vi.fn().mockResolvedValue(true),
          preflightSubmission: fakeBotFaultPreflight,
          logger,
          metrics,
          backoffState,
        });

        expect(processed).toBe(0);
        expect(fakeBotFaultPreflight).toHaveBeenCalledTimes(1);
        expect(submissionStatus).toBe('INVALID');
        expect(logger.info).toHaveBeenCalledWith(
          'preflight submission rejected',
          { submissionId: 'sub-bot-fault', reason: 'PREFLIGHT_FAILED' },
        );
        expect(metrics.getErrors('preflight', { kind: 'infra' })).toBe(0);
        expect(backoffState.skipCount).toBe(0);

        // Next iteration runs normally without backoff
        await runPreflightIteration({
          database: mockDb,
          storage: mockStorage,
          batch: 1,
          requireDocker: false,
          checkDocker: vi.fn().mockResolvedValue(true),
          checkS3: vi.fn().mockResolvedValue(true),
          preflightSubmission: fakeBotFaultPreflight,
          logger,
          metrics,
          backoffState,
        });
        expect(fakeBotFaultPreflight).toHaveBeenCalledTimes(2);
      }

      // (b) Infra fault: fake throws PREFLIGHT_INFRA_DOCKER WITHOUT marking row => row stays PREFLIGHT,
      // warning and kind="infra" error fire, next 2 iterations skip, 3rd runs
      {
        let submissionStatus = 'PREFLIGHT';
        const mockDb = {
          query: vi.fn().mockResolvedValue({ rows: [{ id: 'sub-infra-fault' }] }),
        } as any;
        const mockStorage = {} as any;
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const metrics = new CoordinatorMetrics();
        const backoffState = { skipCount: 0 };

        const fakeInfraPreflight = vi.fn().mockImplementation(async () => {
          // Does NOT mark submission INVALID
          throw new Error('PREFLIGHT_INFRA_DOCKER');
        });

        // Iteration 1: triggers infra error and engages 2-iteration backoff
        const processed1 = await runPreflightIteration({
          database: mockDb,
          storage: mockStorage,
          batch: 1,
          requireDocker: false,
          checkDocker: vi.fn().mockResolvedValue(true),
          checkS3: vi.fn().mockResolvedValue(true),
          preflightSubmission: fakeInfraPreflight,
          logger,
          metrics,
          backoffState,
        });

        expect(processed1).toBe(0);
        expect(fakeInfraPreflight).toHaveBeenCalledTimes(1);
        expect(submissionStatus).toBe('PREFLIGHT'); // MUST remain PREFLIGHT!
        expect(logger.warn).toHaveBeenCalledWith(
          'preflight deferred: infrastructure unavailable',
          { loop: 'preflight', reason: 'PREFLIGHT_INFRA_DOCKER' },
        );
        expect(metrics.getErrors('preflight', { kind: 'infra' })).toBe(1);
        expect(backoffState.skipCount).toBe(2);

        // Iteration 2: skipped due to backoff (skipCount becomes 1, fake not called)
        const processed2 = await runPreflightIteration({
          database: mockDb,
          storage: mockStorage,
          batch: 1,
          requireDocker: false,
          checkDocker: vi.fn().mockResolvedValue(true),
          checkS3: vi.fn().mockResolvedValue(true),
          preflightSubmission: fakeInfraPreflight,
          logger,
          metrics,
          backoffState,
        });
        expect(processed2).toBe(0);
        expect(fakeInfraPreflight).toHaveBeenCalledTimes(1);
        expect(backoffState.skipCount).toBe(1);

        // Iteration 3: skipped due to backoff (skipCount becomes 0, fake not called)
        const processed3 = await runPreflightIteration({
          database: mockDb,
          storage: mockStorage,
          batch: 1,
          requireDocker: false,
          checkDocker: vi.fn().mockResolvedValue(true),
          checkS3: vi.fn().mockResolvedValue(true),
          preflightSubmission: fakeInfraPreflight,
          logger,
          metrics,
          backoffState,
        });
        expect(processed3).toBe(0);
        expect(fakeInfraPreflight).toHaveBeenCalledTimes(1);
        expect(backoffState.skipCount).toBe(0);

        // Iteration 4: runs again (backoff expired, fake is called)
        const processed4 = await runPreflightIteration({
          database: mockDb,
          storage: mockStorage,
          batch: 1,
          requireDocker: false,
          checkDocker: vi.fn().mockResolvedValue(true),
          checkS3: vi.fn().mockResolvedValue(true),
          preflightSubmission: fakeInfraPreflight,
          logger,
          metrics,
          backoffState,
        });
        expect(processed4).toBe(0);
        expect(fakeInfraPreflight).toHaveBeenCalledTimes(2);
        expect(metrics.getErrors('preflight', { kind: 'infra' })).toBe(2);
      }
    });

    it('processes active submissions and records bot rejections', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'sub-active' }, { id: 'sub-invalid' }],
        }),
      } as any;
      const mockStorage = {} as any;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const preflightFn = vi.fn().mockImplementation(async ({ submissionId }) => {
        if (submissionId === 'sub-active') {
          return { submissionId, status: 'ACTIVE', replayed: false };
        }
        throw new Error('PREFLIGHT_ENTRYPOINT_INVALID');
      });

      const processed = await runPreflightIteration({
        database: mockDb,
        storage: mockStorage,
        batch: 2,
        requireDocker: false,
        checkDocker: vi.fn().mockResolvedValue(true),
        checkS3: vi.fn().mockResolvedValue(true),
        preflightSubmission: preflightFn,
        logger,
      });

      expect(processed).toBe(1);
      expect(logger.info).toHaveBeenCalledWith(
        'preflight submission rejected',
        { submissionId: 'sub-invalid', reason: 'PREFLIGHT_ENTRYPOINT_INVALID' },
      );
    });

    it('recognizes PREFLIGHT_INFRA_DOCKER, logs fixed warning, increments kind="infra" error metric, and backs off for 2 iterations', async () => {
      let submissionStatus = 'PREFLIGHT';
      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM submissions')) {
            return { rows: [{ id: 'sub-docker-infra' }] };
          }
          if (sql.includes("UPDATE submissions SET status = 'INVALID'")) {
            submissionStatus = 'INVALID';
            return { rowCount: 1 };
          }
          return { rows: [] };
        }),
      } as any;
      const mockStorage = {} as any;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const metrics = new CoordinatorMetrics();
      const backoffState = { skipCount: 0 };

      const preflightFn = vi.fn().mockRejectedValue(new Error('PREFLIGHT_INFRA_DOCKER'));

      const deps = {
        database: mockDb,
        storage: mockStorage,
        batch: 2,
        requireDocker: false,
        checkDocker: vi.fn().mockResolvedValue(true),
        checkS3: vi.fn().mockResolvedValue(true),
        preflightSubmission: preflightFn,
        logger,
        metrics,
        backoffState,
      };

      // Iteration 1: encounters PREFLIGHT_INFRA_DOCKER
      const processed1 = await runPreflightIteration(deps);
      expect(processed1).toBe(0);
      expect(submissionStatus).toBe('PREFLIGHT');
      expect(logger.warn).toHaveBeenCalledWith(
        'preflight deferred: infrastructure unavailable',
        { loop: 'preflight', reason: 'PREFLIGHT_INFRA_DOCKER' },
      );
      expect(metrics.getErrors('preflight', { kind: 'infra' })).toBe(1);
      expect(metrics.scrape()).toContain('ott_coordinator_loop_errors_total{loop="preflight",kind="infra"} 1');
      expect(backoffState.skipCount).toBe(2);

      // Iteration 2: skipped due to backoff
      mockDb.query.mockClear();
      preflightFn.mockClear();
      const processed2 = await runPreflightIteration(deps);
      expect(processed2).toBe(0);
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(preflightFn).not.toHaveBeenCalled();
      expect(backoffState.skipCount).toBe(1);

      // Iteration 3: skipped due to backoff
      const processed3 = await runPreflightIteration(deps);
      expect(processed3).toBe(0);
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(preflightFn).not.toHaveBeenCalled();
      expect(backoffState.skipCount).toBe(0);

      // Iteration 4: backoff over, executes query
      const processed4 = await runPreflightIteration(deps);
      expect(mockDb.query).toHaveBeenCalled();
      expect(preflightFn).toHaveBeenCalled();
    });

    it('recognizes PREFLIGHT_INFRA_STORAGE, logs fixed warning, increments kind="infra" error metric, and backs off for 2 iterations', async () => {
      let submissionStatus = 'PREFLIGHT';
      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM submissions')) {
            return { rows: [{ id: 'sub-storage-infra' }] };
          }
          if (sql.includes("UPDATE submissions SET status = 'INVALID'")) {
            submissionStatus = 'INVALID';
            return { rowCount: 1 };
          }
          return { rows: [] };
        }),
      } as any;
      const mockStorage = {} as any;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const metrics = new CoordinatorMetrics();
      const backoffState = { skipCount: 0 };

      const preflightFn = vi.fn().mockRejectedValue(new Error('PREFLIGHT_INFRA_STORAGE'));

      const deps = {
        database: mockDb,
        storage: mockStorage,
        batch: 2,
        requireDocker: false,
        checkDocker: vi.fn().mockResolvedValue(true),
        checkS3: vi.fn().mockResolvedValue(true),
        preflightSubmission: preflightFn,
        logger,
        metrics,
        backoffState,
      };

      // Iteration 1: encounters PREFLIGHT_INFRA_STORAGE
      const processed1 = await runPreflightIteration(deps);
      expect(processed1).toBe(0);
      expect(submissionStatus).toBe('PREFLIGHT');
      expect(logger.warn).toHaveBeenCalledWith(
        'preflight deferred: infrastructure unavailable',
        { loop: 'preflight', reason: 'PREFLIGHT_INFRA_STORAGE' },
      );
      expect(metrics.getErrors('preflight', { kind: 'infra' })).toBe(1);
      expect(metrics.scrape()).toContain('ott_coordinator_loop_errors_total{loop="preflight",kind="infra"} 1');
      expect(backoffState.skipCount).toBe(2);

      // Iteration 2: skipped due to backoff
      mockDb.query.mockClear();
      preflightFn.mockClear();
      const processed2 = await runPreflightIteration(deps);
      expect(processed2).toBe(0);
      expect(mockDb.query).not.toHaveBeenCalled();
      expect(preflightFn).not.toHaveBeenCalled();
      expect(backoffState.skipCount).toBe(1);
    });
  });

  describe('Settle Loop & Query Assertion (Mutation 4 guard)', () => {
    it('asserts the settle candidate query text includes "no SCHEDULED/RUNNING matches" condition (Mutation 4 guard)', () => {
      expect(SETTLE_CANDIDATE_SERIES_SQL).toContain("s.status = 'SCHEDULED'");
      expect(SETTLE_CANDIDATE_SERIES_SQL).toContain(
        "NOT EXISTS (SELECT 1 FROM matches m WHERE m.series_id = s.id AND m.status IN ('SCHEDULED','RUNNING'))",
      );
      expect(SETTLE_CANDIDATE_SERIES_SQL).toContain(
        'EXISTS (SELECT 1 FROM matches m WHERE m.series_id = s.id)',
      );
      expect(SETTLE_CANDIDATE_SERIES_SQL).toContain('LIMIT 50');
    });

    it('settles candidates and isolates errors per series without stopping the batch', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({
          rows: [{ id: 'series-1' }, { id: 'series-fail' }, { id: 'series-2' }],
        }),
      } as any;

      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const settleFn = vi.fn().mockImplementation(async (_db, seriesId) => {
        if (seriesId === 'series-fail') {
          throw new Error('DB_DEADLOCK');
        }
        return { state: 'FINALIZED', teamAScore: 2, teamBScore: 0, winnerTeamId: 't-1' };
      });

      const count = await runSettleIteration({
        database: mockDb,
        settleFn,
        logger,
      });

      expect(count).toBe(2);
      expect(settleFn).toHaveBeenCalledTimes(3);
      expect(settleFn).toHaveBeenCalledWith(mockDb, 'series-1');
      expect(settleFn).toHaveBeenCalledWith(mockDb, 'series-fail');
      expect(settleFn).toHaveBeenCalledWith(mockDb, 'series-2');
      expect(logger.error).toHaveBeenCalledWith('coordinator settle series error', {
        loop: 'settle',
        seriesId: 'series-fail',
      });
    });

    it('ignores SERIES_NOT_FOUND or already-settled results cleanly', async () => {
      const mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'series-gone' }] }),
      } as any;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const settleFn = vi.fn().mockRejectedValue(new Error('SERIES_NOT_FOUND'));

      const count = await runSettleIteration({
        database: mockDb,
        settleFn,
        logger,
      });

      expect(count).toBe(0);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('Dispatch Loop', () => {
    it('calls dispatchScheduledMatches with configured limit and returns dispatched count', async () => {
      const mockDb = {} as any;
      const mockQueue = {} as any;
      const dispatchFn = vi.fn().mockResolvedValue(42);

      const count = await runDispatchIteration({
        database: mockDb,
        matchQueue: mockQueue,
        limit: 100,
        dispatchFn,
      });

      expect(count).toBe(42);
      expect(dispatchFn).toHaveBeenCalledWith(mockDb, mockQueue, 100);
    });
  });

  describe('Retention Loop', () => {
    it('executes runRetentionPrune with dryRun: true and logs counts only', async () => {
      const mockDb = {} as any;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const retentionFn = vi.fn().mockResolvedValue({
        dryRun: true,
        prunedSubmissionsCount: 3,
        prunedSubmissionIds: ['1', '2', '3'],
        reclaimedLayersCount: 5,
        reclaimedLayerDigests: ['a', 'b', 'c', 'd', 'e'],
        reclaimedBytes: 10240,
      });

      await runRetentionIteration({
        database: mockDb,
        retentionFn,
        logger,
      });

      expect(retentionFn).toHaveBeenCalledWith(mockDb, null, { dryRun: true });
      expect(logger.info).toHaveBeenCalledWith('coordinator retention dry-run completed', {
        prunedSubmissionsCount: 3,
        reclaimedLayersCount: 5,
        reclaimedBytes: 10240,
      });
    });
  });
});
