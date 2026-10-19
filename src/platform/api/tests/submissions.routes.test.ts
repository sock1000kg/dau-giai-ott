import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerSubmissionRoutes } from '../src/modules/submissions/routes.ts';
import type { Database } from '../src/db/client.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';

const enc = new TextEncoder();
const sha = (v: Uint8Array) => `sha256:${createHash('sha256').update(v).digest('hex')}`;
const join = (...xs: Uint8Array[]) => {
  const n = xs.reduce((a, x) => a + x.length, 0);
  const r = new Uint8Array(n);
  let o = 0;
  for (const x of xs) {
    r.set(x, o);
    o += x.length;
  }
  return r;
};
const text = (a: Uint8Array, o: number, n: number, v: string) => a.set(enc.encode(v).slice(0, n), o);
const oct = (a: Uint8Array, o: number, n: number, v: number) => {
  text(a, o, n, v.toString(8).padStart(n - 1, '0'));
  a[o + n - 1] = 0;
};
const tar = (entries: readonly { name: string; body: Uint8Array }[]) =>
  join(
    ...entries.flatMap(({ name, body }) => {
      const h = new Uint8Array(512);
      text(h, 0, 100, name);
      oct(h, 100, 8, 0o644);
      oct(h, 124, 12, body.length);
      h.fill(32, 148, 156);
      h[156] = 48;
      text(h, 257, 6, 'ustar');
      text(h, 263, 2, '00');
      text(h, 148, 8, `${h.reduce((s, b) => s + b, 0).toString(8).padStart(6, '0')}\0 `);
      return [h, body, new Uint8Array((512 - (body.length % 512)) % 512)];
    }),
    new Uint8Array(1024)
  );

const makeArchive = (tag = 'default') => {
  const layer = tar([{ name: 'bot', body: enc.encode(`bot-payload-${tag}`) }]);
  const config = enc.encode(JSON.stringify({ architecture: 'amd64', os: 'linux', config: { Entrypoint: ['bot'] } }));
  const manifest = enc.encode(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha(config), size: config.length },
      layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: sha(layer), size: layer.length }],
    })
  );
  const fileBytes = tar([
    { name: 'oci-layout', body: enc.encode('{"imageLayoutVersion":"1.0.0"}') },
    {
      name: 'index.json',
      body: enc.encode(
        JSON.stringify({
          schemaVersion: 2,
          manifests: [
            {
              mediaType: 'application/vnd.oci.image.manifest.v1+json',
              digest: sha(manifest),
              size: manifest.length,
              platform: { os: 'linux', architecture: 'amd64' },
            },
          ],
        })
      ),
    },
    { name: `blobs/sha256/${sha(manifest).slice(7)}`, body: manifest },
    { name: `blobs/sha256/${sha(config).slice(7)}`, body: config },
    { name: `blobs/sha256/${sha(layer).slice(7)}`, body: layer },
  ]);
  return Buffer.from(fileBytes);
};

