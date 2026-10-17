import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';
import {
  UploadLimiter,
  createReservation,
  getCurrentReservation,
  resolveUpload,
  registerSubmissionRoutes,
  SubmissionReservationError,
} from '../src/index.ts';

const SHA = (char: string) => `sha256:${char.repeat(64)}`;

const defaultSchedule = {
  submissionOpensAt: '2026-10-10T10:00:00.000Z',
  submissionDeadlineAt: '2026-10-10T12:00:00.000Z',
  graceEndsAt: '2026-10-10T14:00:00.000Z',
};

function mockDbWithRound(schedule: typeof defaultSchedule | null = defaultSchedule) {
  const roundId = randomUUID();
  const ruleSetId = randomUUID();
  const query = vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
    if (sql.includes("status = 'SUBMISSION_OPEN'")) {
      if (!schedule) return { rows: [] };
      return {
        rows: [
          {
            id: roundId,
            tournament_stage: 'QUALIFICATION',
            round_number: 1,
            status: 'SUBMISSION_OPEN',
            rule_set_id: ruleSetId,
            rules: { schedule },
          },
        ],
      };
    }
    return { rows: [] };
  });

  const db: Database = {
    query,
    transaction: vi.fn(),
    close: vi.fn(),
  };

  return { db, query, roundId, ruleSetId };
}

describe('UploadLimiter (unit)', () => {
  it('enforces max concurrent uploads globally and per-team', () => {
    const limiter = new UploadLimiter({ maxConcurrent: 2, maxConcurrentPerTeam: 1, retryAfterBaseSeconds: 5 });

    // Team 1 acquires slot 1
    const res1 = limiter.tryAcquire('team-1');
    expect(res1.acquired).toBe(true);

    // Team 1 tries to acquire slot 2: blocked by per-team limit
    const res2 = limiter.tryAcquire('team-1');
    expect(res2.acquired).toBe(false);
    expect(res2.retryAfter).toBe(5);

    // Team 2 acquires slot 2
    const res3 = limiter.tryAcquire('team-2');
    expect(res3.acquired).toBe(true);

    // Team 3 tries to acquire slot 3: blocked by global limit (maxConcurrent = 2)
    const res4 = limiter.tryAcquire('team-3');
    expect(res4.acquired).toBe(false);
    // Position 1: base + position = 5 + 1 = 6
    expect(res4.retryAfter).toBe(6);

    // Release team 1
    limiter.release('team-1');
    expect(limiter.getStats().globalActive).toBe(1);

    // Now team 3 can acquire
    const res5 = limiter.tryAcquire('team-3');
    expect(res5.acquired).toBe(true);
  });

  it('guarantees Retry-After is an integer >= 1', () => {
    const limiter = new UploadLimiter({ maxConcurrent: 1, maxConcurrentPerTeam: 1, retryAfterBaseSeconds: 0 });
    limiter.tryAcquire('team-1');
    const blocked = limiter.tryAcquire('team-2');
    expect(blocked.acquired).toBe(false);
    expect(Number.isInteger(blocked.retryAfter)).toBe(true);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
  });
});

