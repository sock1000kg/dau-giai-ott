import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAuthApp,
  createDatabase,
  createPasswordHasher,
  runMigrations,
  type Database,
} from '../src/index.ts';
import { computeRoundResultsHash } from '../src/modules/operations/results-hash.ts';

const enabled = process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip;

const hasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });
const hex = (char: string) => char.repeat(64);

enabled('P3-D07 privileged operations integration', () => {
  let db: Database;
  let redis: RedisClientType;
  let app: ReturnType<typeof createAuthApp>;
  let adminId: string;
  let adminCookie: string;
  const enqueued: { matchId: string; generation: number | undefined }[] = [];

  beforeAll(async () => {
    db = createDatabase({ connectionString: process.env.DATABASE_URL! });
    redis = createClient({ url: process.env.REDIS_URL! });
    await redis.connect();
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(db);
  });

  beforeEach(async () => {
    await redis.flushDb();
    await db.query(
      `TRUNCATE audit_events, queue_overrides, match_outbox, match_attempts, match_results, rating_ledger,
        matches, series, round_participants, rounds, qualification_rounds, round_rule_sets, submissions, sessions, accounts, teams CASCADE`,
    );
    enqueued.length = 0;
    app = createAuthApp({
      database: db,
      redis,
      passwordHasher: hasher,
      secureCookies: false,
      matchEnqueuer: {
        enqueue: async (job, options) => { enqueued.push({ matchId: job.matchId, generation: options?.generation }); return {}; },
      },
    });
    await app.ready();
    adminId = randomUUID();
    await db.query("INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, 'admin', $2, 'BTC_ADMIN')", [adminId, await hasher.hash('adminpass')]);
    adminCookie = await login('admin', 'adminpass');
  });

  afterAll(async () => {
    await app?.close();
    await redis?.quit();
    await db?.close();
  });

  async function login(username: string, password: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
    if (response.statusCode !== 200) return '';
    const header = response.headers['set-cookie'];
    return String(Array.isArray(header) ? header[0] : header).split(';')[0] ?? '';
  }

  async function post(path: string, payload: unknown, headers: Record<string, string> = {}, cookie = adminCookie) {
    return app.inject({ method: 'POST', url: `/api/v1/admin/operations${path}`, headers: { cookie, ...headers }, payload: payload as object });
  }
  async function get(path: string, cookie = adminCookie) {
    return app.inject({ method: 'GET', url: `/api/v1/admin/operations${path}`, headers: { cookie } });
  }
  const count = async (sql: string, values: unknown[] = []) => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`, values)).rows[0]!.n);

  async function createTeam(name: string, password = 'teampass') {
    const teamId = randomUUID();
    const accountId = randomUUID();
    await db.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [teamId, name]);
    await db.query("INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4)", [accountId, name.toLowerCase(), await hasher.hash(password), teamId]);
    return { teamId, accountId, username: name.toLowerCase(), password };
  }

  async function createSubmission(teamId: string, status = 'ACTIVE') {
    const id = randomUUID();
    await db.query(
      `INSERT INTO submissions (id, team_id, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, teamId, `sha256:${hex('a')}`, `sha256:${hex('b')}`, `sha256:${hex('c')}`, `OBJECT_KEY_SENTINEL/${id}`, status],
    );
    return id;
  }

  interface Fixture { readonly roundId: string; readonly seriesId: string; readonly matchId: string; readonly teamA: string; readonly teamB: string; readonly subA: string; readonly subB: string }

  async function createMatch(options: {
    matchStatus?: string; seriesStatus?: string; cancellationReason?: string | null; roundStatus?: string;
    attempt?: { status: string; reason: string | null } | null; result?: boolean; ledger?: boolean; pendingRerun?: boolean;
  } = {}): Promise<Fixture> {
    const a = await createTeam(`Team${randomUUID().slice(0, 6)}A`);
    const b = await createTeam(`Team${randomUUID().slice(0, 6)}B`);
    const subA = await createSubmission(a.teamId);
    const subB = await createSubmission(b.teamId);
    const roundId = randomUUID();
    const seriesId = randomUUID();
    const matchId = randomUUID();
    await db.query(
      "INSERT INTO rounds (id, tournament_stage, idempotency_key, request_hash, schedule_seed, rating_snapshot, status) VALUES ($1,'QUALIFICATION',$2,$3,'SCHEDULE_SEED_SENTINEL','[]'::jsonb,$4)",
      [roundId, randomUUID(), hex('d'), options.roundStatus ?? 'SCHEDULED'],
    );
    await db.query(
      'INSERT INTO series (id, tournament_stage, status, round_id, team_a_id, team_b_id, cancellation_reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [seriesId, 'QUALIFICATION', options.seriesStatus ?? 'CANCELLED', roundId, a.teamId, b.teamId, options.cancellationReason === undefined ? 'INFRASTRUCTURE_FAILURE' : options.cancellationReason],
    );
    await db.query(
      "INSERT INTO matches (id, series_id, x_submission_id, o_submission_id, status, game_number, seed) VALUES ($1,$2,$3,$4,$5,1,'SEED_SENTINEL')",
      [matchId, seriesId, subA, subB, options.matchStatus ?? 'FAILED'],
    );
    const job = {
      schemaVersion: 'ott.match-job.v1', matchId, idempotencyKey: matchId, policyVersion: 'P2_BASELINE_V1',
      x: { submissionId: subA, archiveSha256: `sha256:${hex('a')}`, manifestDigest: `sha256:${hex('b')}`, configDigest: `sha256:${hex('c')}`, policyVersion: 'P2_BASELINE_V1' },
      o: { submissionId: subB, archiveSha256: `sha256:${hex('a')}`, manifestDigest: `sha256:${hex('b')}`, configDigest: `sha256:${hex('c')}`, policyVersion: 'P2_BASELINE_V1' },
    };
    await db.query("INSERT INTO match_outbox (match_id, event_type, payload, dispatched_at) VALUES ($1,'MATCH_SCHEDULED',$2::jsonb, now())", [matchId, JSON.stringify(job)]);
    const attempt = options.attempt === undefined ? { status: 'FAILED_TERMINAL', reason: 'MATCH_LEASE_EXPIRED' } : options.attempt;
    if (attempt !== null) {
      await db.query('INSERT INTO match_attempts (id, match_id, attempt_number, status, failure_reason) VALUES ($1,$2,1,$3,$4)', [randomUUID(), matchId, attempt.status, attempt.reason]);
    }
    if (options.result) {
      await db.query("INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash, event_log_sha256) VALUES ($1,'X','FORFEIT',4,$2,$3)", [matchId, hex('1'), `sha256:${hex('2')}`]);
    }
    if (options.ledger) {
      await db.query('INSERT INTO rating_ledger (team_id, series_id, rating_before, rating_after, delta) VALUES ($1,$2,1000,1010,10)', [a.teamId, seriesId]);
    }
    if (options.pendingRerun) {
      await db.query("INSERT INTO match_outbox (match_id, event_type, payload, generation) VALUES ($1,'MATCH_RERUN',$2::jsonb,1)", [matchId, JSON.stringify(job)]);
    }
    return { roundId, seriesId, matchId, teamA: a.teamId, teamB: b.teamId, subA, subB };
  }

  const rerunBody = { reason: 'worker lost lease', publicReason: 'Worker restarted during the match', verifiedInfraFailure: true };

  describe('append-only history', () => {
    it('rejects UPDATE and DELETE on audit_events and queue_overrides', async () => {
      const f = await createMatch();
      expect((await post(`/matches/${f.matchId}/rerun`, rerunBody, { 'idempotency-key': 'k1' })).statusCode).toBe(200);

      await expect(db.query("UPDATE audit_events SET reason = 'tampered'")).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM audit_events')).rejects.toThrow(/append-only/);
      await expect(db.query("UPDATE queue_overrides SET public_reason = 'tampered'")).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM queue_overrides')).rejects.toThrow(/append-only/);
      expect(await count('audit_events WHERE reason = $1', ['tampered'])).toBe(0);
    });

    it('keeps one match_outbox row per (match, event, generation)', async () => {
      const f = await createMatch();
      await db.query("INSERT INTO match_outbox (match_id, event_type, payload, generation) VALUES ($1,'MATCH_SCHEDULED','{}'::jsonb,1)", [f.matchId]);
      await expect(db.query("INSERT INTO match_outbox (match_id, event_type, payload, generation) VALUES ($1,'MATCH_SCHEDULED','{}'::jsonb,1)", [f.matchId])).rejects.toMatchObject({ code: '23505' });
      await expect(db.query("INSERT INTO match_outbox (match_id, event_type, payload) VALUES ($1,'MATCH_SCHEDULED','{}'::jsonb)", [f.matchId])).rejects.toMatchObject({ code: '23505' });
    });
  });

  describe('team suspension', () => {
    it('suspends, revokes the session, blocks login, audits once and replays idempotently; unsuspend restores access', async () => {
      const team = await createTeam('Alpha');
      const teamCookie = await login(team.username, team.password);
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: teamCookie } })).statusCode).toBe(200);

      const correlation = randomUUID();
      const headers = { 'x-correlation-id': correlation, 'idempotency-key': 'suspend-1' };
      const first = await post(`/teams/${team.teamId}/suspend`, { reason: 'confirmed collusion' }, headers);
      expect(first.statusCode).toBe(200);
      expect(first.headers['x-correlation-id']).toBe(correlation);
      expect(first.json().correlationId).toBe(correlation);

      expect((await db.query<{ status: string }>('SELECT status FROM accounts WHERE id = $1', [team.accountId])).rows[0]!.status).toBe('DISABLED');
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: teamCookie } })).statusCode).toBe(401);
      expect(await login(team.username, team.password)).toBe('');

      const audits = await db.query<{ correlation_id: string; details: { before: unknown; after: unknown }; reason: string }>(
        "SELECT correlation_id, details, reason FROM audit_events WHERE action = 'TEAM_SUSPENDED'");
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]!.correlation_id).toBe(correlation);
      expect(audits.rows[0]!.reason).toBe('confirmed collusion');
      expect(audits.rows[0]!.details.before).toMatchObject({ active: 1, disabled: 0 });
      expect(audits.rows[0]!.details.after).toMatchObject({ active: 0, disabled: 1 });

      const replay = await post(`/teams/${team.teamId}/suspend`, { reason: 'confirmed collusion' }, headers);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().data.replayed).toBe(true);
      expect(await count("audit_events WHERE action = 'TEAM_SUSPENDED'")).toBe(1);
      expect((await post(`/teams/${team.teamId}/suspend`, { reason: 'another reason' }, headers)).statusCode).toBe(409);
      expect((await post(`/teams/${team.teamId}/suspend`, { reason: 'again' }, { 'idempotency-key': 'suspend-2' })).json().error.code).toBe('TRANSITION_INVALID');

      expect((await post(`/teams/${team.teamId}/unsuspend`, { reason: 'appeal upheld' })).statusCode).toBe(200);
      expect(await login(team.username, team.password)).not.toBe('');
      expect(await count("audit_events WHERE action = 'TEAM_UNSUSPENDED'")).toBe(1);
    });

    it('denies team accounts and anonymous callers', async () => {
      const team = await createTeam('Beta');
      const teamCookie = await login(team.username, team.password);
      expect((await post(`/teams/${team.teamId}/suspend`, { reason: 'x' }, {}, teamCookie)).statusCode).toBe(403);
      expect((await post(`/teams/${team.teamId}/suspend`, { reason: 'x' }, {}, '')).statusCode).toBe(401);
      expect(await count('audit_events WHERE action = $1', ['TEAM_SUSPENDED'])).toBe(0);
    });
  });

  describe('submission revoke', () => {
    it('revokes ACTIVE and VALID submissions without touching existing results; rejects other states', async () => {
      const f = await createMatch({ matchStatus: 'FINALIZED', seriesStatus: 'FINALIZED', cancellationReason: null, result: true, attempt: { status: 'SUCCEEDED', reason: null } });
      const resultsBefore = await db.query('SELECT * FROM match_results');
      const response = await post(`/submissions/${f.subA}/revoke`, { reason: 'malicious payload' });
      expect(response.statusCode).toBe(200);
      expect((await db.query<{ status: string }>('SELECT status FROM submissions WHERE id = $1', [f.subA])).rows[0]!.status).toBe('REVOKED');
      expect((await db.query('SELECT * FROM match_results')).rows).toEqual(resultsBefore.rows);
      const audit = await db.query<{ details: { before: { status: string; playedMatches: number }; after: { status: string } } }>("SELECT details FROM audit_events WHERE action = 'SUBMISSION_REVOKED'");
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]!.details.before).toMatchObject({ status: 'ACTIVE', playedMatches: 1 });
      expect(audit.rows[0]!.details.after.status).toBe('REVOKED');

      expect((await post(`/submissions/${f.subA}/revoke`, { reason: 'again' })).json().error.code).toBe('TRANSITION_INVALID');
      const team = await createTeam('Gamma');
      const valid = await createSubmission(team.teamId, 'VALID');
      expect((await post(`/submissions/${valid}/revoke`, { reason: 'valid one' })).statusCode).toBe(200);
      for (const status of ['UPLOADED', 'INVALID', 'PREFLIGHT', 'SUPERSEDED']) {
        const other = await createTeam(`Other${status}`);
        const id = await createSubmission(other.teamId, status);
        expect((await post(`/submissions/${id}/revoke`, { reason: 'nope' })).statusCode, status).toBe(409);
      }
      expect((await post(`/submissions/${randomUUID()}/revoke`, { reason: 'ghost' })).statusCode).toBe(404);
    });
  });

  describe('rerun and cancel', () => {
    it('reruns an infra-failed match: new outbox generation, series reopened, one audit/override, no result or rating rows', async () => {
      const f = await createMatch();
      const resultsBefore = await count('match_results');
      const ledgerBefore = await count('rating_ledger');
      const correlation = randomUUID();
      const response = await post(`/matches/${f.matchId}/rerun`, rerunBody, { 'x-correlation-id': correlation, 'idempotency-key': 'rerun-1' });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ matchStatus: 'SCHEDULED', seriesStatus: 'SCHEDULED', outboxGeneration: 1, replayed: false });

      expect((await db.query<{ status: string }>('SELECT status FROM matches WHERE id = $1', [f.matchId])).rows[0]!.status).toBe('SCHEDULED');
      expect((await db.query<{ status: string; cancellation_reason: string | null; finalized_at: Date | null }>('SELECT status, cancellation_reason, finalized_at FROM series WHERE id = $1', [f.seriesId])).rows[0])
        .toEqual({ status: 'SCHEDULED', cancellation_reason: null, finalized_at: null });
      expect(await count("match_attempts WHERE match_id = $1 AND status = 'FAILED_TERMINAL'", [f.matchId])).toBe(1);
      expect(await count("match_outbox WHERE match_id = $1 AND event_type = 'MATCH_RERUN' AND generation = 1", [f.matchId])).toBe(1);
      expect(await count('match_results')).toBe(resultsBefore);
      expect(await count('rating_ledger')).toBe(ledgerBefore);
      expect(await count('queue_overrides WHERE match_id = $1 AND action = $2', [f.matchId, 'RERUN'])).toBe(1);

      const audits = await db.query<{ correlation_id: string; details: { before: Record<string, unknown>; after: Record<string, unknown> } }>("SELECT correlation_id, details FROM audit_events WHERE action = 'MATCH_RERUN'");
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]!.correlation_id).toBe(correlation);
      expect(audits.rows[0]!.details.before).toMatchObject({ matchStatus: 'FAILED', seriesStatus: 'CANCELLED', lastFailureReason: 'MATCH_LEASE_EXPIRED', verifiedInfraFailure: true });
      expect(audits.rows[0]!.details.after).toMatchObject({ matchStatus: 'SCHEDULED', outboxGeneration: 1 });
      expect(JSON.stringify(audits.rows[0]!.details)).not.toMatch(/SEED_SENTINEL|OBJECT_KEY_SENTINEL/);

      // The API published the rerun job with its generation after commit.
      expect(enqueued).toEqual([{ matchId: f.matchId, generation: 1 }]);
      expect(await count("match_outbox WHERE match_id = $1 AND dispatched_at IS NULL", [f.matchId])).toBe(0);

      // Idempotent retry and a fresh attempt are both refused/neutral.
      const replay = await post(`/matches/${f.matchId}/rerun`, rerunBody, { 'idempotency-key': 'rerun-1' });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().data.replayed).toBe(true);
      expect(await count("audit_events WHERE action = 'MATCH_RERUN'")).toBe(1);
      expect(await count('match_outbox WHERE match_id = $1 AND event_type = $2', [f.matchId, 'MATCH_RERUN'])).toBe(1);
      const second = await post(`/matches/${f.matchId}/rerun`, rerunBody, { 'idempotency-key': 'rerun-2' });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe('RERUN_MATCH_NOT_FAILED');
    });

    it('refuses bot-fault style reasons, resulted matches, settled rounds, operator-cancelled series and pending reruns', async () => {
      const cases: readonly { name: string; options: Parameters<typeof createMatch>[0]; code: string }[] = [
        { name: 'bot fault reason', options: { attempt: { status: 'FAILED_TERMINAL', reason: 'BOT_PROTOCOL_VIOLATION' } }, code: 'RERUN_NOT_INFRA_FAILURE' },
        { name: 'artifact reason', options: { attempt: { status: 'FAILED_TERMINAL', reason: 'ARTIFACT_DOCKER_IDENTITY_MISMATCH' } }, code: 'RERUN_NOT_INFRA_FAILURE' },
        { name: 'retryable attempt', options: { attempt: { status: 'FAILED_RETRYABLE', reason: 'MATCH_LEASE_EXPIRED' } }, code: 'RERUN_NOT_INFRA_FAILURE' },
        { name: 'no attempts', options: { attempt: null }, code: 'RERUN_NOT_INFRA_FAILURE' },
        { name: 'forfeit result', options: { matchStatus: 'FINALIZED', result: true, attempt: { status: 'SUCCEEDED', reason: null } }, code: 'RERUN_MATCH_NOT_FAILED' },
        { name: 'failed but resulted', options: { result: true }, code: 'RERUN_RESULT_EXISTS' },
        { name: 'round finalized', options: { roundStatus: 'FINALIZED' }, code: 'RERUN_ROUND_SETTLED' },
        { name: 'ratings applied', options: { ledger: true }, code: 'RERUN_ROUND_SETTLED' },
        { name: 'cancelled by operator', options: { cancellationReason: 'MATCH_CANCELLED' }, code: 'RERUN_SERIES_CANCELLED_BY_OPERATOR' },
        { name: 'rerun pending', options: { pendingRerun: true }, code: 'RERUN_ALREADY_PENDING' },
      ];
      for (const item of cases) {
        const f = await createMatch(item.options);
        const before = { results: await count('match_results'), ledger: await count('rating_ledger'), outbox: await count('match_outbox'), audits: await count('audit_events'), overrides: await count('queue_overrides') };
        const response = await post(`/matches/${f.matchId}/rerun`, rerunBody);
        expect(response.statusCode, item.name).toBe(409);
        expect(response.json().error.code, item.name).toBe(item.code);
        expect({ results: await count('match_results'), ledger: await count('rating_ledger'), outbox: await count('match_outbox'), audits: await count('audit_events'), overrides: await count('queue_overrides') }, item.name).toEqual(before);
      }
      expect(enqueued).toHaveLength(0);
    });

    it('cancels SCHEDULED/FAILED matches publicly and refuses RUNNING/FINALIZED ones', async () => {
      const scheduled = await createMatch({ matchStatus: 'SCHEDULED', seriesStatus: 'SCHEDULED', cancellationReason: null, attempt: null });
      const response = await post(`/matches/${scheduled.matchId}/cancel`, { reason: 'map bug', publicReason: 'Match cancelled by organisers' });
      expect(response.statusCode).toBe(200);
      expect((await db.query<{ status: string }>('SELECT status FROM matches WHERE id = $1', [scheduled.matchId])).rows[0]!.status).toBe('CANCELLED');
      expect(await count("queue_overrides WHERE action = 'CANCEL'")).toBe(1);
      expect(await count("audit_events WHERE action = 'MATCH_CANCELLED'")).toBe(1);
      expect(await count('match_results')).toBe(0);
      for (const status of ['RUNNING', 'FINALIZED', 'CANCELLED']) {
        const f = await createMatch({ matchStatus: status, attempt: null });
        expect((await post(`/matches/${f.matchId}/cancel`, { reason: 'r', publicReason: 'p' })).statusCode, status).toBe(409);
      }
    });

    it('exposes overrides publicly without team or account data', async () => {
      const f = await createMatch();
      await post(`/matches/${f.matchId}/rerun`, rerunBody);
      const response = await app.inject({ method: 'GET', url: '/api/v1/public/queue-overrides' });
      expect(response.statusCode).toBe(200);
      const items = response.json().data.items as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(Object.keys(items[0]!).sort()).toEqual(['action', 'createdAt', 'id', 'matchOpaqueId', 'publicReason']);
      expect(items[0]).toMatchObject({ action: 'RERUN', publicReason: rerunBody.publicReason });
      const body = response.body;
      for (const secret of [f.matchId, f.teamA, f.teamB, adminId, 'SEED_SENTINEL']) expect(body).not.toContain(secret);
    });
  });

  describe('cases removed (P3-D27)', () => {
    it('has no cases tables, no queue_overrides.case_id, and the case routes are gone', async () => {
      const tables = await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('operations_cases', 'operations_case_events')",
      );
      expect(tables.rows).toEqual([]);
      const columns = await db.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'queue_overrides' AND column_name = 'case_id'",
      );
      expect(columns.rows).toEqual([]);
      const fn = await db.query("SELECT 1 FROM pg_proc WHERE proname = 'enforce_operations_case_transition'");
      expect(fn.rows).toEqual([]);
      const shared = await db.query("SELECT 1 FROM pg_proc WHERE proname = 'reject_append_only_mutation'");
      expect(shared.rows).toHaveLength(1);
      expect((await post('/cases', { reason: 'r', kind: 'ANOMALY', matchId: randomUUID(), evidence: { summary: 's' } })).statusCode).toBe(404);
      expect((await get('/cases')).statusCode).toBe(404);
      expect((await get('/cases/export')).statusCode).toBe(404);
    });

    it('rerun and cancel still write their queue override and audit row, and a rerun body with caseId is refused', async () => {
      const f = await createMatch();
      expect((await post(`/matches/${f.matchId}/rerun`, { ...rerunBody, caseId: randomUUID() })).statusCode).toBe(400);
      expect((await post(`/matches/${f.matchId}/rerun`, rerunBody)).statusCode).toBe(200);
      expect(await count("queue_overrides WHERE action = 'RERUN' AND match_id = $1", [f.matchId])).toBe(1);
      expect(await count("audit_events WHERE action = 'MATCH_RERUN'")).toBe(1);
      const g = await createMatch({ matchStatus: 'SCHEDULED', seriesStatus: 'SCHEDULED', cancellationReason: null, attempt: null });
      expect((await post(`/matches/${g.matchId}/cancel`, { reason: 'r', publicReason: 'p' })).statusCode).toBe(200);
      expect(await count("queue_overrides WHERE action = 'CANCEL' AND match_id = $1", [g.matchId])).toBe(1);
      expect(await count("audit_events WHERE action = 'MATCH_CANCELLED'")).toBe(1);
    });

    it('keeps legacy CASE_* audit rows readable and immutable', async () => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, details) VALUES ($1,$2,'CASE_OPENED','CASE',$3,'legacy',$4::jsonb)",
        [id, adminId, randomUUID(), JSON.stringify({ before: {}, after: { status: 'OPEN' } })],
      );
      const items = (await get('/audit?action=CASE_OPENED')).json().data.items as { id: string; action: string; targetType: string; reason: string; details: unknown }[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id, action: 'CASE_OPENED', targetType: 'CASE', reason: 'legacy', details: { before: {}, after: { status: 'OPEN' } } });
      await expect(db.query("UPDATE audit_events SET reason = 'tampered' WHERE id = $1", [id])).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM audit_events WHERE id = $1', [id])).rejects.toThrow(/append-only/);
    });

    it('re-running the migrations is a no-op', async () => {
      await runMigrations(db);
      const tables = await db.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'operations_cases'");
      expect(tables.rows).toEqual([]);
    });
  });

  describe('audit read and exports', () => {
    it('filters and paginates the audit log', async () => {
      const f = await createMatch();
      await post(`/matches/${f.matchId}/rerun`, rerunBody);
      await post(`/submissions/${f.subA}/revoke`, { reason: 'r' });
      // The admin login in beforeEach also writes an AUTH_LOGIN row by the same actor.
      const all = (await get('/audit')).json();
      expect(all.pagination.totalItems).toBe(3);
      expect((all.data.items as { action: string }[]).map(({ action }) => action).sort()).toEqual(['AUTH_LOGIN', 'MATCH_RERUN', 'SUBMISSION_REVOKED']);
      const byAction = (await get('/audit?action=MATCH_RERUN')).json().data.items;
      expect(byAction).toHaveLength(1);
      expect(byAction[0]).toMatchObject({ action: 'MATCH_RERUN', targetType: 'MATCH', targetId: f.matchId, actorAccountId: adminId });
      expect((await get(`/audit?targetType=SUBMISSION&targetId=${f.subA}`)).json().data.items).toHaveLength(1);
      const byActor = (await get(`/audit?actorAccountId=${adminId}&pageSize=1&page=2`)).json();
      expect(byActor.pagination.totalItems).toBe(3);
      expect(byActor.data.items).toHaveLength(1);
      expect((await get('/audit?from=2999-01-01T00:00:00Z')).json().data.items).toHaveLength(0);
      expect((await get('/audit?pageSize=500')).statusCode).toBe(400);
    });

    it('exports audit NDJSON without seeds, credentials, stderr or object keys', async () => {
      const f = await createMatch();
      // Hostile rows written straight to the append-only tables, as a buggy writer would.
      await db.query(
        "INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, details) VALUES ($1,$2,'LEGACY_ACTION','MATCH',$3,'legacy',$4::jsonb)",
        [randomUUID(), adminId, f.matchId, JSON.stringify({ seed: 'SEED_SENTINEL', password: 'PASSWORD_SENTINEL', nested: { stderr: 'STDERR_SENTINEL', objectKey: 'OBJECT_KEY_SENTINEL', keep: 'visible' } })],
      );
      for (const path of ['/audit/export']) {
        const response = await get(path);
        expect(response.statusCode, path).toBe(200);
        expect(response.headers['content-type']).toContain('application/x-ndjson');
        for (const sentinel of ['SEED_SENTINEL', 'PASSWORD_SENTINEL', 'STDERR_SENTINEL', 'OBJECT_KEY_SENTINEL', 'SCHEDULE_SEED_SENTINEL']) {
          expect(response.body, `${path} ${sentinel}`).not.toContain(sentinel);
        }
        const lines = response.body.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(lines.length).toBeGreaterThan(0);
      }
      expect((await get('/audit/export')).body).toContain('visible');
    });
  });

  describe('round results hash', () => {
    async function ratedRound() {
      const f = await createMatch({ matchStatus: 'FINALIZED', seriesStatus: 'FINALIZED', cancellationReason: null, result: true, ledger: true, attempt: { status: 'SUCCEEDED', reason: null } });
      const qualificationRoundId = randomUUID();
      await db.query(
        "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status, schedule_round_id) VALUES ($1,'QUALIFICATION',1,'RATED',$2)",
        [qualificationRoundId, f.roundId],
      );
      return { ...f, qualificationRoundId };
    }

    it('stores a stable SHA-256 at publish, returns it from the admin API and refuses a second publish', async () => {
      const r = await ratedRound();
      const expected = await computeRoundResultsHash(db, r.roundId);
      const response = await app.inject({ method: 'POST', url: `/api/v1/admin/rounds/${r.qualificationRoundId}/publish`, headers: { cookie: adminCookie }, payload: { reason: 'results verified' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.resultsHash).toBe(expected);
      const stored = await db.query<{ results_hash: string }>('SELECT results_hash FROM qualification_rounds WHERE id = $1', [r.qualificationRoundId]);
      expect(stored.rows[0]!.results_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.rows[0]!.results_hash).toBe(expected);
      const audit = await db.query<{ details: { resultsHash: string } }>("SELECT details FROM audit_events WHERE action = 'ROUND_PUBLISHED'");
      expect(audit.rows[0]!.details.resultsHash).toBe(expected);
      const read = await app.inject({ method: 'GET', url: `/api/v1/admin/rounds/${r.qualificationRoundId}`, headers: { cookie: adminCookie } });
      expect(read.json().data.resultsHash).toBe(expected);

      const again = await app.inject({ method: 'POST', url: `/api/v1/admin/rounds/${r.qualificationRoundId}/publish`, headers: { cookie: adminCookie }, payload: { reason: 'again' } });
      expect(again.statusCode).toBe(200);
      expect(again.json().data.replayed).toBe(true);
      expect((await db.query<{ results_hash: string }>('SELECT results_hash FROM qualification_rounds WHERE id = $1', [r.qualificationRoundId])).rows[0]!.results_hash).toBe(expected);
      expect((await db.query("SELECT id FROM audit_events WHERE action = 'ROUND_PUBLISHED'")).rows).toHaveLength(1);
      await expect(db.query("UPDATE qualification_rounds SET results_hash = $2 WHERE id = $1", [r.qualificationRoundId, hex('f')])).rejects.toThrow(/immutable once set/);
      expect(await computeRoundResultsHash(db, r.roundId)).toBe(expected);
    });

    it('changes when the underlying result or ledger changes, and cannot be set before publish', async () => {
      const r = await ratedRound();
      const before = await computeRoundResultsHash(db, r.roundId);
      await db.query('ALTER TABLE rating_ledger DISABLE TRIGGER ALL');
      await db.query('UPDATE rating_ledger SET rating_after = 1011, delta = 11 WHERE series_id = $1', [r.seriesId]);
      await db.query('ALTER TABLE rating_ledger ENABLE TRIGGER ALL');
      expect(await computeRoundResultsHash(db, r.roundId)).not.toBe(before);
      await expect(db.query('UPDATE qualification_rounds SET results_hash = $2 WHERE id = $1', [r.qualificationRoundId, hex('e')])).rejects.toThrow(/only at publish/);
    });
  });
});
