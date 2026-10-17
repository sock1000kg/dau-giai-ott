import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerSubmissionRoutes } from '../src/modules/submissions/routes.ts';
import type { Database } from '../src/db/client.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';

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
