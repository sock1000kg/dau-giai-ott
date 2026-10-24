import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/db/client.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';
import { registerTestRunRoutes } from '../src/modules/test-runs/routes.ts';
import { getTestRunReplayArtifact, ReplayApiError } from '../src/modules/replays/service.ts';
import { AuthorizationError } from '../src/modules/auth/authorize.ts';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import { CoreGameAdapter, ScriptedBot, runMatch, serializeEventLog } from '@ott/match-runner';
import type { ObjectStorage } from '../src/storage/s3.ts';

function qr<Row extends QueryResultRow = QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

function appFor(principal: SessionPrincipal | null | { accountId: string; role: string; teamId?: string }, override?: { database: Database; storage: ObjectStorage }): ReturnType<typeof Fastify> {
  const db: Database = override?.database ?? {
    async query<Row extends QueryResultRow = QueryResultRow>(sql: string): Promise<QueryResult<Row>> {
      if (sql.includes('FROM qualification_rounds')) return qr([{ id: 'round-1', status: 'SUBMISSION_OPEN', paused_at: null, rules: { testRun: { quotaPerTeamPerDay: 4 } } }] as unknown as Row[]);
      if (sql.includes('COUNT(*) FILTER')) return qr([{ consumed: 1, reserved: 1 }] as unknown as Row[]);
      if (sql.includes('FROM submissions') && sql.includes('created_at')) return qr([{ id: 'sub-1', status: 'ACTIVE', created_at: new Date('2026-01-01T00:00:00Z') }, { id: 'sub-2', status: 'VALID', created_at: new Date('2026-01-02T00:00:00Z') }] as unknown as Row[]);
      if (sql.includes('FROM test_run_reference_bots')) return qr([{ id: 'btc-v1', display_name: 'BTC baseline' }] as unknown as Row[]);
      if (sql.includes('COUNT(*) AS total')) return qr([{ total: 2 }] as unknown as Row[]);
      if (sql.includes('SELECT * FROM test_runs')) return qr([] as Row[]);
      return qr([] as Row[]);
    },
    async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this); },
    async close() {},
  };
  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal as SessionPrincipal | null; });
  app.setErrorHandler((error, _request, reply) => error instanceof AuthorizationError
    ? reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } })
    : reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Internal error' } }));
  registerTestRunRoutes(app, { database: db, storage: override?.storage, enqueuer: { async enqueue() {}, async isPaused() { return false; } } });
  return app;
}

