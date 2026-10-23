import * as fs from 'node:fs/promises';
import {
  dispatchScheduledMatches,
  NoValidAnnouncedRulesError,
  publishQualificationSnapshot,
  runRetentionPrune,
  settleSeries,
  type Database,
  type MatchJobEnqueuer,
  type ObjectStorage,
} from '@ott/platform-api';
import { preflightSubmission, type PreflightSubmissionOptions, type PreflightSubmissionResult } from '../preflight-submission.ts';
import {
  DEFAULT_PUBLIC_EDITORIAL,
  validateEditorial,
  type CoordinatorConfig,
  type PublicEditorial,
} from './config.ts';
import type { CoordinatorLoopName, CoordinatorMetrics } from './metrics.ts';
import { pruneSnapshotDirectory } from './snapshot-prune.ts';

export interface CoordinatorLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export const SETTLE_CANDIDATE_SERIES_SQL =
  "SELECT s.id FROM series s WHERE s.status = 'SCHEDULED' AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.series_id = s.id AND m.status IN ('SCHEDULED','RUNNING')) AND EXISTS (SELECT 1 FROM matches m WHERE m.series_id = s.id) ORDER BY s.created_at LIMIT 50";

export const SNAPSHOT_QUEUE_MATCHES_SQL =
  "SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id JOIN rounds r ON r.id = s.round_id WHERE m.status = 'SCHEDULED' AND r.status <> 'FINALIZED' ORDER BY m.created_at, m.id LIMIT 500";

// ----------------------------------------------------------------------------
// Loop iteration implementations
// ----------------------------------------------------------------------------

export interface PreflightBackoffState {
  skipCount: number;
}

let defaultPreflightBackoff: PreflightBackoffState = { skipCount: 0 };

export function resetPreflightBackoff(): void {
  defaultPreflightBackoff = { skipCount: 0 };
}

export interface PreflightLoopDeps {
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly batch: number;
  readonly requireDocker: boolean;
  readonly checkDocker: () => Promise<boolean>;
  readonly checkS3: () => Promise<boolean>;
  readonly preflightSubmission?: (options: PreflightSubmissionOptions) => Promise<PreflightSubmissionResult>;
  readonly logger?: CoordinatorLogger;
  readonly metrics?: CoordinatorMetrics;
  readonly backoffState?: PreflightBackoffState;
  readonly dockerSocketPath?: string;
}

export async function runPreflightIteration(deps: PreflightLoopDeps): Promise<number> {
  const backoff = deps.backoffState ?? defaultPreflightBackoff;
  if (backoff.skipCount > 0) {
    backoff.skipCount--;
    return 0;
  }

  // Pre-check dependencies before batch: Docker ping + S3 check
  if (deps.requireDocker) {
    const dockerOk = await deps.checkDocker().catch(() => false);
    if (!dockerOk) {
      deps.logger?.warn('preflight dependencies unavailable, skipping batch', { dependency: 'docker' });
      return 0;
    }
  }

  const s3Ok = await deps.checkS3().catch(() => false);
  if (!s3Ok) {
    deps.logger?.warn('preflight dependencies unavailable, skipping batch', { dependency: 's3' });
    return 0;
  }

  // Query candidate submissions in PREFLIGHT
  const candidateResult = await deps.database.query<{ id: string }>(
    "SELECT id FROM submissions WHERE status = 'PREFLIGHT' ORDER BY created_at, id LIMIT $1",
    [deps.batch],
  );

  if (candidateResult.rows.length === 0) {
    return 0;
  }

  const fn = deps.preflightSubmission ?? preflightSubmission;
  let activeCount = 0;

  // Run up to batch concurrently
  const tasks = candidateResult.rows.map(async (row) => {
    try {
      const res = await fn({
        submissionId: row.id,
        database: deps.database,
        storage: deps.storage,
        dockerReachable: () => deps.checkDocker(),
        ...(deps.dockerSocketPath === undefined ? {} : { dockerSocketPath: deps.dockerSocketPath }),
      });
      if (res.status === 'ACTIVE') {
        activeCount++;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'PREFLIGHT_INFRA_DOCKER' || message === 'PREFLIGHT_INFRA_STORAGE') {
        deps.logger?.warn('preflight deferred: infrastructure unavailable', {
          loop: 'preflight',
          reason: message,
        });
        deps.metrics?.incrementErrors('preflight', { kind: 'infra' });
        backoff.skipCount = 2;
        return;
      }
      const reason = /^[A-Z][A-Z0-9_]{0,63}$/.test(message) ? message : 'PREFLIGHT_FAILED';
      deps.logger?.info('preflight submission rejected', { submissionId: row.id, reason });
    }
  });

  await Promise.all(tasks);
  return activeCount;
}

