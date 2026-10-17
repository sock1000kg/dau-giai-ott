import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import { CoreGameAdapter, ScriptedBot, runMatch, serializeEventLog } from '@ott/match-runner';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../src/db/client.ts';
import { AuthorizationError } from '../src/modules/auth/authorize.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';
import { registerReplayRoutes } from '../src/modules/replays/routes.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';

function qr<Row extends QueryResultRow = QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    rows,
    rowCount: rows.length,
    command: '',
    oid: 0,
    fields: [],
  };
}

function memoryStorage(): ObjectStorage & { readonly objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key, value) { objects.set(key, Uint8Array.from(value)); },
    async get(key) {
      const value = objects.get(key);
      if (value === undefined) throw new Error('Object not found');
      return Uint8Array.from(value);
    },
    async copy(source, destination) {
      const value = objects.get(source);
      if (value === undefined) throw new Error('Object not found');
      objects.set(destination, Uint8Array.from(value));
    },
    async remove(key) { objects.delete(key); },
  };
}

interface MatchFixture {
  readonly matchId: string;
  readonly stage: 'QUALIFICATION' | 'FINALS';
  readonly state: 'PRIVATE' | 'STAGED' | 'PUBLISHED';
  readonly xTeamId: string;
  readonly oTeamId: string;
  readonly xSubId: string;
  readonly oSubId: string;
  readonly eventLogKey: string;
  readonly eventLogSha256: string;
  readonly finalStateHash: string;
  readonly rawLogBytes: Buffer;
}

async function createFixture(
  stage: 'QUALIFICATION' | 'FINALS',
  state: 'PRIVATE' | 'STAGED' | 'PUBLISHED',
  xTeamId: string,
  oTeamId: string,
): Promise<MatchFixture> {
  const matchId = randomUUID();
  const xSubId = randomUUID();
  const oSubId = randomUUID();

  const game = new CoreGameAdapter();
  const gameConfig = { gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 };
  const firstState = game.create(gameConfig);
  const firstAction = game.listLegalActions(firstState, 'X')[0]!;
  const report = await runMatch(
    { matchId, seed: `SEED-${matchId}`, game: gameConfig, limits: { ...DEFAULT_LIMITS, maxTurns: 1 } },
    { game, bots: { X: new ScriptedBot({ replies: [{ kind: 'action', action: firstAction }] }), O: new ScriptedBot({ replies: [] }) } },
  );
  const rawLogBytes = Buffer.from(serializeEventLog(report.log), 'utf8');
  const checksum = `sha256:${createHash('sha256').update(rawLogBytes).digest('hex')}`;
  const eventLogKey = `match-results/${matchId}/event-log/${checksum}.json`;

  return {
    matchId,
    stage,
    state,
    xTeamId,
    oTeamId,
    xSubId,
    oSubId,
    eventLogKey,
    eventLogSha256: checksum,
    finalStateHash: report.log.footer.result.finalStateHash,
    rawLogBytes,
  };
}