describe('resolveUpload decision matrix (unit)', () => {
  it('rejects upload when round is not open or before opens', async () => {
    const { db } = mockDbWithRound(null);
    await expect(resolveUpload(db, { teamId: 'team-1', now: new Date('2026-10-10T11:00:00.000Z') })).rejects.toMatchObject({
      status: 409,
      code: 'SUBMISSION_NOT_OPEN',
    });

    const { db: dbWithRound } = mockDbWithRound();
    // Before opens (09:00 < 10:00)
    await expect(resolveUpload(dbWithRound, { teamId: 'team-1', now: new Date('2026-10-10T09:00:00.000Z') })).rejects.toMatchObject({
      status: 409,
      code: 'SUBMISSION_NOT_OPEN',
    });
  });

  it('accepts upload before deadline with or without reservation', async () => {
    const { db } = mockDbWithRound();
    const now = new Date('2026-10-10T11:00:00.000Z');

    // Without reservation
    const decision1 = await resolveUpload(db, { teamId: 'team-1', now });
    expect(decision1.round).toBeDefined();
    expect(decision1.reservation).toBeNull();
  });

  it('validates reservation before deadline if provided', async () => {
    const { db, query, roundId } = mockDbWithRound();
    const reservationId = randomUUID();
    const now = new Date('2026-10-10T11:00:00.000Z');

    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'SUBMISSION_OPEN'")) {
        return { rows: [{ id: roundId, tournament_stage: 'QUALIFICATION', round_number: 1, status: 'SUBMISSION_OPEN', rules: { schedule: defaultSchedule } }] };
      }
      if (sql.includes('submission_reservations') && sql.includes('WHERE id = $1')) {
        return {
          rows: [
            {
              id: reservationId,
              team_id: 'team-1',
              qualification_round_id: roundId,
              archive_sha256: SHA('a'),
              reserved_at: new Date('2026-10-10T10:30:00.000Z'),
              grace_ends_at: new Date(defaultSchedule.graceEndsAt),
              status: 'RESERVED',
              submission_id: null,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const decision = await resolveUpload(db, { teamId: 'team-1', reservationId, now });
    expect(decision.reservation?.id).toBe(reservationId);

    // Foreign team reservation
    await expect(resolveUpload(db, { teamId: 'team-other', reservationId, now })).rejects.toMatchObject({
      status: 403,
      code: 'RESERVATION_INVALID',
    });

    // Malformed reservation UUID
    await expect(resolveUpload(db, { teamId: 'team-1', reservationId: 'not-a-uuid', now })).rejects.toMatchObject({
      status: 403,
      code: 'RESERVATION_INVALID',
    });
  });

  it('requires valid reservation during grace period (deadline < now <= grace)', async () => {
    const { db, query, roundId } = mockDbWithRound();
    const nowInGrace = new Date('2026-10-10T13:00:00.000Z'); // between 12:00 and 14:00

    // Without reservation -> 403 RESERVATION_REQUIRED
    await expect(resolveUpload(db, { teamId: 'team-1', now: nowInGrace })).rejects.toMatchObject({
      status: 403,
      code: 'RESERVATION_REQUIRED',
    });

    // With matching reservation -> accepted
    const reservationId = randomUUID();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'SUBMISSION_OPEN'")) {
        return { rows: [{ id: roundId, tournament_stage: 'QUALIFICATION', round_number: 1, status: 'SUBMISSION_OPEN', rules: { schedule: defaultSchedule } }] };
      }
      if (sql.includes('submission_reservations') && sql.includes('WHERE id = $1')) {
        return {
          rows: [
            {
              id: reservationId,
              team_id: 'team-1',
              qualification_round_id: roundId,
              archive_sha256: SHA('a'),
              reserved_at: new Date('2026-10-10T11:59:00.000Z'),
              grace_ends_at: new Date(defaultSchedule.graceEndsAt),
              status: 'RESERVED',
              submission_id: null,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const decision = await resolveUpload(db, { teamId: 'team-1', reservationId, now: nowInGrace });
    expect(decision.reservation?.id).toBe(reservationId);
  });

  it('rejects upload after graceEndsAt even with valid reservation', async () => {
    const { db, query, roundId } = mockDbWithRound();
    const reservationId = randomUUID();
    const afterGrace = new Date('2026-10-10T14:01:00.000Z'); // after 14:00

    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'SUBMISSION_OPEN'")) {
        return { rows: [{ id: roundId, tournament_stage: 'QUALIFICATION', round_number: 1, status: 'SUBMISSION_OPEN', rules: { schedule: defaultSchedule } }] };
      }
      return { rows: [] };
    });

    await expect(resolveUpload(db, { teamId: 'team-1', reservationId, now: afterGrace })).rejects.toMatchObject({
      status: 403,
      code: 'SUBMISSION_CLOSED',
    });
  });
});

describe('createReservation (unit)', () => {
  it('validates archiveSha256 format strictly', async () => {
    const { db } = mockDbWithRound();
    await expect(createReservation(db, { teamId: 'team-1', archiveSha256: 'invalid' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_ARCHIVE_SHA256',
    });
    await expect(createReservation(db, { teamId: 'team-1', archiveSha256: `sha256:${'A'.repeat(64)}` })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_ARCHIVE_SHA256',
    });
  });

  it('rejects reservation after deadline', async () => {
    const { db } = mockDbWithRound();
    const afterDeadline = new Date('2026-10-10T12:01:00.000Z');
    await expect(createReservation(db, { teamId: 'team-1', archiveSha256: SHA('a'), now: afterDeadline })).rejects.toMatchObject({
      status: 403,
      code: 'SUBMISSION_DEADLINE_PASSED',
    });
  });

  it('creates reservation with 201 on new hash and 200 on conflict (idempotent)', async () => {
    const { db, query, roundId } = mockDbWithRound();
    const now = new Date('2026-10-10T11:00:00.000Z');

    // First call: insert succeeds
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'SUBMISSION_OPEN'")) {
        return { rows: [{ id: roundId, tournament_stage: 'QUALIFICATION', round_number: 1, status: 'SUBMISSION_OPEN', rules: { schedule: defaultSchedule } }] };
      }
      if (sql.includes('INSERT INTO submission_reservations')) {
        return {
          rows: [
            {
              id: 'res-new',
              team_id: 'team-1',
              qualification_round_id: roundId,
              archive_sha256: SHA('a'),
              reserved_at: now,
              grace_ends_at: new Date(defaultSchedule.graceEndsAt),
              status: 'RESERVED',
              submission_id: null,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res1 = await createReservation(db, { teamId: 'team-1', archiveSha256: SHA('a'), now });
    expect(res1.statusCode).toBe(201);
    expect(res1.data.id).toBe('res-new');

    // Second call: insert conflicts (0 rows returned), selects existing
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'SUBMISSION_OPEN'")) {
        return { rows: [{ id: roundId, tournament_stage: 'QUALIFICATION', round_number: 1, status: 'SUBMISSION_OPEN', rules: { schedule: defaultSchedule } }] };
      }
      if (sql.includes('INSERT INTO submission_reservations')) {
        return { rows: [] }; // conflict
      }
      if (sql.includes('SELECT id, team_id, qualification_round_id, archive_sha256')) {
        return {
          rows: [
            {
              id: 'res-new',
              team_id: 'team-1',
              qualification_round_id: roundId,
              archive_sha256: SHA('a'),
              reserved_at: now,
              grace_ends_at: new Date(defaultSchedule.graceEndsAt),
              status: 'RESERVED',
              submission_id: null,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res2 = await createReservation(db, { teamId: 'team-1', archiveSha256: SHA('a'), now });
    expect(res2.statusCode).toBe(200);
    expect(res2.data.id).toBe('res-new');
  });
});

describe('routes and concurrency limiter integration (unit)', () => {
  function createTestApp(
    principal: SessionPrincipal | null,
    db: Database,
    limiterOptions?: { maxConcurrent?: number; maxConcurrentPerTeam?: number },
    now = () => new Date('2026-10-10T11:00:00.000Z')
  ) {
    const app = Fastify({ logger: false });
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async (request) => { request.principal = principal; });
    registerSubmissionRoutes(app, {
      database: db,
      storage: {} as ObjectStorage,
      uploadLimiter: limiterOptions,
      now,
    });
    return app;
  }

  it('POST /api/v1/submission-reservations validates body and creates reservation', async () => {
    const { db, query, roundId } = mockDbWithRound();
    const app = createTestApp({ accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, db);

    // Invalid body
    const badRes = await app.inject({
      method: 'POST',
      url: '/api/v1/submission-reservations',
      payload: { archiveSha256: 'bad' },
    });
    expect(badRes.statusCode).toBe(400);
    expect(badRes.json().error.code).toBe('INVALID_ARCHIVE_SHA256');

    // Valid reservation
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'SUBMISSION_OPEN'")) {
        return { rows: [{ id: roundId, tournament_stage: 'QUALIFICATION', round_number: 1, status: 'SUBMISSION_OPEN', rules: { schedule: defaultSchedule } }] };
      }
      if (sql.includes('INSERT INTO submission_reservations')) {
        return {
          rows: [
            {
              id: 'res-1',
              team_id: 'team-1',
              qualification_round_id: roundId,
              archive_sha256: SHA('a'),
              reserved_at: new Date('2026-10-10T11:00:00.000Z'),
              grace_ends_at: new Date(defaultSchedule.graceEndsAt),
              status: 'RESERVED',
              submission_id: null,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const goodRes = await app.inject({
      method: 'POST',
      url: '/api/v1/submission-reservations',
      payload: { archiveSha256: SHA('a') },
    });
    expect(goodRes.statusCode).toBe(201);
    expect(goodRes.json()).toEqual({
      data: {
        id: 'res-1',
        archiveSha256: SHA('a'),
        roundId,
        reservedAt: '2026-10-10T11:00:00.000Z',
        graceEndsAt: defaultSchedule.graceEndsAt,
        status: 'RESERVED',
      },
    });

    await app.close();
  });

  it('GET /api/v1/submission-reservations/current returns latest reservation or null', async () => {
    const { db, query, roundId } = mockDbWithRound();
    const app = createTestApp({ accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, db);

    // Has reservation
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'SUBMISSION_OPEN'")) {
        return { rows: [{ id: roundId, tournament_stage: 'QUALIFICATION', round_number: 1, status: 'SUBMISSION_OPEN', rules: { schedule: defaultSchedule } }] };
      }
      if (sql.includes('FROM submission_reservations')) {
        return {
          rows: [
            {
              id: 'res-current',
              team_id: 'team-1',
              qualification_round_id: roundId,
              archive_sha256: SHA('f'),
              reserved_at: new Date('2026-10-10T11:30:00.000Z'),
              grace_ends_at: new Date(defaultSchedule.graceEndsAt),
              status: 'RESERVED',
              submission_id: null,
              completed_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await app.inject({ method: 'GET', url: '/api/v1/submission-reservations/current' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe('res-current');

    await app.close();
  });

  it('throttles POST /api/v1/submissions with 429 and Retry-After header', async () => {
    const { db } = mockDbWithRound();
    // Limiter: max 1 upload per team
    const app = createTestApp({ accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' }, db, { maxConcurrent: 2, maxConcurrentPerTeam: 1 });

    // Manually occupy slot for team-1
    const limiter = (app as any)[Symbol.for('uploadLimiter')] ?? new UploadLimiter({ maxConcurrent: 2, maxConcurrentPerTeam: 1 });

    // Inject request with custom limiter where slot is occupied
    const app2 = Fastify({ logger: false });
    app2.decorateRequest('principal', null);
    app2.addHook('onRequest', async (request) => {
      request.principal = { accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
    });
    const occupiedLimiter = new UploadLimiter({ maxConcurrent: 2, maxConcurrentPerTeam: 1 });
    occupiedLimiter.tryAcquire('team-1'); // slot occupied!

    registerSubmissionRoutes(app2, {
      database: db,
      storage: {} as ObjectStorage,
      uploadLimiter: occupiedLimiter,
    });

    const response = await app2.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('bytes'),
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(Number(response.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(response.json()).toEqual({
      error: {
        code: 'UPLOAD_BUSY',
        message: expect.any(String),
      },
    });

    await app.close();
    await app2.close();
  });

  it('holds limiter slot until the handler responds (does not release early on body stream close)', async () => {
    const { db } = mockDbWithRound();
    const app = Fastify({ logger: false });
    app.decorateRequest('principal', null);
    app.addHook('onRequest', async (request) => {
      request.principal = { accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
    });

    let releaseStoragePut: () => void;
    const storagePutPromise = new Promise<void>((resolve) => {
      releaseStoragePut = resolve;
    });

    const mockStorage = {
      put: vi.fn().mockImplementation(async () => {
        await storagePutPromise;
      }),
      remove: vi.fn().mockResolvedValue(undefined),
    } as unknown as ObjectStorage;

    const limiter = new UploadLimiter({ maxConcurrent: 2, maxConcurrentPerTeam: 1, retryAfterBaseSeconds: 3 });

    registerSubmissionRoutes(app, {
      database: db,
      storage: mockStorage,
      uploadLimiter: limiter,
      now: () => new Date('2026-10-10T11:00:00.000Z'),
    });

    // Start request 1: payload is sent and consumed
    const req1Promise = app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('mock archive bytes'),
    });

    // Wait until storage.put is called (handler is in flight)
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(limiter.getStats().globalActive).toBe(1);
    expect(limiter.getStats().activeTeams).toBe(1);

    // Concurrently inject request 2 from team-1 while request 1 is still in flight
    const req2 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('mock archive bytes 2'),
    });

    // Request 2 must be blocked with 429
    expect(req2.statusCode).toBe(429);
    expect(req2.json().error.code).toBe('UPLOAD_BUSY');

    // Complete request 1
    releaseStoragePut!();
    const res1 = await req1Promise;
    expect(res1.statusCode).toBe(400); // Invalid OCI archive

    // Slot is cleanly released on response completion
    expect(limiter.getStats().globalActive).toBe(0);
    expect(limiter.getStats().activeTeams).toBe(0);

    await app.close();
  });

  it('releases limiter slot when client aborts/destroys socket mid-upload', async () => {
    const { db } = mockDbWithRound();
    const app = Fastify({ logger: false });
    app.decorateRequest('principal', null);

    app.addHook('onRequest', async (request) => {
      request.principal = { accountId: 'acc-1', role: 'TEAM_ACCOUNT', teamId: 'team-1' };
    });

    const mockStorage = {
      put: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    } as unknown as ObjectStorage;

    const limiter = new UploadLimiter({ maxConcurrent: 2, maxConcurrentPerTeam: 1, retryAfterBaseSeconds: 3 });

    registerSubmissionRoutes(app, {
      database: db,
      storage: mockStorage,
      uploadLimiter: limiter,
      now: () => new Date('2026-10-10T11:00:00.000Z'),
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const { request: httpRequest } = await import('node:http');
    // Send content-length: 1000 (larger than written content 100 bytes)
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/v1/submissions',
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': '1000',
      },
    });
    // Suppress expected client ECONNRESET / socket hang up when calling req.destroy()
    req.on('error', () => {});

    req.write(Buffer.alloc(100));

    // Bounded poll (20 x 25 ms) for limiter slot acquisition
    for (let i = 0; i < 20; i++) {
      if (limiter.getStats().globalActive === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(limiter.getStats().globalActive).toBe(1);
    expect(limiter.getStats().activeTeams).toBe(1);

    // Client aborts mid-upload by destroying socket before full content-length is written
    req.destroy();

    // Bounded poll (20 x 25 ms) for slot release upon abort
    for (let i = 0; i < 20; i++) {
      if (limiter.getStats().globalActive === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    // Proving slot is released on abort!
    expect(limiter.getStats().globalActive).toBe(0);
    expect(limiter.getStats().activeTeams).toBe(0);

    // Second upload from the same team now succeeds in acquiring slot (not blocked with 429)
    const secondReq = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('archive bytes'),
    });
    // Request was not blocked by limiter (did not return 429 UPLOAD_BUSY)
    expect(secondReq.statusCode).not.toBe(429);
    expect(secondReq.statusCode).toBe(400); // reached handler, failed OCI validation
    expect(secondReq.json().error.code).toBe('ARCHIVE_TAR_INVALID');

    await app.close();
  });
});
