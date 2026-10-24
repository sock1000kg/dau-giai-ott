import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../src/db/client.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';
import {
  seedDemoReferenceBot,
  PINNED_REFERENCE_BOT_SHA256,
  DEFAULT_REFERENCE_BOT_ID,
  DEFAULT_REFERENCE_BOT_DISPLAY_NAME,
} from '../src/demo/seed-reference-bot.ts';
import { createAuthApp } from '../src/index.ts';
import { createPasswordHasher } from '../src/modules/auth/passwords.ts';

function qr<Row extends QueryResultRow = QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

describe('demo BTC reference bot seeding', () => {
  const realDemoBotPath = path.resolve(
    __dirname,
    '../../web/public/downloads/ott-demo-bot-go-v1.oci.tar',
  );
  const realDemoBotBytes = fs.readFileSync(realDemoBotPath);

  it('enforces demo environment guards', async () => {
    const put = vi.fn();
    const query = vi.fn();
    const database = { query } as unknown as Database;
    const storage = { put, async get() { return new Uint8Array(); } } as unknown as ObjectStorage;

    await expect(
      seedDemoReferenceBot({
        database,
        storage,
        archive: realDemoBotBytes,
        environment: { OTT_DEMO_MODE: 'false', OTT_DEPLOYMENT_MODE: 'dev' },
      }),
    ).rejects.toThrow(/OTT_DEMO_MODE must be 'true'/);

    await expect(
      seedDemoReferenceBot({
        database,
        storage,
        archive: realDemoBotBytes,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'prod' },
      }),
    ).rejects.toThrow(/OTT_DEPLOYMENT_MODE must be 'dev' or 'test'/);

    expect(put).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a mismatched expected archive digest before touching storage or DB', async () => {
    const put = vi.fn();
    const query = vi.fn();
    const database = { query } as unknown as Database;
    const storage = { put, async get() { return new Uint8Array(); } } as unknown as ObjectStorage;

    await expect(
      seedDemoReferenceBot({
        database,
        storage,
        archive: realDemoBotBytes,
        expectedSha256: '0'.repeat(64),
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
      }),
    ).rejects.toThrow(/checksum mismatch/);

    expect(put).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an invalid or corrupted OCI archive even if sha256 matches expectedSha256', async () => {
    const corruptedBytes = new TextEncoder().encode('corrupted-non-oci-tar-data');
    const corruptedSha = createHash('sha256').update(corruptedBytes).digest('hex');
    const put = vi.fn();
    const query = vi.fn();
    const database = { query } as unknown as Database;
    const storage = { put, async get() { return new Uint8Array(); } } as unknown as ObjectStorage;

    await expect(
      seedDemoReferenceBot({
        database,
        storage,
        archive: corruptedBytes,
        expectedSha256: corruptedSha,
        environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
      }),
    ).rejects.toThrow(/Reference bot OCI archive invalid/);

    expect(put).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('seeds real demo bot: validates OCI layout, uploads to S3, and upserts catalog row', async () => {
    const stored = new Map<string, Uint8Array>();
    const put = vi.fn(async (key: string, val: Uint8Array) => {
      stored.set(key, val);
    });
    const get = vi.fn(async (key: string) => {
      const found = stored.get(key);
      if (!found) throw new Error('NoSuchKey');
      return found;
    });
    const query = vi.fn(async () => qr());
    const database = { query } as unknown as Database;
    const storage = { put, get } as unknown as ObjectStorage;

    const result = await seedDemoReferenceBot({
      database,
      storage,
      archive: realDemoBotBytes,
      environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
    });

    expect(result.id).toBe(DEFAULT_REFERENCE_BOT_ID);
    expect(result.displayName).toBe(DEFAULT_REFERENCE_BOT_DISPLAY_NAME);
    expect(result.uploaded).toBe(true);
    expect(result.archiveSha256).toBe(`sha256:${PINNED_REFERENCE_BOT_SHA256}`);
    expect(result.objectKey).toBe(`reference-bots/${PINNED_REFERENCE_BOT_SHA256}.oci.tar`);
    expect(result.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.configDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(put).toHaveBeenCalledWith(
      `reference-bots/${PINNED_REFERENCE_BOT_SHA256}.oci.tar`,
      realDemoBotBytes,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO test_run_reference_bots'),
      [
        DEFAULT_REFERENCE_BOT_ID,
        DEFAULT_REFERENCE_BOT_DISPLAY_NAME,
        result.objectKey,
        result.archiveSha256,
        result.manifestDigest,
        result.configDigest,
        JSON.stringify(['/bot']),
        'P2_BASELINE_V1',
      ],
    );
  });

  it('is idempotent: re-run does not re-upload existing object and updates row without forcing enabled=TRUE', async () => {
    const stored = new Map<string, Uint8Array>();
    const objectKey = `reference-bots/${PINNED_REFERENCE_BOT_SHA256}.oci.tar`;
    stored.set(objectKey, realDemoBotBytes);

    const put = vi.fn();
    const get = vi.fn(async (key: string) => {
      const found = stored.get(key);
      if (!found) throw new Error('NoSuchKey');
      return found;
    });
    const query = vi.fn(async () => qr());
    const database = { query } as unknown as Database;
    const storage = { put, get } as unknown as ObjectStorage;

    const result = await seedDemoReferenceBot({
      database,
      storage,
      archive: realDemoBotBytes,
      environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' },
    });

    expect(result.uploaded).toBe(false);
    expect(put).not.toHaveBeenCalled();

    const calls = query.mock.calls as unknown as Array<[string, readonly unknown[]]>;
    const insertSql = String(calls[0]?.[0] ?? '');
    expect(insertSql).toContain('ON CONFLICT (id) DO UPDATE SET');
    // Ensure enabled is NOT overwritten in the DO UPDATE SET clause to prevent re-enabling a bot disabled by BTC
    const afterDoUpdate = insertSql.split('DO UPDATE SET')[1] ?? '';
    expect(afterDoUpdate).not.toContain('enabled =');
  });

  it('reads from default file path if archive is not passed directly', async () => {
    const stored = new Map<string, Uint8Array>();
    const put = vi.fn(async (key: string, val: Uint8Array) => {
      stored.set(key, val);
    });
    const get = vi.fn(async (key: string) => {
      const found = stored.get(key);
      if (!found) throw new Error('NoSuchKey');
      return found;
    });
    const query = vi.fn(async () => qr());
    const database = { query } as unknown as Database;
    const storage = { put, get } as unknown as ObjectStorage;

    const result = await seedDemoReferenceBot({
      database,
      storage,
      filePath: realDemoBotPath,
      environment: { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'test' },
    });

    expect(result.id).toBe('btc-baseline');
    expect(result.uploaded).toBe(true);
  });

  it('policy endpoint returns seeded btc-baseline reference bot', async () => {
    const teamId = '00000000-0000-4000-8000-000000000001';
    const mockDb = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM qualification_rounds') || sql.includes('FROM rounds')) {
          return qr([{
            id: 'round-1',
            status: 'SUBMISSION_OPEN',
            paused_at: null,
            rules: {
              mapSet: [{ mapId: 'default', checksum: 'a'.repeat(64) }],
              testRun: {
                quotaPerTeamPerDay: 5,
                opponents: ['OWN_SUBMISSION', 'BTC_REFERENCE'],
              },
            },
          }]);
        }
        if (sql.includes('COUNT(*) FILTER')) {
          return qr([{ consumed: 0, reserved: 0 }]);
        }
        if (sql.includes('FROM submissions') && sql.includes('created_at')) {
          return qr([{ id: 'sub-1', status: 'ACTIVE', created_at: new Date() }]);
        }
        if (sql.includes('FROM test_run_reference_bots')) {
          return qr([{ id: 'btc-baseline', display_name: 'BTC baseline' }]);
        }
        return qr();
      }),
      async transaction<T>(work: (tx: Database) => Promise<T>) {
        return work(this as unknown as Database);
      },
      async close() {},
    } as unknown as Database;

    const mockStorage = {
      async put() {},
      async get() { return new Uint8Array(); },
      async copy() {},
      async remove() {},
    };

    const fastify = (await import('fastify')).default();
    fastify.addHook('preHandler', async (req) => {
      req.principal = { accountId: 'u1', role: 'TEAM_ACCOUNT', teamId };
    });
    const { registerTestRunRoutes } = await import('../src/modules/test-runs/routes.ts');
    await registerTestRunRoutes(fastify, { database: mockDb, storage: mockStorage });

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/test-run-policy',
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.opponents.referenceBots).toEqual([
      { id: 'btc-baseline', displayName: 'BTC baseline' },
    ]);
    expect(data.opponents.ownSubmissionAllowed).toBe(true);
    await fastify.close();
  });
});
