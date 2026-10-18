import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { dispatchScheduledMatches } from '../src/modules/scheduling/service.ts';

const matchId = '3f1b7c64-9d0e-4a53-8e55-0b1f4c2d7a11';
const reference = (char: string) => ({
  submissionId: matchId, archiveSha256: `sha256:${char.repeat(64)}`, manifestDigest: `sha256:${'b'.repeat(64)}`,
  configDigest: `sha256:${'c'.repeat(64)}`, policyVersion: 'P2_BASELINE_V1',
});
const job = { schemaVersion: 'ott.match-job.v1', matchId, idempotencyKey: matchId, policyVersion: 'P2_BASELINE_V1', x: reference('a'), o: reference('d') };

describe('operations dispatch of rerun outbox rows', () => {
  it('selects MATCH_RERUN rows and passes the generation only for reruns', async () => {
    const query = vi.fn(async (text: string) => text.startsWith('SELECT')
      ? { rows: [{ id: 'o1', payload: job, generation: 0 }, { id: 'o2', payload: job, generation: 2 }] }
      : { rows: [], rowCount: 1 });
    const enqueue = vi.fn(async () => ({}));
    const dispatched = await dispatchScheduledMatches({ query } as unknown as Database, { enqueue });
    expect(dispatched).toBe(2);
    expect(query.mock.calls[0]![0]).toContain("event_type IN ('MATCH_SCHEDULED', 'MATCH_RERUN')");
    expect(enqueue.mock.calls[0]).toEqual([job]);
    expect(enqueue.mock.calls[1]).toEqual([job, { generation: 2 }]);
  });
});
