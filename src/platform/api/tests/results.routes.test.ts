import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerResultRoutes } from '../src/modules/results/routes.ts';
import type { Database } from '../src/db/client.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';

function createApp(principal: SessionPrincipal | null, query: ReturnType<typeof vi.fn>) {
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal; });
  registerResultRoutes(app, { database: { query, transaction: vi.fn(), close: vi.fn() } as unknown as Database });
  return app;
}

describe('P2-T21 match results route', () => {
  it('returns fault summaries and outcome, scoped by team principal without private fields', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ total_count: '1', match_id: 'match-1', series_id: 'series-1', tournament_stage: 'FINAL', game_number: 1, status: 'FINALIZED', x_team_id: 'team-1', x_team_name: 'Team One', o_team_id: 'team-2', o_team_name: 'Team Two', winner_team_id: 'team-2', winner_side: 'O', reason: 'TURN_LIMIT', turn_count: 10, finalized_at: new Date('2026-10-13T00:00:00.000Z'), faults: { X: { recoverableTotal: 1, recoverableConsecutive: 0, lastErrorCode: 'BOT_TIMEOUT', privateMetadata: 'must-not-leak' }, O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null } }, seed: 'secret', event_log_key: 'private' }] });
    const app = createApp({ accountId: 'team-account', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, query);
    const response = await app.inject({ method: 'GET', url: '/api/v1/results/matches?page=1&pageSize=10' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toMatchObject({ matchId: 'match-1', winnerSide: 'O', reason: 'TURN_LIMIT', faults: { X: { recoverableTotal: 1, lastErrorCode: 'BOT_TIMEOUT' } } });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('sx.team_id = $1 OR so.team_id = $1'), ['team-1', null, null, 10, 0]);
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY COALESCE(result.finalized_at, m.created_at) DESC, m.id DESC');
    expect(response.body).not.toContain('secret');
    expect(response.body).not.toContain('private');
    expect(response.body).not.toContain('privateMetadata');
    expect(response.body).not.toContain('must-not-leak');
    await app.close();
  });

  it('allows BTC to filter a team and rejects a team account attempting another team', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const btc = createApp({ accountId: 'btc', role: 'BTC_ADMIN', teamId: undefined }, query);
    const allowed = await btc.inject({ method: 'GET', url: '/api/v1/results/matches?teamId=00000000-0000-4000-8000-000000000001' });
    expect(allowed.statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $4 OFFSET $5'), [null, null, '00000000-0000-4000-8000-000000000001', 25, 0]);
    await btc.close();

    const teamQuery = vi.fn();
    const team = createApp({ accountId: 'team-account', role: 'TEAM_ACCOUNT', teamId: '00000000-0000-4000-8000-000000000002' }, teamQuery);
    const denied = await team.inject({ method: 'GET', url: '/api/v1/results/matches?teamId=00000000-0000-4000-8000-000000000001' });
    expect(denied.statusCode).toBe(403);
    expect(teamQuery).not.toHaveBeenCalled();
    await team.close();
  });
});
