import { describe, expect, it } from 'vitest';
import { runQualificationPilotLoad } from './qualification-round.ts';

describe('P3-N06: Qualification Pilot Round & Single-Server Load', () => {
  it('simulates 200 teams, burst upload concurrency with backpressure, and priority queue ordering', async () => {
    const result = await runQualificationPilotLoad({
      teamCount: 200,
      activeSessions: 100,
      burstUploadCount: 50,
      publicClientCount: 1000,
      gamesPerSeries: 4,
    });

    // 1. Burst upload backpressure
    expect(result.uploadMetrics.total).toBe(50);
    expect(result.uploadMetrics.success).toBe(50);
    expect(result.uploadMetrics.throttled429).toBeGreaterThan(0); // Proves 429 Retry-After was triggered

    // 2. Queue priority enforcement (AC-21)
    expect(result.priorityMetrics.officialProcessedFirst).toBe(true);
    expect(result.priorityMetrics.totalOfficialJobs).toBe(20);
    expect(result.priorityMetrics.totalTestRunJobs).toBe(10);

    // 3. Public clients offload (AC-14)
    expect(result.publicMetrics.success).toBe(1000);
    expect(result.publicMetrics.throttled429).toBe(0); // CDN/static cache handles all traffic without 429
    expect(result.publicMetrics.p95Ms).toBeLessThan(10); // Cache response is fast

    // 4. Rating ledger & Adaptive K
    expect(result.ratingMetrics.initialTeamsCount).toBe(200);
    expect(result.ratingMetrics.seriesPlayedCount).toBe(50);
    expect(result.ratingMetrics.ledgerMatchesCount).toBe(200); // 50 series * 4 games
    expect(result.ratingMetrics.zeroEloDeltaFromTestRuns).toBe(true);

    // 5. Total integrity pass
    expect(result.integrityPass).toBe(true);
  });
});

