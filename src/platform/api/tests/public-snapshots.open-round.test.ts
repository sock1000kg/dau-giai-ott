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

function fakeDatabase(selectedRows: readonly unknown[], matchRows: readonly unknown[] = []): Database {
  const tx = {
    query: async (sql: string) => {
      if (sql.includes('FROM qualification_rounds q')) return { rows: selectedRows };
      if (sql.includes('FROM matches m')) return { rows: matchRows };
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

    // Loop 88: "Bàn cờ đã khóa" is non-empty even with 0 matches, and "Thay đổi" is not emitted
    const lockedMapsSection = snapshot.rules.sections.find((s) => s.title === 'Bàn cờ đã khóa');
    expect(lockedMapsSection).toBeDefined();
    const parsedMaps = JSON.parse(lockedMapsSection!.body) as Array<{ mapId: string; error?: string }>;
    expect(parsedMaps).toHaveLength(1);
    expect(parsedMaps[0]?.mapId).toBe('map-v1');
    expect(parsedMaps[0]?.error).toBe('không có định nghĩa trong danh mục');

    const changelogSection = snapshot.rules.sections.find((s) => s.title === 'Thay đổi');
    expect(changelogSection).toBeUndefined();
  });

  it('resolves registered maps into definition in "Bàn cờ đã khóa"', async () => {
    const defaultMapRules = rules();
    // 'default' map is in MAP_REGISTRY
    (defaultMapRules.mapSet as any) = [{ mapId: 'default', checksum: 'a'.repeat(64) }];
    const snapshot = await collectQualificationSnapshot(fakeDatabase([roundRow('SUBMISSION_OPEN', defaultMapRules)]), editorial, []);
    const lockedMapsSection = snapshot.rules.sections.find((s) => s.title === 'Bàn cờ đã khóa');
    const parsedMaps = JSON.parse(lockedMapsSection!.body) as Array<{ mapId: string; width: number }>;
    expect(parsedMaps[0]?.mapId).toBe('default');
    expect(parsedMaps[0]?.width).toBe(9);
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

  it('deduplicates map definitions by mapId:checksum even when match jsonb carries keys in different order', async () => {
    const defaultMapRules = rules();
    (defaultMapRules.mapSet as any) = [{ mapId: 'default', checksum: 'a'.repeat(64) }];

    const reorderedMatchMap = {
      checksum: 'a'.repeat(64),
      height: 9,
      width: 9,
      mapId: 'default',
      obstacles: [],
      spawns: [],
      goals: {},
      version: 1,
      schemaVersion: 1,
    };

    const matchRows = [
      {
        id: 'match-1',
        teams: 'A / B',
        status: 'FINALIZED',
        winner_side: 'X',
        map_definition: reorderedMatchMap,
      },
    ];

    const snapshot = await collectQualificationSnapshot(
      fakeDatabase([roundRow('SUBMISSION_OPEN', defaultMapRules)], matchRows),
      editorial,
      [],
    );

    const lockedMapsSection = snapshot.rules.sections.find((s) => s.title === 'Bàn cờ đã khóa');
    const parsedMaps = JSON.parse(lockedMapsSection!.body) as Array<{ mapId: string; checksum: string }>;
    expect(parsedMaps).toHaveLength(1);
    expect(parsedMaps[0]?.mapId).toBe('default');
    expect(parsedMaps[0]?.checksum).toBe('a'.repeat(64));
  });
});