export interface DispatchLoopDeps {
  readonly database: Database;
  readonly matchQueue: MatchJobEnqueuer;
  readonly limit: number;
  readonly dispatchFn?: typeof dispatchScheduledMatches;
  readonly logger?: CoordinatorLogger;
}

export async function runDispatchIteration(deps: DispatchLoopDeps): Promise<number> {
  const fn = deps.dispatchFn ?? dispatchScheduledMatches;
  return fn(deps.database, deps.matchQueue, deps.limit);
}

export interface SettleLoopDeps {
  readonly database: Database;
  readonly settleFn?: typeof settleSeries;
  readonly logger?: CoordinatorLogger;
}

export async function runSettleIteration(deps: SettleLoopDeps): Promise<number> {
  const candidates = await deps.database.query<{ id: string }>(SETTLE_CANDIDATE_SERIES_SQL);
  if (candidates.rows.length === 0) {
    return 0;
  }

  const fn = deps.settleFn ?? settleSeries;
  let settledCount = 0;

  for (const candidate of candidates.rows) {
    try {
      const result = await fn(deps.database, candidate.id);
      if (result.state === 'FINALIZED' || result.state === 'CANCELLED') {
        settledCount++;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'SERIES_NOT_FOUND' || message === 'SERIES_ALREADY_SETTLED') {
        // Already settled or concurrent deletion: ignore
      } else {
        deps.logger?.error('coordinator settle series error', { loop: 'settle', seriesId: candidate.id });
      }
    }
  }

  return settledCount;
}

export interface SnapshotLoopDeps {
  readonly database: Database;
  readonly snapshotDir: string;
  readonly snapshotKeep: number;
  readonly editorialFile: string | null;
  readonly fallbackEditorial: PublicEditorial;
  readonly publishFn?: typeof publishQualificationSnapshot;
  readonly logger?: CoordinatorLogger;
}

export async function runSnapshotIteration(deps: SnapshotLoopDeps): Promise<void> {
  // 1. Build queueMatchIds from database
  const matchesResult = await deps.database.query<{ id: string }>(SNAPSHOT_QUEUE_MATCHES_SQL);
  const queueMatchIds = matchesResult.rows.map((r) => r.id);

  // 2. Read editorial (re-read on each publish so BTC can edit without restart)
  let editorial = deps.fallbackEditorial;
  if (deps.editorialFile !== null) {
    try {
      const content = await fs.readFile(deps.editorialFile, 'utf8');
      const parsed = JSON.parse(content) as unknown;
      const validated = validateEditorial(parsed);
      if (validated.valid) {
        editorial = validated.value;
      } else {
        deps.logger?.warn('failed to validate editorial file, using fallback');
      }
    } catch {
      deps.logger?.warn('failed to read editorial file, using fallback');
    }
  }

  // 3. Publish snapshot
  const fn = deps.publishFn ?? publishQualificationSnapshot;
  try {
    await fn(deps.database, deps.snapshotDir, editorial, queueMatchIds);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'No valid announced qualification rules') {
      // Treat as "nothing to publish yet" (debug count only, not an error)
      if (err instanceof NoValidAnnouncedRulesError) {
        deps.logger?.info('qualification snapshot skipped: no valid announced rules', {
          reason: err.reason, roundNumber: err.roundNumber, paths: err.paths,
        });
      } else {
        deps.logger?.info('qualification snapshot skipped: no valid announced rules');
      }
      return;
    }
    deps.logger?.error('qualification snapshot publish failed');
    throw err;
  }

  // 4. Prune directory after successful publish
  await pruneSnapshotDirectory(deps.snapshotDir, deps.snapshotKeep, deps.logger);
}

