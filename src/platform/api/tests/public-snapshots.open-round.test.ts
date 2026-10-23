import { describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { NoValidAnnouncedRulesError, collectQualificationSnapshot, type PublicEditorial } from '../src/modules/public-snapshots/source.ts';
import { computeRulesSha256, type RoundRuleSetRulesV1 } from '../src/modules/rounds/types.ts';

const editorial: PublicEditorial = { announcements: [], faq: [], status: { message: 'Open', incidentEta: null }, changelog: 'c', minimumSeries: 5 };

function rules(overrides: Partial<RoundRuleSetRulesV1['schedule']> = {}): RoundRuleSetRulesV1 {
  return {
    schemaVersion: 'ott.round-rules.v1', engineVersion: '1.0.0', mapSet: [{ mapId: 'map-v1', checksum: 'a'.repeat(64) }], maxTurns: 200, faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000, perTurn: { mode: 'FIXED', fixedMs: 1000 } },
    resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
    schedule: { submissionOpensAt: '2026-10-14T00:00:00Z', submissionDeadlineAt: '2026-10-15T00:00:00Z', graceEndsAt: '2026-10-15T12:00:00Z', runStartsAt: '2026-10-16T00:00:00Z', runMaxHours: 48, appealEndsAt: '2026-10-19T00:00:00Z', ...overrides },
    testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE'] },
  };
}

function fakeDatabase(selectedRows: readonly unknown[]): Database {
  const tx = {
    query: async (sql: string) => {
      if (sql.includes('FROM qualification_rounds q')) return { rows: selectedRows };
      return { rows: [] };
    },
  };
  return { transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) } as unknown as Database;
}

function roundRow(status: string, ruleSet: RoundRuleSetRulesV1, sha = computeRulesSha256(ruleSet)) {
  return { round_number: 2, status, schedule_round_id: null, version: 3, rules: ruleSet, rules_sha256: sha };
}

describe('collectQualificationSnapshot for a freshly opened round (loop 87)', () => {
  it('publishes the open round (no schedule yet) as soon as it is opened', async () => {
    const snapshot = await collectQualificationSnapshot(fakeDatabase([roundRow('SUBMISSION_OPEN', rules())]), editorial, []);
    expect(snapshot.round).toEqual({ name: 'Round 2', status: 'SUBMISSION_OPEN' });
    expect(snapshot.rules.version).toMatch(/^3 · sha256:/);
  });

  it('reports NO_ROUND when no non-draft round exists', async () => {
    await expect(collectQualificationSnapshot(fakeDatabase([]), editorial, [])).rejects.toMatchObject({
      message: 'No valid announced qualification rules', reason: 'NO_ROUND',
    });
  });

  it('reports the invalid rule paths without dumping the rules', async () => {
    const bad = rules({ graceEndsAt: '2026-10-14T00:00:00Z' });
    const error = await collectQualificationSnapshot(fakeDatabase([roundRow('SUBMISSION_OPEN', bad)]), editorial, []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoValidAnnouncedRulesError);
    expect(error).toMatchObject({ reason: 'RULES_INVALID', roundNumber: 2, paths: ['schedule:ORDER_VIOLATION'] });
    expect(JSON.stringify((error as NoValidAnnouncedRulesError).paths)).not.toMatch(/map-v1/);
  });

  it('reports a stored hash mismatch', async () => {
    await expect(collectQualificationSnapshot(fakeDatabase([roundRow('SUBMISSION_OPEN', rules(), 'f'.repeat(64))]), editorial, [])).rejects.toMatchObject({
      reason: 'RULES_HASH_MISMATCH', roundNumber: 2,
    });
  });
});