function createMockStorage() {
  const store = new Map<string, Buffer>();
  return {
    store,
    put: vi.fn(async (key: string, body: Buffer) => {
      store.set(key, Buffer.from(body));
    }),
    get: vi.fn(async (key: string) => {
      const b = store.get(key);
      if (!b) throw new Error(`Object not found: ${key}`);
      return b;
    }),
    copy: vi.fn(async (sourceKey: string, destKey: string) => {
      const b = store.get(sourceKey);
      if (!b) throw new Error(`Object not found: ${sourceKey}`);
      store.set(destKey, Buffer.from(b));
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function createMockDb() {
  const insertedSubmissions: any[] = [];
  const reservations = new Map<string, any>();
  const submissions = new Map<string, any>();

  const roundRow = {
    id: 'round-1',
    tournament_stage: 'QUALIFICATION',
    round_number: 1,
    status: 'SUBMISSION_OPEN',
    rule_set_id: 'rule-set-1',
    rules: {
      schedule: {
        submissionOpensAt: '2026-10-01T00:00:00.000Z',
        submissionDeadlineAt: '2026-10-25T00:00:00.000Z',
        graceEndsAt: '2026-10-26T00:00:00.000Z',
      },
    },
  };

  let failTransaction = false;

  const query = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('qualification_rounds')) {
      return { rows: [roundRow] };
    }
    if (sql.includes('submission_reservations') && sql.includes('WHERE id = $1')) {
      const res = reservations.get(params[0]);
      return { rows: res ? [res] : [] };
    }
    return { rows: [] };
  });

  const transaction = vi.fn(async (callback: (tx: any) => Promise<any>) => {
    if (failTransaction) {
      throw new Error('Simulated DB error in transaction');
    }
    const tx = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('submission_reservations') && sql.includes('FOR UPDATE')) {
          const res = reservations.get(params[0]);
          return { rows: res ? [res] : [] };
        }
        if (sql.includes('submissions') && sql.includes('WHERE id = $1')) {
          const sub = submissions.get(params[0]);
          return { rows: sub ? [sub] : [] };
        }
        if (sql.includes('INSERT INTO submissions')) {
          const [id, team_id, qualification_round_id, archive_sha256, oci_manifest_digest, oci_config_digest, entrypoint, platform, object_key, policy_version] = params;
          const row = {
            id,
            team_id,
            qualification_round_id,
            archive_sha256,
            oci_manifest_digest,
            oci_config_digest,
            entrypoint,
            platform,
            object_key,
            policy_version,
            status: 'PREFLIGHT',
          };
          insertedSubmissions.push(row);
          submissions.set(id, row);
          return { rows: [row] };
        }
        if (sql.includes('UPDATE submission_reservations SET status = $1')) {
          const [status, submission_id, completed_at, id] = params;
          const res = reservations.get(id);
          if (res) {
            reservations.set(id, { ...res, status, submission_id, completed_at });
          }
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    return callback(tx);
  });

  return {
    query,
    transaction,
    close: vi.fn(),
    insertedSubmissions,
    reservations,
    submissions,
    setFailTransaction: (fail: boolean) => {
      failTransaction = fail;
    },
  };
}

function createUploadApp(options: {
  database: Database;
  storage: ObjectStorage;
  getPrincipal?: () => SessionPrincipal | null;
}) {
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => {
    request.principal = options.getPrincipal ? options.getPrincipal() : null;
  });
  registerSubmissionRoutes(app, {
    database: options.database,
    storage: options.storage,
    now: () => new Date('2026-10-10T12:00:00.000Z'),
  });
  return app;
}

function createApp(principal: SessionPrincipal | null, query: ReturnType<typeof vi.fn>) {
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal; });
  registerSubmissionRoutes(app, {
    database: { query, transaction: vi.fn(), close: vi.fn() } as unknown as Database,
    storage: {} as ObjectStorage,
  });
  return app;
}

