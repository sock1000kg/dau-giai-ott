import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../src/db/client.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';
import { seedDemoReferenceBot } from '../src/demo/seed-reference-bot.ts';

function qr<Row extends QueryResultRow = QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

describe('demo BTC reference bot seeding', () => {
  it('uploads only a checksum-matched external archive and enables its catalog record', async () => {
    const archive = new TextEncoder().encode('external-demo-archive');
    const checksum = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
    const put = vi.fn();
    const query = vi.fn(async () => qr());
    const database = { query, async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this as unknown as Database); }, async close() {} } as unknown as Database;
    const storage = { put, async get() { return archive; }, async copy() {}, async remove() {} } as ObjectStorage;
    const result = await seedDemoReferenceBot({
      database, storage, archive,
      environment: {
        OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev', OTT_DEMO_REFERENCE_BOT_SHA256: checksum,
        OTT_DEMO_REFERENCE_BOT_MANIFEST_DIGEST: `sha256:${'1'.repeat(64)}`,
        OTT_DEMO_REFERENCE_BOT_CONFIG_DIGEST: `sha256:${'2'.repeat(64)}`,
      },
    });
    expect(result.checksum).toBe(checksum);
    expect(put).toHaveBeenCalledWith(expect.stringContaining(checksum), archive);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO test_run_reference_bots'), expect.arrayContaining([result.id, expect.any(String), result.objectKey, checksum]));
  });

  it('rejects a mismatched expected archive digest before touching storage or catalog', async () => {
    const archive = new TextEncoder().encode('external-demo-archive');
    const put = vi.fn();
    const query = vi.fn();
    const database = { query, async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this as unknown as Database); }, async close() {} } as unknown as Database;
    const storage = { put, async get() { return archive; }, async copy() {}, async remove() {} } as ObjectStorage;
    await expect(seedDemoReferenceBot({
      database, storage, archive,
      environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev', OTT_DEMO_REFERENCE_BOT_SHA256: `sha256:${'0'.repeat(64)}` },
    })).rejects.toThrow(/checksum does not match/);
    expect(put).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