function createMockDatabase(fixtures: readonly MatchFixture[]): Database {
  const fixtureByMatchId = new Map(fixtures.map((f) => [f.matchId, f]));

  return {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      const p = params ?? [];
      const matchId = String(p[0] ?? '');

      // 1. getMatchStage
      if (sql.includes('tournament_stage') && sql.includes('FROM matches m') && sql.includes('JOIN series s')) {
        const fixture = fixtureByMatchId.get(matchId);
        if (fixture) {
          return qr([{ tournament_stage: fixture.stage }] as unknown as Row[]);
        }
        return qr([] as Row[]);
      }

      // 2. assertPrivateReplayAccess - matches
      if (sql.includes('x_submission_id') && sql.includes('FROM matches m')) {
        const fixture = fixtureByMatchId.get(matchId);
        if (fixture) {
          return qr([{ x_submission_id: fixture.xSubId, o_submission_id: fixture.oSubId }] as unknown as Row[]);
        }
        return qr([] as Row[]);
      }

      // 3. assertPrivateReplayAccess - submissions
      if (sql.includes('FROM submissions WHERE id IN')) {
        const subIds = [String(p[0]), String(p[1])];
        const matchingTeams: { team_id: string }[] = [];
        for (const fixture of fixtures) {
          if (subIds.includes(fixture.xSubId)) matchingTeams.push({ team_id: fixture.xTeamId });
          if (subIds.includes(fixture.oSubId)) matchingTeams.push({ team_id: fixture.oTeamId });
        }
        return qr(matchingTeams as unknown as Row[]);
      }

      // 4. BTC account check
      if (sql.includes('FROM accounts WHERE id = $1')) {
        return qr([{ role: 'BTC_ADMIN', status: 'ACTIVE' }] as unknown as Row[]);
      }

      // 5. storedReplay and replayIdentity
      if (sql.includes('FROM matches m') && sql.includes('LEFT JOIN match_results r')) {
        const fixture = fixtureByMatchId.get(matchId);
        if (fixture) {
          return qr([{
            status: 'FINALIZED',
            event_log_key: fixture.eventLogKey,
            event_log_sha256: fixture.eventLogSha256,
            final_state_hash: fixture.finalStateHash,
            publication_state: fixture.state,
          }] as unknown as Row[]);
        }
        return qr([] as Row[]);
      }

      // 6. stage / publish transitions
      if (sql.includes('replay_publications') && (sql.includes('UPDATE') || sql.includes('SELECT') || sql.includes('INSERT'))) {
        const fixture = fixtureByMatchId.get(matchId);
        if (fixture) {
          return qr([{
            match_id: fixture.matchId,
            state: fixture.state,
            event_log_sha256: fixture.eventLogSha256,
            created_at: new Date(),
            updated_at: new Date(),
            staged_at: null,
            published_at: null,
          }] as unknown as Row[]);
        }
        return qr([] as Row[]);
      }

      return qr([] as Row[]);
    },
    async transaction<T>(callback: (client: Database) => Promise<T>): Promise<T> {
      return callback(this);
    },
    async close() {},
  };
}

function createTestApp(principal: SessionPrincipal | null, database: Database, storage: ObjectStorage): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal; });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthorizationError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Internal error' } });
  });
  registerReplayRoutes(app, { database, storage });
  return app;
}