export interface RetentionLoopDeps {
  readonly database: Database;
  readonly retentionFn?: typeof runRetentionPrune;
  readonly logger?: CoordinatorLogger;
}

export async function runRetentionIteration(deps: RetentionLoopDeps): Promise<void> {
  const fn = deps.retentionFn ?? runRetentionPrune;
  const report = await fn(deps.database, null, { dryRun: true });
  deps.logger?.info('coordinator retention dry-run completed', {
    prunedSubmissionsCount: report.prunedSubmissionsCount,
    reclaimedLayersCount: report.reclaimedLayersCount,
    reclaimedBytes: report.reclaimedBytes,
  });
}

// ----------------------------------------------------------------------------
// Loop Runner & Scheduler
// ----------------------------------------------------------------------------

export interface LoopDefinition {
  readonly name: CoordinatorLoopName;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
}

export class CoordinatorLoopRunner {
  private readonly loops: readonly LoopDefinition[];
  private readonly metrics: CoordinatorMetrics;
  private readonly inFlight = new Map<CoordinatorLoopName, boolean>();
  private readonly timers = new Map<CoordinatorLoopName, NodeJS.Timeout>();
  private readonly logger?: CoordinatorLogger | undefined;
  private stopped = false;
  private paused = true; // starts paused until advisory lock acquired (active)

  public constructor(options: {
    loops: readonly LoopDefinition[];
    metrics: CoordinatorMetrics;
    logger?: CoordinatorLogger | undefined;
  }) {
    this.loops = options.loops;
    this.metrics = options.metrics;
    this.logger = options.logger;

    for (const loop of this.loops) {
      this.inFlight.set(loop.name, false);
    }
  }

  public getInFlightCount(): number {
    let count = 0;
    for (const running of this.inFlight.values()) {
      if (running) count++;
    }
    return count;
  }

  public resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    for (const loop of this.loops) {
      this.scheduleLoop(loop, 0); // trigger first iteration immediately
    }
  }

  public pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const [name, timer] of this.timers.entries()) {
      clearTimeout(timer);
      this.timers.delete(name);
    }
  }

  public async stop(shutdownTimeoutMs: number): Promise<void> {
    this.stopped = true;
    this.pause();

    const deadline = Date.now() + shutdownTimeoutMs;
    while (this.getInFlightCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const abandoned = this.getInFlightCount();
    if (abandoned > 0) {
      this.logger?.warn('Shutdown timeout exceeded with active loop iterations remaining', {
        count: abandoned,
      });
    }
  }

  public async triggerIteration(loopName: CoordinatorLoopName): Promise<void> {
    const loop = this.loops.find((l) => l.name === loopName);
    if (!loop) return;
    await this.executeLoopIteration(loop);
  }

  private scheduleLoop(loop: LoopDefinition, delayMs: number): void {
    if (this.stopped || this.paused) return;

    const timer = setTimeout(async () => {
      this.timers.delete(loop.name);
      await this.executeLoopIteration(loop);
      if (!this.stopped && !this.paused) {
        this.scheduleLoop(loop, loop.intervalMs);
      }
    }, delayMs);

    this.timers.set(loop.name, timer);
  }

  private async executeLoopIteration(loop: LoopDefinition): Promise<void> {
    if (this.stopped) return;

    // Non-overlapping guarantee
    if (this.inFlight.get(loop.name) === true) {
      return;
    }

    this.inFlight.set(loop.name, true);
    this.metrics.incrementIterations(loop.name);

    try {
      await loop.run();
      this.metrics.recordSuccess(loop.name);
    } catch (err: unknown) {
      this.metrics.incrementErrors(loop.name);
      // Fixed-message error logging: NEVER include err.message!
      this.logger?.error('coordinator loop error', { loop: loop.name });
    } finally {
      this.inFlight.set(loop.name, false);
    }
  }
}
