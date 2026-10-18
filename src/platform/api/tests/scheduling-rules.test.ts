import { describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { MAP_REGISTRY, selectMapIndex, type MatchRules } from '../src/modules/rounds/catalog.ts';
import { scheduleRound, type ScheduleRoundInput } from '../src/modules/scheduling/service.ts';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

class FakeScheduleDatabase {
  public readonly inserts: { readonly text: string; readonly values: readonly unknown[] }[] = [];

  public async query(text: string, values: readonly unknown[] = []): Promise<{ rows: unknown[]; rowCount?: number }> {
    if (text.includes('FROM teams t')) {
      return {
        rows: ['a', 'b', 'c', 'd'].map((letter, index) => ({
          teamId: `00000000-0000-4000-8000-00000000000${index + 1}`,
          submissionId: `10000000-0000-4000-8000-00000000000${index + 1}`,
          rating: 1000,
          archive_sha256: digest(letter), manifest_digest: digest(letter), config_digest: digest(letter), policy_version: 'P2_BASELINE_V1',
        })),
      };
    }
    if (text.trimStart().startsWith('INSERT INTO')) {
      this.inserts.push({ text, values });
      return { rows: [], rowCount: 0 };
    }
    return { rows: [] };
  }

  public async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    return work({ query: (text: string, values?: readonly unknown[]) => this.query(text, values) });
  }
}

function rules(overrides: Partial<MatchRules> = {}): MatchRules {
  return { engineVersion: '1.0.0', maxTurns: 150, turnTimeoutMs: 2000, maps: [MAP_REGISTRY[0]!], ...overrides };
}

async function schedule(input: Partial<ScheduleRoundInput> = {}) {
  const database = new FakeScheduleDatabase();
  await scheduleRound(database as unknown as Database, { tournamentStage: 'QUALIFICATION', idempotencyKey: 'k1', ...input });
  const byTable = (table: string) => database.inserts.find(({ text }) => text.includes(`INSERT INTO ${table}`))!;
  return { rounds: byTable('rounds'), matches: byTable('matches') };
}

describe('P3-D25 requestHash', () => {
  it('is unchanged when matchRules is absent and differs for different rules', async () => {
    const plain = (await schedule()).rounds.values[3];
    expect((await schedule()).rounds.values[3]).toBe(plain);
    const base = (await schedule({ matchRules: rules() })).rounds.values[3];
    expect(base).not.toBe(plain);
    expect((await schedule({ matchRules: rules() })).rounds.values[3]).toBe(base);
    for (const changed of [
      rules({ engineVersion: '1.0.1' }),
      rules({ maxTurns: 151 }),
      rules({ turnTimeoutMs: 2001 }),
      rules({ maps: [{ ...MAP_REGISTRY[0]!, checksum: 'b'.repeat(64) }] }),
      rules({ maps: [MAP_REGISTRY[0]!, { ...MAP_REGISTRY[0]!, mapId: 'second' }] }),
    ]) {
      expect((await schedule({ matchRules: changed })).rounds.values[3]).not.toBe(base);
    }
  });
});

describe('P3-D25 match snapshot columns', () => {
  it('keeps the column defaults when matchRules is absent', async () => {
    const { matches } = await schedule();
    expect(matches.text).not.toContain('map_definition');
    // 7 unnest arrays + protocolV2 (jsonb[]) + pinned rule-set id / engine / maxTurns (all null without a pinned round).
    expect(matches.values).toHaveLength(11);
    expect(matches.values.slice(8)).toEqual([null, null, null]);
  });

  it('writes engine, map, maxTurns and timeout for every match, with the same map for both games of a series', async () => {
    const second = { ...MAP_REGISTRY[0]!, mapId: 'second', definition: { ...MAP_REGISTRY[0]!.definition, mapId: 'second', checksum: 'b'.repeat(64) }, checksum: 'b'.repeat(64) };
    const { matches } = await schedule({ matchRules: rules({ maps: [MAP_REGISTRY[0]!, second] }) });
    // value layout: 7 unnest arrays, pinned rule-set id, engine, maxTurns, timeout, protocolV2[], map definitions[], map checksums[]
    const [ids, seriesIds, , , , , , , engine, maxTurns, timeout, , definitions, checksums] = matches.values as [string[], string[], unknown, unknown, unknown, unknown, unknown, unknown, string, number, number, unknown, string[], string[]];
    expect(ids).toHaveLength(4);
    expect([engine, maxTurns, timeout]).toEqual(['1.0.0', 150, 2000]);
    definitions.forEach((definition, index) => expect(JSON.parse(definition).checksum).toBe(checksums[index]));
    const mapBySeries = new Map<string, Set<string>>();
    seriesIds.forEach((seriesId, index) => mapBySeries.set(seriesId, (mapBySeries.get(seriesId) ?? new Set()).add(checksums[index]!)));
    expect(mapBySeries.size).toBe(2);
    for (const maps of mapBySeries.values()) expect(maps.size).toBe(1);
  });

  it('rejects empty map lists', async () => {
    await expect(schedule({ matchRules: rules({ maps: [] }) })).rejects.toThrow('MATCH_RULES_INVALID');
  });
});

describe('P3-D25 selectMapIndex', () => {
  it('is deterministic and depends on the series id', () => {
    expect(selectMapIndex('seed', 'series', 5)).toBe(selectMapIndex('seed', 'series', 5));
    const picks = new Set(Array.from({ length: 64 }, (_, index) => selectMapIndex('seed', `series-${index}`, 4)));
    expect(picks.size).toBe(4);
  });

  it('is roughly uniform over 1..16 maps for 1000 seeds', () => {
    for (let count = 1; count <= 16; count += 1) {
      const buckets = new Array<number>(count).fill(0);
      for (let seed = 0; seed < 1000; seed += 1) {
        const index = selectMapIndex(`seed-${seed}`, 'series', count);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(count);
        buckets[index]! += 1;
      }
      const expected = 1000 / count;
      for (const bucket of buckets) {
        expect(bucket).toBeGreaterThan(expected * 0.5);
        expect(bucket).toBeLessThan(expected * 1.5);
      }
    }
  });
});