describe('GET /api/v1/submissions', () => {
  it('returns only the authenticated team submissions without storage internals', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'submission-1', status: 'PREFLIGHT', archive_sha256: `sha256:${'a'.repeat(64)}`, created_at: new Date('2026-10-13T00:00:00.000Z'), preflight_position: 1, object_key: 'private/path' }] });
    const app = createApp({ accountId: 'account-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, query);

    const response = await app.inject({ method: 'GET', url: '/api/v1/submissions' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [{ id: 'submission-1', status: 'PREFLIGHT', archiveSha256: `sha256:${'a'.repeat(64)}`, createdAt: '2026-10-13T00:00:00.000Z', preflightPosition: 1 }],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      preflightQueueLength: 1,
    });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('WHERE s.team_id = $1'), ['team-1']);
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('LIMIT $2 OFFSET $3'), ['team-1', 20, 0]);
    expect(response.body).not.toContain('object_key');
    await app.close();
  });

  it('denies BTC accounts rather than accepting a team selector', async () => {
    const query = vi.fn();
    const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, query);

    const response = await app.inject({ method: 'GET', url: '/api/v1/submissions?teamId=team-1' });

    expect(response.statusCode).toBe(403);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('validates pagination before querying', async () => {
    const query = vi.fn();
    const app = createApp({ accountId: 'account-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, query);
    const response = await app.inject({ method: 'GET', url: '/api/v1/submissions?page=0&pageSize=101' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_PAGINATION');
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('applies bounded page and pageSize to the authenticated team query', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ total: '35' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });
    const app = createApp({ accountId: 'account-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, query);

    const response = await app.inject({ method: 'GET', url: '/api/v1/submissions?page=2&pageSize=10' });

    expect(response.statusCode).toBe(200);
    expect(response.json().pagination).toEqual({ page: 2, pageSize: 10, totalItems: 35, totalPages: 4 });
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining('LIMIT $2 OFFSET $3'), ['team-1', 10, 10]);
    await app.close();
  });
});

describe('POST /api/v1/submissions (object key collision & cleanup)', () => {
  it('allows two teams to upload identical bytes: both return 201, receive distinct object keys, and both objects remain in storage', async () => {
    const storage = createMockStorage();
    const db = createMockDb();
    let currentPrincipal: SessionPrincipal = { accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
    const app = createUploadApp({ database: db as unknown as Database, storage: storage as unknown as ObjectStorage, getPrincipal: () => currentPrincipal });

    const archive = makeArchive('shared-starter-kit');
    const expectedShaHex = createHash('sha256').update(archive).digest('hex');

    // Team 1 uploads
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { 'content-type': 'application/octet-stream' },
      payload: archive,
    });
    expect(res1.statusCode).toBe(201);
    expect(db.insertedSubmissions).toHaveLength(1);
    const key1 = db.insertedSubmissions[0].object_key;
    expect(key1).toMatch(new RegExp(`^submissions\\/${expectedShaHex}\\/[0-9a-f-]{36}\\.oci\\.tar$`));
    expect(storage.store.has(key1)).toBe(true);

    // Team 2 uploads identical bytes
    currentPrincipal = { accountId: 'acc-2', role: 'TEAM_ACCOUNT', teamId: 'team-2' };
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { 'content-type': 'application/octet-stream' },
      payload: archive,
    });
    expect(res2.statusCode).toBe(201);
    expect(db.insertedSubmissions).toHaveLength(2);
    const key2 = db.insertedSubmissions[1].object_key;
    expect(key2).toMatch(new RegExp(`^submissions\\/${expectedShaHex}\\/[0-9a-f-]{36}\\.oci\\.tar$`));
    expect(key1).not.toBe(key2);

    // Both objects still present in storage
    expect(storage.store.has(key1)).toBe(true);
    expect(storage.store.has(key2)).toBe(true);
    expect(storage.store.size).toBe(2);

    await app.close();
  });

  it('idempotent retry with the same reservation returns 200 and removes the newly copied object without extra storage', async () => {
    const storage = createMockStorage();
    const db = createMockDb();
    const currentPrincipal: SessionPrincipal = { accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
    const app = createUploadApp({ database: db as unknown as Database, storage: storage as unknown as ObjectStorage, getPrincipal: () => currentPrincipal });

    const archive = makeArchive('retry-bot');
    const archiveSha256 = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
    const reservationId = randomUUID();

    // Create reservation for team-1
    db.reservations.set(reservationId, {
      id: reservationId,
      team_id: 'team-1',
      qualification_round_id: 'round-1',
      archive_sha256: archiveSha256,
      reserved_at: new Date('2026-10-10T10:00:00.000Z'),
      grace_ends_at: new Date('2026-10-26T00:00:00.000Z'),
      status: 'RESERVED',
      submission_id: null,
      completed_at: null,
    });

    // First upload with reservation -> 201
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: {
        'content-type': 'application/octet-stream',
        'x-reservation-id': reservationId,
      },
      payload: archive,
    });
    expect(res1.statusCode).toBe(201);
    const subId = res1.json().data.id;
    const initialKey = db.insertedSubmissions[0].object_key;
    expect(storage.store.has(initialKey)).toBe(true);
    expect(storage.store.size).toBe(1);

    // Reservation is now COMPLETED
    const resRow = db.reservations.get(reservationId);
    expect(resRow.status).toBe('COMPLETED');
    expect(resRow.submission_id).toBe(subId);

    // Idempotent retry with same reservation and same archive -> 200
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: {
        'content-type': 'application/octet-stream',
        'x-reservation-id': reservationId,
      },
      payload: archive,
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().data.id).toBe(subId);

    // Storage still contains only the initial object, no extra orphan
    expect(storage.store.has(initialKey)).toBe(true);
    expect(storage.store.size).toBe(1);

    await app.close();
  });

  it('removes only the new object on DB transaction failure, leaving existing objects intact', async () => {
    const storage = createMockStorage();
    const db = createMockDb();
    let currentPrincipal: SessionPrincipal = { accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
    const app = createUploadApp({ database: db as unknown as Database, storage: storage as unknown as ObjectStorage, getPrincipal: () => currentPrincipal });

    const archive = makeArchive('error-path-bot');

    // First successful upload by Team 1
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { 'content-type': 'application/octet-stream' },
      payload: archive,
    });
    expect(res1.statusCode).toBe(201);
    const key1 = db.insertedSubmissions[0].object_key;
    expect(storage.store.has(key1)).toBe(true);
    expect(storage.store.size).toBe(1);

    // Simulate DB failure for Team 2 upload
    db.setFailTransaction(true);
    currentPrincipal = { accountId: 'acc-2', role: 'TEAM_ACCOUNT', teamId: 'team-2' };

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { 'content-type': 'application/octet-stream' },
      payload: archive,
    });
    expect(res2.statusCode).toBe(500);

    // Only the new object was removed; Team 1's key1 is still intact in storage
    expect(storage.store.has(key1)).toBe(true);
    expect(storage.store.size).toBe(1);

    await app.close();
  });
});
