import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import type { SessionStore } from '../src/modules/auth/sessions.ts';
import type { PasswordHasher, SessionPrincipal } from '../src/modules/auth/types.ts';
import { registerTeamRoutes } from '../src/modules/teams/routes.ts';

function createApp(principal: SessionPrincipal | null, database: Partial<Database>) {
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => {
    request.principal = principal;
  });

  const hasher: PasswordHasher = {
    hash: vi.fn().mockResolvedValue('$argon2id$mockhash'),
    verify: vi.fn().mockResolvedValue(true),
  };

  const sessionStore: SessionStore = {
    create: vi.fn().mockResolvedValue('token'),
    read: vi.fn().mockResolvedValue(null),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeAccount: vi.fn().mockResolvedValue(undefined),
  };

  registerTeamRoutes(app, {
    database: database as unknown as Database,
    passwordHasher: hasher,
    sessionStore,
  });

  return app;
}

describe('bulk team routes (bulk-teams.routes.test.ts)', () => {
  describe('GET /api/v1/admin/teams', () => {
    it('returns representativeEmail in team list for BTC_ADMIN', async () => {
      const query = vi.fn().mockResolvedValueOnce({
        rows: [
          { id: '11111111-1111-1111-1111-111111111111', name: 'Team A', representative_email: 'a@example.com' },
          { id: '22222222-2222-2222-2222-222222222222', name: 'Team B', representative_email: null },
        ],
      });
      const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, { query });

      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/teams' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        data: [
          { id: '11111111-1111-1111-1111-111111111111', name: 'Team A', representativeEmail: 'a@example.com' },
          { id: '22222222-2222-2222-2222-222222222222', name: 'Team B', representativeEmail: null },
        ],
      });
      await app.close();
    });
  });

  describe('POST /api/v1/admin/teams/bulk-import', () => {
    it('requires BTC_ADMIN role (401 unauth, 403 team account)', async () => {
      const appUnauth = createApp(null, { query: vi.fn() });
      const resUnauth = await appUnauth.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        payload: { csv: 'team_name,representative_email\nTeam 1,t1@example.com\n' },
      });
      expect(resUnauth.statusCode).toBe(401);
      await appUnauth.close();

      const appTeam = createApp({ accountId: 'team-acc', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, { query: vi.fn() });
      const resTeam = await appTeam.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        payload: { csv: 'team_name,representative_email\nTeam 1,t1@example.com\n' },
      });
      expect(resTeam.statusCode).toBe(403);
      await appTeam.close();
    });

    it('enforces strict body (no unknown keys, csv must be string)', async () => {
      const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, { query: vi.fn() });

      const resUnknown = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        payload: { csv: 'team_name,representative_email\nTeam 1,t1@example.com\n', extra: 'bad' },
      });
      expect(resUnknown.statusCode).toBe(400);
      expect(resUnknown.json().error.code).toBe('INVALID_INPUT');

      const resNonString = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        payload: { csv: 12345 },
      });
      expect(resNonString.statusCode).toBe(400);
      expect(resNonString.json().error.code).toBe('INVALID_INPUT');

      await app.close();
    });

    it('returns 400 CSV_INVALID with row errors on validation failure', async () => {
      const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, { query: vi.fn() });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        payload: { csv: 'team_name,representative_email\n,bademail\n' },
      });
      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error.code).toBe('CSV_INVALID');
      expect(json.error.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ row: 1, column: 'team_name', code: 'TEAM_NAME_INVALID' }),
          expect.objectContaining({ row: 1, column: 'representative_email', code: 'EMAIL_INVALID' }),
        ]),
      );
      await app.close();
    });

    it('returns 409 CSV_CONFLICT when pre-check finds existing team or email', async () => {
      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT pg_advisory_xact_lock')) return { rows: [] };
        if (sql.includes('SELECT lower(name) AS name FROM teams')) {
          return { rows: [{ name: 'team 1' }] };
        }
        if (sql.includes('SELECT lower(representative_email) AS email FROM teams')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const transaction = vi.fn().mockImplementation(async (callback) => {
        return callback({ query });
      });

      const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, { query, transaction });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        payload: { csv: 'team_name,representative_email\nTeam 1,t1@example.com\n' },
      });

      expect(res.statusCode).toBe(409);
      const json = res.json();
      expect(json.error.code).toBe('CSV_CONFLICT');
      expect(json.error.errors).toEqual([
        { row: 1, column: 'team_name', code: 'TEAM_NAME_TAKEN' },
      ]);
      await app.close();
    });

    it('returns 200 with required headers and CSV body on success', async () => {
      const query = vi.fn().mockImplementation(async (sql: string) => {
        return { rows: [] };
      });
      const transaction = vi.fn().mockImplementation(async (callback) => {
        return callback({ query });
      });

      const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, { query, transaction });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-import',
        payload: { csv: 'team_name,representative_email\nTeam Alpha,alpha@example.com\n' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="team-credentials-.*\.csv"$/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-batch-id']).toBeDefined();
      expect(res.body).toContain('team_name,representative_email,username,password');
      expect(res.body).toContain('Team Alpha,alpha@example.com,');
      await app.close();
    });
  });

  describe('POST /api/v1/admin/teams/bulk-reset', () => {
    it('requires BTC_ADMIN role (401 unauth, 403 team account)', async () => {
      const appUnauth = createApp(null, { query: vi.fn() });
      const resUnauth = await appUnauth.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-reset',
        payload: { teamIds: ['11111111-1111-1111-1111-111111111111'] },
      });
      expect(resUnauth.statusCode).toBe(401);
      await appUnauth.close();

      const appTeam = createApp({ accountId: 'team-acc', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, { query: vi.fn() });
      const resTeam = await appTeam.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-reset',
        payload: { teamIds: ['11111111-1111-1111-1111-111111111111'] },
      });
      expect(resTeam.statusCode).toBe(403);
      await appTeam.close();
    });

    it('enforces strict body (only teamIds array with 1-500 unique valid UUIDs)', async () => {
      const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, { query: vi.fn() });

      // Extra property
      const resExtra = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-reset',
        payload: { teamIds: ['11111111-1111-1111-1111-111111111111'], extra: 1 },
      });
      expect(resExtra.statusCode).toBe(400);

      // Empty array
      const resEmpty = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-reset',
        payload: { teamIds: [] },
      });
      expect(resEmpty.statusCode).toBe(400);

      // Duplicate UUIDs
      const resDup = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-reset',
        payload: { teamIds: ['11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111'] },
      });
      expect(resDup.statusCode).toBe(400);

      // Invalid UUID string
      const resInvalidUuid = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-reset',
        payload: { teamIds: ['not-a-uuid'] },
      });
      expect(resInvalidUuid.statusCode).toBe(400);

      await app.close();
    });

    it('returns 409 TEAM_NOT_FOUND with missingIndexes when team/account is not found', async () => {
      const query = vi.fn().mockResolvedValueOnce({
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            name: 'Found Team',
            representative_email: 'f@example.com',
            account_id: 'acc-1',
          },
        ],
      });

      const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, { query });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-reset',
        payload: {
          teamIds: [
            '11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222', // missing at index 1
          ],
        },
      });

      expect(res.statusCode).toBe(409);
      const json = res.json();
      expect(json.error.code).toBe('TEAM_NOT_FOUND');
      expect(json.error.missingIndexes).toEqual([1]);
      await app.close();
    });

    it('returns 200 with headers and CSV body on successful bulk reset', async () => {
      const query = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM teams JOIN accounts')) {
          return {
            rows: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                name: 'Alpha Team',
                representative_email: 'alpha@example.com',
                account_id: 'acc-alpha',
              },
            ],
          };
        }
        return { rows: [] };
      });
      const transaction = vi.fn().mockImplementation(async (callback) => {
        return callback({ query });
      });

      const app = createApp({ accountId: 'admin-1', role: 'BTC_ADMIN', teamId: undefined }, { query, transaction });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/teams/bulk-reset',
        payload: { teamIds: ['11111111-1111-1111-1111-111111111111'] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="team-credentials-.*\.csv"$/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-batch-id']).toBeDefined();
      expect(res.body).toContain('team_name,representative_email,username,password');
      expect(res.body).toContain('Alpha Team,alpha@example.com,');
      await app.close();
    });
  });
});