describe('test-run portal API contract', () => {
  it('returns queue pause, quota reservations, eligible submissions and configured BTC references', async () => {
    const app = appFor({ accountId: 'a', role: 'TEAM_ACCOUNT', teamId: 'team-1' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/test-run-policy' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      roundId: 'round-1', quota: { limit: 4, consumed: 1, reserved: 1, remaining: 2 }, admissionPaused: false,
      submissions: [{ id: 'sub-1' }, { id: 'sub-2' }],
      opponents: { referenceBots: [{ id: 'btc-v1', displayName: 'BTC baseline' }], ownSubmissionAllowed: true },
    });
    await app.close();
  });

  it('marks a RUNNING round as closed for test-run admission', async () => {
    let pausedAt: Date | null = null;
    const db: Database = {
      async query<Row extends QueryResultRow = QueryResultRow>(sql: string) {
        if (sql.includes('FROM qualification_rounds')) return qr([{ id: 'round-running', status: 'RUNNING', paused_at: pausedAt, rules: null }] as unknown as Row[]);
        if (sql.includes('COUNT(*) FILTER')) return qr([{ consumed: 0, reserved: 0 }] as unknown as Row[]);
        if (sql.includes('FROM submissions')) return qr([{ id: 'sub-1', status: 'ACTIVE', created_at: new Date() }] as unknown as Row[]);
        if (sql.includes('FROM test_run_reference_bots')) return qr([{ id: 'btc-v1', display_name: 'BTC baseline' }] as unknown as Row[]);
        return qr([] as Row[]);
      },
      async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this); },
      async close() {},
    };
    const app = appFor({ accountId: 'a', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, { database: db, storage: { async get() { return new Uint8Array(); }, async put() {}, async copy() {}, async remove() {} } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/test-run-policy' })).json().data.admissionPaused).toBe(true);
    pausedAt = new Date();
    expect((await app.inject({ method: 'GET', url: '/api/v1/test-run-policy' })).json().data.admissionPaused).toBe(true);
    await app.close();
  });

  it('returns paginated list metadata and rejects invalid pagination', async () => {
    const app = appFor({ accountId: 'a', role: 'TEAM_ACCOUNT', teamId: 'team-1' });
    const response = await app.inject({ method: 'GET', url: '/api/v1/test-runs?page=2&pageSize=1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().pagination).toEqual({ page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
    expect((await app.inject({ method: 'GET', url: '/api/v1/test-runs?page=0' })).statusCode).toBe(400);
    await app.close();
  });

  it('requires authentication for policy', async () => {
    const app = appFor(null);
    expect((await app.inject({ method: 'GET', url: '/api/v1/test-run-policy' })).statusCode).toBe(401);
    await app.close();
  });

  it('rejects roles outside the team/admin boundary on every read endpoint', async () => {
    const app = appFor({ accountId: 'x', role: 'SUBMISSION_REVIEWER' });
    for (const url of ['/api/v1/test-runs', '/api/v1/test-run-policy', '/api/v1/test-runs/00000000-0000-4000-8000-000000000001', '/api/v1/test-runs/00000000-0000-4000-8000-000000000001/replay']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403);
    }
    await app.close();
  });

  it('rejects a create request for a round after submission cutoff', async () => {
    for (const status of ['SUBMISSION_CLOSED', 'RUNNING', 'PUBLISHED']) {
      let inserted = false;
      const db: Database = {
        async query<Row extends QueryResultRow = QueryResultRow>(sql: string) {
          if (sql.includes('FROM qualification_rounds') && sql.includes('FOR SHARE')) return qr([{ id: 'round-closed', status, paused_at: null }] as unknown as Row[]);
          if (sql.includes('INSERT INTO test_runs')) inserted = true;
          return qr([] as Row[]);
        },
        async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this); },
        async close() {},
      };
      const app = appFor({ accountId: 'a', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, { database: db, storage: { async get() { return new Uint8Array(); }, async put() {}, async copy() {}, async remove() {} } });
      const response = await app.inject({
        method: 'POST', url: '/api/v1/test-runs', headers: { 'idempotency-key': `closed-round-${status}-001` },
        payload: { submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-2', roundId: 'round-closed' },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('TEST_RUN_ADMISSION_PAUSED');
      expect(inserted).toBe(false);
      await app.close();
    }
  });

  it('omits execution seed and storage/integrity keys from public TestRun DTOs', async () => {
    const runId = randomUUID();
    const db: Database = {
      async query<Row extends QueryResultRow = QueryResultRow>() {
        return qr([{
          id: runId, team_id: 'team-1', round_id: null, submission_id: 'sub-1', opponent_type: 'OWN_SUBMISSION',
          opponent_submission_id: 'sub-2', opponent_reference_bot: null, status: 'FAILED', quota_consumed: true,
          map_checksum: 'map-checksum', seed: 'private-seed', result: { winnerSide: 'X' }, replay_key: 'private/object-key',
          replay_sha256: `sha256:${'a'.repeat(64)}`, final_state_hash: 'b'.repeat(64), stderr_x: 'limited stderr',
          stderr_o: null, failure_reason: 'BOT_TIMEOUT', is_infra_failure: false, created_at: new Date(),
          started_at: new Date(), finished_at: new Date(),
        }] as unknown as Row[]);
      },
      async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this); },
      async close() {},
    };
    const app = appFor({ accountId: 'a', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, { database: db, storage: { async get() { return new Uint8Array(); }, async put() {}, async copy() {}, async remove() {} } });
    const response = await app.inject({ method: 'GET', url: `/api/v1/test-runs/${runId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ result: { winnerSide: 'X' }, stderrX: 'limited stderr', failureReason: 'BOT_TIMEOUT' });
    for (const key of ['teamId', 'seed', 'mapChecksum', 'replayKey', 'replaySha256', 'finalStateHash']) expect(response.json().data).not.toHaveProperty(key);
    await app.close();
  });

  it('serves only a verified private spectator replay as the raw versioned body', async () => {
    const matchId = randomUUID();
    const game = new CoreGameAdapter();
    const config = { gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 };
    const report = await runMatch({ matchId, seed: 'test-run-seed', game: config, limits: { ...DEFAULT_LIMITS, maxTurns: 1 } }, {
      game,
      bots: { X: new ScriptedBot({ replies: [] }), O: new ScriptedBot({ replies: [] }) },
    });
    const bytes = new TextEncoder().encode(serializeEventLog(report.log));
    const rawSha = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const bodySha = (body: string) => `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
    const db: Database = {
      async query<Row extends QueryResultRow = QueryResultRow>() {
        return qr([{
          id: matchId, team_id: 'team-1', round_id: null, submission_id: 'sub-1', opponent_type: 'BTC_REFERENCE',
          opponent_submission_id: null, opponent_reference_bot: 'btc-v1', status: 'COMPLETED', quota_consumed: true,
          map_checksum: 'map', seed: 'seed', result: report.result, replay_key: 'test-run-replay', replay_sha256: rawSha,
          final_state_hash: report.log.footer.result.finalStateHash, stderr_x: null, stderr_o: null, failure_reason: null,
          is_infra_failure: false, created_at: new Date(), started_at: new Date(), finished_at: new Date(),
        }] as unknown as Row[]);
      },
      async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this); },
      async close() {},
    };
    const storage: ObjectStorage = {
      async get() { return bytes; }, async put() {}, async copy() {}, async remove() {},
    };
    const app = appFor({ accountId: 'a', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, { database: db, storage });
    const response = await app.inject({ method: 'GET', url: `/api/v1/test-runs/${matchId}/replay` });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/vnd\.ott\.spectator-replay\+json;\s*version="?1"?/);
    expect(response.headers['x-replay-sha256']).toBe(bodySha(response.body));
    expect(JSON.parse(response.body).schema).toBe('ott.spectator-replay');
    expect(() => getTestRunReplayArtifact(bytes, matchId, `sha256:${'0'.repeat(64)}`, report.log.footer.result.finalStateHash))
      .toThrowError(ReplayApiError);
    await app.close();
  });

  describe('B4: Test-run self-play, opponent policies & map selection', () => {
    function setupTestApp(roundRulesOverrides: Partial<any> = {}) {
      const teamId = 'team-1';
      const roundMap = { mapId: 'default', checksum: 'a'.repeat(64) };
      const roundRules = {
        mapSet: roundRulesOverrides.mapSet ?? [roundMap],
        testRun: {
          quotaPerTeamPerDay: 5,
          opponents: ['OWN_SUBMISSION', 'BTC_REFERENCE'],
          ...roundRulesOverrides,
        },
      };

      const storedRuns = new Map<string, any>();
      let lastInsertedMapChecksum: string | null = null;

      const db: Database = {
        async query<Row extends QueryResultRow = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>> {
          if (sql.includes('FROM qualification_rounds')) {
            return qr([{ id: 'round-1', status: 'SUBMISSION_OPEN', paused_at: null, rules: roundRules }] as unknown as Row[]);
          }
          if (sql.includes('FROM test_runs WHERE team_id = $1 AND idempotency_key = $2')) {
            const key = `${params?.[0]}:${params?.[1]}`;
            const existing = storedRuns.get(key);
            return qr(existing ? [existing as Row] : []);
          }
          if (sql.includes('COUNT(*) FILTER')) {
            return qr([{ consumed: 0, reserved: 0 }] as unknown as Row[]);
          }
          if (sql.includes('FROM submissions') && sql.includes('WHERE id = $1')) {
            const subId = params?.[0];
            if (subId === 'foreign-sub') {
              return qr([{ id: 'foreign-sub', team_id: 'team-other', status: 'ACTIVE' }] as unknown as Row[]);
            }
            return qr([{ id: subId, team_id: teamId, status: 'ACTIVE' }] as unknown as Row[]);
          }
          if (sql.includes('FROM submissions') && sql.includes('created_at')) {
            return qr([{ id: 'sub-single', status: 'ACTIVE', created_at: new Date() }] as unknown as Row[]);
          }
          if (sql.includes('FROM test_run_reference_bots')) {
            return qr([{ id: 'btc-v1', display_name: 'BTC baseline' }] as unknown as Row[]);
          }
          if (sql.includes('INSERT INTO test_runs')) {
            const runId = randomUUID();
            lastInsertedMapChecksum = params?.[7] as string;
            const record = {
              id: runId,
              team_id: params?.[1],
              round_id: params?.[2],
              submission_id: params?.[3],
              opponent_type: params?.[4],
              opponent_submission_id: params?.[5],
              opponent_reference_bot: params?.[6],
              map_checksum: params?.[7],
              seed: params?.[8],
              status: 'QUEUED',
              quota_consumed: false,
              created_at: new Date(),
              idempotency_key: params?.[10],
              request_hash: params?.[11],
            };
            storedRuns.set(`${record.team_id}:${record.idempotency_key}`, record);
            return qr([record as unknown as Row]);
          }
          if (sql.includes('INSERT INTO test_run_outbox')) {
            return qr([] as Row[]);
          }
          return qr([] as Row[]);
        },
        async transaction<T>(work: (tx: Database) => Promise<T>) { return work(this); },
        async close() {},
      };

      const app = appFor({ accountId: 'a', role: 'TEAM_ACCOUNT', teamId }, { database: db, storage: { async get() { return new Uint8Array(); }, async put() {}, async copy() {}, async remove() {} } });
      return { app, getLastMapChecksum: () => lastInsertedMapChecksum };
    }

    it('accepts self-play test runs (opponentSubmissionId === submissionId)', async () => {
      const { app } = setupTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-self-play-001' },
        payload: { submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-1' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.opponentSubmissionId).toBe('sub-1');
      await app.close();
    });

    it('rejects another team submission as opponent with 403 FORBIDDEN', async () => {
      const { app } = setupTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-foreign-001' },
        payload: { submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'foreign-sub' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('OPPONENT_SUBMISSION_NOT_OWNED');
      await app.close();
    });

    it('rejects mapId/mapChecksum not in round mapSet with 422 MAP_NOT_IN_ROUND', async () => {
      const { app } = setupTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-bad-map-001' },
        payload: {
          submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-1',
          mapId: 'unregistered-map', mapChecksum: 'b'.repeat(64),
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('MAP_NOT_IN_ROUND');
      await app.close();
    });

    it('rejects when only one of mapId or mapChecksum is provided with 400', async () => {
      const { app } = setupTestApp();
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-half-map-001' },
        payload: { submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-1', mapId: 'default' },
      });
      expect(res1.statusCode).toBe(400);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-half-map-002' },
        payload: { submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-1', mapChecksum: 'a'.repeat(64) },
      });
      expect(res2.statusCode).toBe(400);
      await app.close();
    });

    it('defaults to the first map of the mapSet and stores its real checksum', async () => {
      const { app, getLastMapChecksum } = setupTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-default-map-001' },
        payload: { submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-1' },
      });
      expect(res.statusCode).toBe(201);
      expect(getLastMapChecksum()).toBe('a'.repeat(64));
      expect(getLastMapChecksum()).not.toBe('test_map_default');
      await app.close();
    });

    it('rejects same idempotency key with different map with 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const { app } = setupTestApp({
        mapSet: [
          { mapId: 'default', checksum: 'a'.repeat(64) },
          { mapId: 'alt', checksum: 'b'.repeat(64) },
        ],
      });
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-reused-key-001' },
        payload: {
          submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-1',
          mapId: 'default', mapChecksum: 'a'.repeat(64),
        },
      });
      expect(res1.statusCode).toBe(201);

      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-reused-key-001' },
        payload: {
          submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-1',
          mapId: 'alt', mapChecksum: 'b'.repeat(64),
        },
      });
      expect(res2.statusCode).toBe(409);
      expect(res2.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      await app.close();
    });

    it('rejects an opponent type not listed in round testRun.opponents with 400', async () => {
      const { app } = setupTestApp({
        opponents: ['BTC_REFERENCE'],
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/test-runs',
        headers: { 'idempotency-key': 'idem-opp-not-allowed-001' },
        payload: { submissionId: 'sub-1', opponentType: 'OWN_SUBMISSION', opponentSubmissionId: 'sub-1' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_TEST_RUN_OPPONENT');
      await app.close();
    });

    it('policy response returns maps and ownSubmissionAllowed: true with a single submission', async () => {
      const { app } = setupTestApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/test-run-policy',
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.opponents.ownSubmissionAllowed).toBe(true);
      expect(data.maps).toHaveLength(1);
      expect(data.maps[0]).toMatchObject({ mapId: 'default', checksum: 'a'.repeat(64) });
      await app.close();
    });
  });
});