describe('P3-D05 Replays Authorization Routes and Policy Matrix', () => {
  const teamXId = randomUUID();
  const teamOId = randomUUID();
  const thirdTeamId = randomUUID();
  const btcAccountId = randomUUID();

  const principals = {
    anonymous: null,
    teamX: { accountId: randomUUID(), role: 'TEAM_ACCOUNT' as const, teamId: teamXId },
    teamO: { accountId: randomUUID(), role: 'TEAM_ACCOUNT' as const, teamId: teamOId },
    thirdTeam: { accountId: randomUUID(), role: 'TEAM_ACCOUNT' as const, teamId: thirdTeamId },
    btc: { accountId: btcAccountId, role: 'BTC_ADMIN' as const, teamId: undefined },
  };

  it('enforces the complete actor × match stage × publication state × endpoint matrix', async () => {
    const qualPrivate = await createFixture('QUALIFICATION', 'PRIVATE', teamXId, teamOId);
    const qualPublished = await createFixture('QUALIFICATION', 'PUBLISHED', teamXId, teamOId);
    const finalsPrivate = await createFixture('FINALS', 'PRIVATE', teamXId, teamOId);
    const finalsStaged = await createFixture('FINALS', 'STAGED', teamXId, teamOId);
    const finalsPublished = await createFixture('FINALS', 'PUBLISHED', teamXId, teamOId);

    const fixtures = [qualPrivate, qualPublished, finalsPrivate, finalsStaged, finalsPublished];
    const storage = memoryStorage();
    for (const f of fixtures) {
      await storage.put(f.eventLogKey, f.rawLogBytes);
    }
    const database = createMockDatabase(fixtures);

    // Matrix actors and assertions
    for (const fixture of fixtures) {
      // 1. Anonymous actor
      {
        const app = createTestApp(principals.anonymous, database, storage);
        // Private endpoint -> 401 UNAUTHENTICATED
        const priv = await app.inject({ method: 'GET', url: `/api/v1/replays/${fixture.matchId}` });
        expect(priv.statusCode).toBe(401);
        expect(priv.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } });

        // Public endpoint -> 200 only if FINALS PUBLISHED, else 404
        const pub = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${fixture.matchId}` });
        if (fixture.stage === 'FINALS' && fixture.state === 'PUBLISHED') {
          expect(pub.statusCode).toBe(200);
          expect(pub.headers['cache-control']).toBe('public, max-age=3600, immutable');
        } else {
          expect(pub.statusCode).toBe(404);
          expect(pub.json()).toEqual({ error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' } });
        }
        await app.close();
      }

      // 2. Team X (participant)
      {
        const app = createTestApp(principals.teamX, database, storage);
        const priv = await app.inject({ method: 'GET', url: `/api/v1/replays/${fixture.matchId}` });
        expect(priv.statusCode).toBe(200);
        expect(priv.headers['cache-control']).toBe('private, no-store');
        expect(priv.headers['content-type']).toContain('application/vnd.ott.spectator-replay+json');

        const pub = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${fixture.matchId}` });
        if (fixture.stage === 'FINALS' && fixture.state === 'PUBLISHED') {
          expect(pub.statusCode).toBe(200);
        } else {
          expect(pub.statusCode).toBe(404);
        }
        await app.close();
      }

      // 3. Team O (participant)
      {
        const app = createTestApp(principals.teamO, database, storage);
        const priv = await app.inject({ method: 'GET', url: `/api/v1/replays/${fixture.matchId}` });
        expect(priv.statusCode).toBe(200);
        expect(priv.headers['cache-control']).toBe('private, no-store');

        const pub = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${fixture.matchId}` });
        if (fixture.stage === 'FINALS' && fixture.state === 'PUBLISHED') {
          expect(pub.statusCode).toBe(200);
        } else {
          expect(pub.statusCode).toBe(404);
        }
        await app.close();
      }

      // 4. Third team (non-participant)
      {
        const app = createTestApp(principals.thirdTeam, database, storage);
        // Private endpoint -> 404 (existence not leaked)
        const priv = await app.inject({ method: 'GET', url: `/api/v1/replays/${fixture.matchId}` });
        expect(priv.statusCode).toBe(404);
        expect(priv.json()).toEqual({ error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' } });

        const pub = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${fixture.matchId}` });
        if (fixture.stage === 'FINALS' && fixture.state === 'PUBLISHED') {
          expect(pub.statusCode).toBe(200);
        } else {
          expect(pub.statusCode).toBe(404);
        }
        await app.close();
      }

      // 5. BTC Admin
      {
        const app = createTestApp(principals.btc, database, storage);
        const priv = await app.inject({ method: 'GET', url: `/api/v1/replays/${fixture.matchId}` });
        expect(priv.statusCode).toBe(200);
        expect(priv.headers['cache-control']).toBe('private, no-store');

        const pub = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${fixture.matchId}` });
        if (fixture.stage === 'FINALS' && fixture.state === 'PUBLISHED') {
          expect(pub.statusCode).toBe(200);
        } else {
          expect(pub.statusCode).toBe(404);
        }
        await app.close();
      }
    }
  });

  it('rejects stage and publish for QUALIFICATION match with 409 REPLAY_NOT_PUBLIC_STAGE', async () => {
    const qualFixture = await createFixture('QUALIFICATION', 'PRIVATE', teamXId, teamOId);
    const storage = memoryStorage();
    await storage.put(qualFixture.eventLogKey, qualFixture.rawLogBytes);
    const database = createMockDatabase([qualFixture]);

    const app = createTestApp(principals.btc, database, storage);

    const stageRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/replays/${qualFixture.matchId}/stage`,
      payload: { reason: 'Stage attempt' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(stageRes.statusCode).toBe(409);
    expect(stageRes.json()).toEqual({
      error: { code: 'REPLAY_NOT_PUBLIC_STAGE', message: 'Replay publication is only allowed for FINALS stage matches' },
    });

    const publishRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/replays/${qualFixture.matchId}/publish`,
      payload: { reason: 'Publish attempt' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(publishRes.statusCode).toBe(409);
    expect(publishRes.json()).toEqual({
      error: { code: 'REPLAY_NOT_PUBLIC_STAGE', message: 'Replay publication is only allowed for FINALS stage matches' },
    });

    await app.close();
  });

  it('returns identical projection bytes and checksum between private and public for FINALS PUBLISHED', async () => {
    const finalsFixture = await createFixture('FINALS', 'PUBLISHED', teamXId, teamOId);
    const storage = memoryStorage();
    await storage.put(finalsFixture.eventLogKey, finalsFixture.rawLogBytes);
    const database = createMockDatabase([finalsFixture]);

    const teamApp = createTestApp(principals.teamX, database, storage);
    const privRes = await teamApp.inject({ method: 'GET', url: `/api/v1/replays/${finalsFixture.matchId}` });
    expect(privRes.statusCode).toBe(200);
    await teamApp.close();

    const anonApp = createTestApp(principals.anonymous, database, storage);
    const pubRes = await anonApp.inject({ method: 'GET', url: `/api/v1/public/replays/${finalsFixture.matchId}` });
    expect(pubRes.statusCode).toBe(200);
    await anonApp.close();

    expect(privRes.body).toBe(pubRes.body);
    expect(privRes.headers['x-replay-sha256']).toBe(pubRes.headers['x-replay-sha256']);

    // Never leak seed, object key, submission metadata
    expect(privRes.body).not.toContain('SEED');
    expect(privRes.body).not.toContain('match-results/');
    expect(privRes.body).not.toContain('private/');
  });

  it('detects tampered storage artifact on private read and fails with 409 REPLAY_INTEGRITY_FAILED', async () => {
    const qualFixture = await createFixture('QUALIFICATION', 'PRIVATE', teamXId, teamOId);
    const storage = memoryStorage();
    const tampered = Buffer.from(qualFixture.rawLogBytes);
    tampered[0] = tampered[0]! ^ 1;
    await storage.put(qualFixture.eventLogKey, tampered);
    const database = createMockDatabase([qualFixture]);

    const app = createTestApp(principals.teamX, database, storage);
    const res = await app.inject({ method: 'GET', url: `/api/v1/replays/${qualFixture.matchId}` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'REPLAY_INTEGRITY_FAILED', message: 'Replay integrity verification failed' } });
    await app.close();
  });

  it('validates UUID parameter format and returns 404 for invalid matchId', async () => {
    const storage = memoryStorage();
    const database = createMockDatabase([]);
    const app = createTestApp(principals.btc, database, storage);

    const res = await app.inject({ method: 'GET', url: '/api/v1/replays/not-a-uuid' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' } });
    await app.close();
  });

  it('maps DB trigger error message to 409 REPLAY_NOT_PUBLIC_STAGE fallback', async () => {
    const finalsFixture = await createFixture('FINALS', 'PRIVATE', teamXId, teamOId);
    const storage = memoryStorage();
    await storage.put(finalsFixture.eventLogKey, finalsFixture.rawLogBytes);

    // Mock DB that throws the PostgreSQL trigger error message
    const triggerDb: Database = {
      async query<Row extends QueryResultRow = QueryResultRow>(sql: string): Promise<QueryResult<Row>> {
        if (sql.includes('tournament_stage') && sql.includes('FROM matches m')) {
          // Bypass service stage check by returning FINALS
          return qr([{ tournament_stage: 'FINALS' }] as unknown as Row[]);
        }
        if (sql.includes('FROM accounts WHERE id = $1')) {
          return qr([{ role: 'BTC_ADMIN', status: 'ACTIVE' }] as unknown as Row[]);
        }
        if (sql.includes('storedReplay') || (sql.includes('FROM matches m') && sql.includes('LEFT JOIN match_results r'))) {
          return qr([{
            status: 'FINALIZED',
            event_log_key: finalsFixture.eventLogKey,
            event_log_sha256: finalsFixture.eventLogSha256,
            final_state_hash: finalsFixture.finalStateHash,
            publication_state: 'PRIVATE',
          }] as unknown as Row[]);
        }
        if (sql.includes('replay_publications') && (sql.includes('SELECT') || sql.includes('INSERT'))) {
          return qr([{
            match_id: finalsFixture.matchId,
            state: 'PRIVATE',
            event_log_sha256: finalsFixture.eventLogSha256,
            created_at: new Date(),
            updated_at: new Date(),
            staged_at: null,
            published_at: null,
          }] as unknown as Row[]);
        }
        if (sql.includes('replay_publications') && sql.includes('UPDATE')) {
          throw new Error('error: replay publication requires FINALS stage');
        }
        return qr([] as Row[]);
      },
      async transaction<T>(callback: (client: Database) => Promise<T>): Promise<T> {
        return callback(this);
      },
      async close() {},
    };

    const app = createTestApp(principals.btc, triggerDb, storage);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/replays/${finalsFixture.matchId}/stage`,
      payload: { reason: 'Trigger fallback test' },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'REPLAY_NOT_PUBLIC_STAGE', message: 'Replay publication is only allowed for FINALS stage matches' },
    });
    await app.close();
  });
});
