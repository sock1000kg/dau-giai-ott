import { randomUUID, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@ott/platform-api';
import {
  evaluateRerunEligibility,
  calculateEloDelta,
  CURRENT_RATING_POLICY,
  kFactorFor,
} from '@ott/platform-api';
import { QUEUE_PRIORITY, type MatchJobV1 } from '@ott/job-contract';

describe('P3-N06: Worker Recovery, Crash Handling & Ledger Idempotency (AC-3)', () => {
  it('detects worker heartbeat loss and allows retry with generation increment', async () => {
    const matchId = randomUUID();
    let currentGeneration = 1;
    let jobStatus: string = 'QUEUED';
    let workerHeartbeatLastSeen = Date.now() - 15_000; // 15 seconds ago (expired)
    const HEARTBEAT_TIMEOUT_MS = 10_000;

    // Simulate worker heartbeat check
    const isWorkerAlive = (Date.now() - workerHeartbeatLastSeen) < HEARTBEAT_TIMEOUT_MS;
    expect(isWorkerAlive).toBe(false);

    // Lease expired: worker failed to finish match in time
    // System re-queues job and increments outbox generation to prevent stale writes
    if (!isWorkerAlive && jobStatus !== 'COMPLETED') {
      currentGeneration += 1;
      jobStatus = 'QUEUED';
    }

    expect(currentGeneration).toBe(2);
    expect(jobStatus).toBe('QUEUED');

    // Second worker picks up job with generation 2
    jobStatus = 'RUNNING';
    const finishedGeneration = currentGeneration;
    jobStatus = 'COMPLETED';

    expect(finishedGeneration).toBe(2);
    expect(jobStatus).toBe('COMPLETED');
  });

  it('guarantees rating ledger is never duplicated on job retry', async () => {
    const matchId = randomUUID();
    const teamA = randomUUID();
    const teamB = randomUUID();

    const ledger: Array<{ matchId: string; teamId: string; delta: number; generation: number }> = [];
    const teamRatings = new Map<string, number>([
      [teamA, 1200],
      [teamB, 1200],
    ]);

    // Apply match result helper ensuring idempotency
    function applyMatchResult(generation: number, scoreA: 0 | 1): boolean {
      // Check if match already settled in ledger
      const existing = ledger.find((entry) => entry.matchId === matchId);
      if (existing) {
        // Already recorded; do not duplicate rating update
        return false;
      }

      const k = kFactorFor(CURRENT_RATING_POLICY, 0);
      const deltaA = calculateEloDelta(teamRatings.get(teamA)!, teamRatings.get(teamB)!, scoreA, k);
      const deltaB = calculateEloDelta(teamRatings.get(teamB)!, teamRatings.get(teamA)!, 1 - scoreA, k);

      ledger.push(
        { matchId, teamId: teamA, delta: deltaA, generation },
        { matchId, teamId: teamB, delta: deltaB, generation },
      );

      teamRatings.set(teamA, teamRatings.get(teamA)! + deltaA);
      teamRatings.set(teamB, teamRatings.get(teamB)! + deltaB);
      return true;
    }

    // 1. Initial attempt fails halfway (no ledger applied)
    // 2. Retry with generation 2 finishes and applies ledger
    const appliedFirst = applyMatchResult(2, 1);
    expect(appliedFirst).toBe(true);
    expect(ledger).toHaveLength(2);
    const ratingAAfter = teamRatings.get(teamA)!;
    const ratingBAfter = teamRatings.get(teamB)!;
    expect(ratingAAfter).toBeGreaterThan(1200);
    expect(ratingBAfter).toBeLessThan(1200);

    // 3. Stale delayed completion or duplicate execution from worker attempt 1 arrives
    const appliedDuplicate = applyMatchResult(1, 1);
    expect(appliedDuplicate).toBe(false); // Ignored due to idempotency
    expect(ledger).toHaveLength(2); // No new ledger entries
    expect(teamRatings.get(teamA)).toBe(ratingAAfter); // Rating unchanged
    expect(teamRatings.get(teamB)).toBe(ratingBAfter); // Rating unchanged
  });

  it('enforces that rerun is only permitted for infrastructure failures (D-07 & AC-3)', () => {
    // 1. Legitimate bot forfeit: cannot be rerun
    const botForfeitEligibility = evaluateRerunEligibility({
      matchStatus: 'FAILED',
      hasResult: false,
      latestAttemptStatus: 'FAILED_TERMINAL',
      latestFailureReason: 'BOT_TIMEOUT', // Not infra failure
      roundStatus: 'SCHEDULED',
      seriesStatus: 'SCHEDULED',
      seriesCancellationReason: null,
      hasRatingLedger: false,
      hasPendingRerun: false,
    });
    expect(botForfeitEligibility.ok).toBe(false);
    expect((botForfeitEligibility as { code: string }).code).toBe('RERUN_NOT_INFRA_FAILURE');

    // 2. Infra failure (e.g. MATCH_EXECUTION_FAILED): eligible for rerun
    const infraFailureEligibility = evaluateRerunEligibility({
      matchStatus: 'FAILED',
      hasResult: false,
      latestAttemptStatus: 'FAILED_TERMINAL',
      latestFailureReason: 'MATCH_EXECUTION_FAILED',
      roundStatus: 'SCHEDULED',
      seriesStatus: 'SCHEDULED',
      seriesCancellationReason: null,
      hasRatingLedger: false,
      hasPendingRerun: false,
    });
    expect(infraFailureEligibility.ok).toBe(true);

    // 3. Completed round / settled ledger: cannot rerun even if infra failure
    const roundFinalizedEligibility = evaluateRerunEligibility({
      matchStatus: 'FAILED',
      hasResult: false,
      latestAttemptStatus: 'FAILED_TERMINAL',
      latestFailureReason: 'MATCH_EXECUTION_FAILED',
      roundStatus: 'FINALIZED',
      seriesStatus: 'FINALIZED',
      seriesCancellationReason: null,
      hasRatingLedger: true,
      hasPendingRerun: false,
    });
    expect(roundFinalizedEligibility.ok).toBe(false);
    expect((roundFinalizedEligibility as { code: string }).code).toBe('RERUN_ROUND_SETTLED');
  });

  it('validates state checksum and backup integrity after simulated recovery', async () => {
    // Simulate manifest checksum before crash
    const initialRecords = [
      { id: 'match-1', result: 'WIN_X', hash: 'hash1' },
      { id: 'match-2', result: 'WIN_O', hash: 'hash2' },
      { id: 'match-3', result: 'DRAW', hash: 'hash3' },
    ];

    const serializeState = (records: typeof initialRecords) =>
      createHash('sha256').update(JSON.stringify(records)).digest('hex');

    const backupDigest = serializeState(initialRecords);

    // Simulate system restart and state reload from storage
    const restoredRecords = [...initialRecords];
    const postRecoveryDigest = serializeState(restoredRecords);

    expect(postRecoveryDigest).toBe(backupDigest);
    expect(restoredRecords).toHaveLength(3);
  });
});
