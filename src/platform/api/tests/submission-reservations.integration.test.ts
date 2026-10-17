import { createHash, randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { createClient, type RedisClientType } from 'redis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAuthApp,
  createDatabase,
  createPasswordHasher,
  createS3Storage,
  runMigrations,
  type Database,
} from '../src/index.ts';

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
  return { bytes: fileBytes, sha256: sha(fileBytes) };
};

const enabled =
  process.env.DATABASE_URL &&
  process.env.REDIS_URL &&
  process.env.S3_ENDPOINT &&
  process.env.S3_BUCKET &&
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY
    ? describe
    : describe.skip;

enabled('P3-D03 Submission reservations & upload throttling integration', () => {
  let db: Database;
  let redis: RedisClientType;
  let s3: S3Client;
  let app: ReturnType<typeof createAuthApp>;
  let currentTime: Date;
  let roundId: string;
  let ruleSetId: string;
  let adminId: string;

  const tOpens = new Date('2026-10-15T00:00:00.000Z');
  const tDeadline = new Date('2026-10-15T12:00:00.000Z');
  const tGrace = new Date('2026-10-16T00:00:00.000Z');

  beforeAll(async () => {
    db = createDatabase({ connectionString: process.env.DATABASE_URL! });
    redis = createClient({ url: process.env.REDIS_URL! });
    await redis.connect();
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runMigrations(db);
    s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT!,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    });
  });

  beforeEach(async () => {
    await redis.flushDb();
    await db.query(
      'TRUNCATE audit_events, sessions, accounts, teams, submissions, submission_reservations, qualification_rounds, round_rule_sets CASCADE'
    );
    currentTime = new Date('2026-10-15T06:00:00.000Z'); // before deadline

    adminId = randomUUID();
    await db.query(
      "INSERT INTO accounts(id,username,password_hash,role) VALUES($1,$2,$3,'BTC_ADMIN')",
      [adminId, 'admin', await createPasswordHasher({ memoryCost: 4096, timeCost: 1 }).hash('adminpass')]
    );

    ruleSetId = randomUUID();
    roundId = randomUUID();
    const rules = {
      schemaVersion: 'ott.round-rules.v1',
      engineVersion: '1.0.0',
      mapSet: [{ mapId: 'map-1', checksum: 'abcdef' }],
      maxTurns: 100,
      faultPolicyVersion: '1.0.0',
      timeControl: { startupMs: 1000, totalBotBudgetMs: 10000, matchWallClockMs: 60000, perTurn: { mode: 'FIXED', fixedMs: 100 } },
      resources: { memoryMiB: 512, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 256, unpackedMiB: 512, maxLayers: 10 },
      schedule: {
        submissionOpensAt: tOpens.toISOString(),
        submissionDeadlineAt: tDeadline.toISOString(),
        graceEndsAt: tGrace.toISOString(),
        runStartsAt: '2026-10-16T06:00:00.000Z',
        runMaxHours: 24,
        appealEndsAt: '2026-10-17T06:00:00.000Z',
      },
      testRun: { quotaPerTeamPerDay: 5, opponents: ['BTC_REFERENCE'] },
    };

    await db.query(
      'INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [ruleSetId, 'QUALIFICATION', 1, JSON.stringify(rules), 'a'.repeat(64), adminId, 'initial']
    );

    await db.query(
      "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status, rule_set_id) VALUES ($1,$2,$3,'SUBMISSION_OPEN',$4)",
      [roundId, 'QUALIFICATION', 1, ruleSetId]
    );

    app = createAuthApp({
      database: db,
      redis,
      passwordHasher: createPasswordHasher({ memoryCost: 4096, timeCost: 1 }),
      secureCookies: false,
      storage: createS3Storage({ client: s3, bucket: process.env.S3_BUCKET! }),
      now: () => currentTime,
    });
    await app.ready();
  });

  afterAll(async () => {
    await redis?.quit();
    await db?.close();
    s3?.destroy();
  });

  async function createTeamUser(name: string, username: string, pass: string) {
    const teamId = randomUUID();
    const accountId = randomUUID();
    await db.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [teamId, name]);
    await db.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4)",
      [accountId, username, await createPasswordHasher({ memoryCost: 4096, timeCost: 1 }).hash(pass), teamId]
    );

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: pass },
    });
    const setCookie = loginRes.headers['set-cookie'];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? '';
    return { teamId, accountId, cookie };
  }

  it('reservation lifecycle: create -> idempotent re-reserve -> triggers enforce immutability', async () => {
    const team = await createTeamUser('Team Alpha', 'alpha', 'pass');
    const { sha256: hashA } = makeArchive('alpha-v1');
    const { sha256: hashB } = makeArchive('alpha-v2');

    // 1. Create reservation for hash A -> 201
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/submission-reservations',
      headers: { cookie: team.cookie },
      payload: { archiveSha256: hashA },
    });
    expect(res1.statusCode).toBe(201);
    const data1 = res1.json().data;
    expect(data1.archiveSha256).toBe(hashA);
    expect(data1.roundId).toBe(roundId);
    expect(data1.status).toBe('RESERVED');

    // 2. Idempotent re-reserve for same hash A -> 200, identical ID and reservedAt
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/submission-reservations',
      headers: { cookie: team.cookie },
      payload: { archiveSha256: hashA },
    });
    expect(res2.statusCode).toBe(200);
    const data2 = res2.json().data;
    expect(data2.id).toBe(data1.id);
    expect(data2.reservedAt).toBe(data1.reservedAt);

    // Advance clock so reservation B is strictly newer than reservation A
    currentTime = new Date(currentTime.getTime() + 1000);

    // 3. Different hash B creates a second reservation -> 201
    const res3 = await app.inject({
      method: 'POST',
      url: '/api/v1/submission-reservations',
      headers: { cookie: team.cookie },
      payload: { archiveSha256: hashB },
    });
    expect(res3.statusCode).toBe(201);
    expect(res3.json().data.id).not.toBe(data1.id);

    // 4. GET /current returns the latest reservation (hash B)
    const currentRes = await app.inject({
      method: 'GET',
      url: '/api/v1/submission-reservations/current',
      headers: { cookie: team.cookie },
    });
    expect(currentRes.statusCode).toBe(200);
    expect(currentRes.json().data.id).toBe(res3.json().data.id);

    // 5. Database immutability triggers on submission_reservations:
    // Immutability of archive_sha256
    await expect(
      db.query('UPDATE submission_reservations SET archive_sha256 = $1 WHERE id = $2', [
        `sha256:${'9'.repeat(64)}`,
        data1.id,
      ])
    ).rejects.toThrow();

    // Immutability of team_id
    await expect(
      db.query('UPDATE submission_reservations SET team_id = $1 WHERE id = $2', [randomUUID(), data1.id])
    ).rejects.toThrow();

    // Immutability of qualification_round_id
    await expect(
      db.query('UPDATE submission_reservations SET qualification_round_id = $1 WHERE id = $2', [
        randomUUID(),
        data1.id,
      ])
    ).rejects.toThrow();

    // Immutability of reserved_at
    await expect(
      db.query("UPDATE submission_reservations SET reserved_at = now() - interval '1 hour' WHERE id = $1", [data1.id])
    ).rejects.toThrow();

    // Reject DELETE
    await expect(db.query('DELETE FROM submission_reservations WHERE id = $1', [data1.id])).rejects.toThrow();
  });

  it('GET /current tiebreaks identical reserved_at deterministically using seq DESC', async () => {
    const team = await createTeamUser('Tiebreak Team', 'tiebreak_team', 'pass');
    const { sha256: hashA } = makeArchive('tiebreak-bot-a');
    const { sha256: hashB } = makeArchive('tiebreak-bot-b');

    // Keep currentTime identical for both reservations
    const fixedTime = new Date('2026-10-15T08:00:00.000Z');
    currentTime = fixedTime;

    // Direct SQL insert to ensure B has a strictly smaller UUID than A:
    // idA is lexicographically maximum, idB is lexicographically minimum.
    // Under ORDER BY reserved_at DESC, seq DESC -> idB (later insert, higher seq) must win.
    // If mutated to ORDER BY reserved_at DESC, id DESC -> idA would incorrectly win (100% deterministic).
    const idA = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const idB = '00000000-0000-4000-8000-000000000000';

    // Insert A first: gets lower seq
    await db.query(
      `INSERT INTO submission_reservations (
         id, team_id, qualification_round_id, archive_sha256, reserved_at, grace_ends_at, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'RESERVED')`,
      [idA, team.teamId, roundId, hashA, fixedTime, tGrace]
    );

    // Insert B second: gets higher seq
    await db.query(
      `INSERT INTO submission_reservations (
         id, team_id, qualification_round_id, archive_sha256, reserved_at, grace_ends_at, status
       ) VALUES ($1, $2, $3, $4, $5, $6, 'RESERVED')`,
      [idB, team.teamId, roundId, hashB, fixedTime, tGrace]
    );

    // 1. GET /current must return B (higher seq, despite smaller UUID)
    const currentRes1 = await app.inject({
      method: 'GET',
      url: '/api/v1/submission-reservations/current',
      headers: { cookie: team.cookie },
    });
    expect(currentRes1.statusCode).toBe(200);
    expect(currentRes1.json().data.id).toBe(idB);
    expect(currentRes1.json().data.archiveSha256).toBe(hashB);

    // 2. Re-reserve A at the same frozen clock (idempotent 200, row unchanged)
    const reReserveA = await app.inject({
      method: 'POST',
      url: '/api/v1/submission-reservations',
      headers: { cookie: team.cookie },
      payload: { archiveSha256: hashA },
    });
    expect(reReserveA.statusCode).toBe(200);
    expect(reReserveA.json().data.id).toBe(idA);

    // 3. GET /current STILL returns B because re-reserving A does not bump its seq
    const currentRes2 = await app.inject({
      method: 'GET',
      url: '/api/v1/submission-reservations/current',
      headers: { cookie: team.cookie },
    });
    expect(currentRes2.statusCode).toBe(200);
    expect(currentRes2.json().data.id).toBe(idB);
    expect(currentRes2.json().data.archiveSha256).toBe(hashB);
  });

  it('grace window upload with reservation, retry idempotency, and boundary rejections', async () => {
    const team = await createTeamUser('Team Beta', 'beta', 'pass');
    const { bytes: botA, sha256: hashA } = makeArchive('beta-bot-a');
    const { bytes: botB, sha256: hashB } = makeArchive('beta-bot-b');

    // Reserve before deadline
    const reserveRes = await app.inject({
      method: 'POST',
      url: '/api/v1/submission-reservations',
      headers: { cookie: team.cookie },
      payload: { archiveSha256: hashA },
    });
    expect(reserveRes.statusCode).toBe(201);
    const reservationId = reserveRes.json().data.id;

    // Advance clock into grace window (deadline < currentTime <= grace)
    currentTime = new Date('2026-10-15T15:00:00.000Z');

    // Attempt upload without reservation during grace -> 403 RESERVATION_REQUIRED
    const noResUpload = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { cookie: team.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(botA),
    });
    expect(noResUpload.statusCode).toBe(403);
    expect(noResUpload.json().error.code).toBe('RESERVATION_REQUIRED');

    // Attempt upload with wrong-hash (botB uploaded against reservation for hashA) -> 409 RESERVATION_HASH_MISMATCH
    const wrongHashUpload = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: {
        cookie: team.cookie,
        'content-type': 'application/octet-stream',
        'x-reservation-id': reservationId,
      },
      payload: Buffer.from(botB),
    });
    expect(wrongHashUpload.statusCode).toBe(409);
    expect(wrongHashUpload.json().error.code).toBe('RESERVATION_HASH_MISMATCH');

    // Assert no submissions row was inserted
    const countCheck = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    expect(Number(countCheck.rows[0]?.count)).toBe(0);

    // Upload with matching reservation -> 201 PREFLIGHT and reservation completed
    const matchingUpload = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: {
        cookie: team.cookie,
        'content-type': 'application/octet-stream',
        'x-reservation-id': reservationId,
      },
      payload: Buffer.from(botA),
    });
    expect(matchingUpload.statusCode).toBe(201);
    const submissionId = matchingUpload.json().data.id;
    expect(matchingUpload.json().data.status).toBe('PREFLIGHT');

    // Reservation row in DB must be COMPLETED with submission_id
    const dbRes = await db.query<{ status: string; submission_id: string }>(
      'SELECT status, submission_id FROM submission_reservations WHERE id = $1',
      [reservationId]
    );
    expect(dbRes.rows[0]?.status).toBe('COMPLETED');
    expect(dbRes.rows[0]?.submission_id).toBe(submissionId);

    // Retrying upload with same file and completed reservation -> 200, idempotent, exact same submissionId
    const retryUpload = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: {
        cookie: team.cookie,
        'content-type': 'application/octet-stream',
        'x-reservation-id': reservationId,
      },
      payload: Buffer.from(botA),
    });
    expect(retryUpload.statusCode).toBe(200);
    expect(retryUpload.json().data.id).toBe(submissionId);

    // Submissions table still has exactly 1 row
    const countCheck2 = await db.query('SELECT COUNT(*)::int AS count FROM submissions');
    expect(Number(countCheck2.rows[0]?.count)).toBe(1);

    // Attempting reservation after deadline -> 403 SUBMISSION_DEADLINE_PASSED
    const lateReserve = await app.inject({
      method: 'POST',
      url: '/api/v1/submission-reservations',
      headers: { cookie: team.cookie },
      payload: { archiveSha256: hashB },
    });
    expect(lateReserve.statusCode).toBe(403);
    expect(lateReserve.json().error.code).toBe('SUBMISSION_DEADLINE_PASSED');

    // Advance clock past grace window
    currentTime = new Date('2026-10-16T01:00:00.000Z'); // past graceEndsAt

    // Upload after grace window even with reservation -> 403 SUBMISSION_CLOSED
    const afterGraceUpload = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: {
        cookie: team.cookie,
        'content-type': 'application/octet-stream',
        'x-reservation-id': reservationId,
      },
      payload: Buffer.from(botA),
    });
    expect(afterGraceUpload.statusCode).toBe(403);
    expect(afterGraceUpload.json().error.code).toBe('SUBMISSION_CLOSED');
  });

  it('preflight position ordering and preflightQueueLength shrink when submission leaves PREFLIGHT', async () => {
    const team1 = await createTeamUser('Team P1', 'p1', 'pass');
    const team2 = await createTeamUser('Team P2', 'p2', 'pass');
    const team3 = await createTeamUser('Team P3', 'p3', 'pass');

    const bot1 = makeArchive('p1');
    const bot2 = makeArchive('p2');
    const bot3 = makeArchive('p3');

    // Upload in order: team1 -> team2 -> team3
    currentTime = new Date('2026-10-15T01:00:00.000Z');
    const up1 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { cookie: team1.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(bot1.bytes),
    });
    expect(up1.statusCode).toBe(201);
    const sub1Id = up1.json().data.id;

    currentTime = new Date('2026-10-15T02:00:00.000Z');
    const up2 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { cookie: team2.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(bot2.bytes),
    });
    expect(up2.statusCode).toBe(201);

    currentTime = new Date('2026-10-15T03:00:00.000Z');
    const up3 = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { cookie: team3.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(bot3.bytes),
    });
    expect(up3.statusCode).toBe(201);

    // Team 1 queries: position 1 / 3
    const list1 = await app.inject({ method: 'GET', url: '/api/v1/submissions', headers: { cookie: team1.cookie } });
    expect(list1.json().preflightQueueLength).toBe(3);
    expect(list1.json().data[0].preflightPosition).toBe(1);

    // Team 2 queries: position 2 / 3
    const list2 = await app.inject({ method: 'GET', url: '/api/v1/submissions', headers: { cookie: team2.cookie } });
    expect(list2.json().preflightQueueLength).toBe(3);
    expect(list2.json().data[0].preflightPosition).toBe(2);

    // Team 3 queries: position 3 / 3
    const list3 = await app.inject({ method: 'GET', url: '/api/v1/submissions', headers: { cookie: team3.cookie } });
    expect(list3.json().preflightQueueLength).toBe(3);
    expect(list3.json().data[0].preflightPosition).toBe(3);

    // Move team 1's submission from PREFLIGHT to ACTIVE
    await db.query("UPDATE submissions SET status = 'ACTIVE' WHERE id = $1", [sub1Id]);

    // Now Team 2 queries: position is now 1 / 2!
    const list2After = await app.inject({ method: 'GET', url: '/api/v1/submissions', headers: { cookie: team2.cookie } });
    expect(list2After.json().preflightQueueLength).toBe(2);
    expect(list2After.json().data[0].preflightPosition).toBe(1);

    // Team 1 queries: preflightPosition is now null (ACTIVE status)
    const list1After = await app.inject({ method: 'GET', url: '/api/v1/submissions', headers: { cookie: team1.cookie } });
    expect(list1After.json().data[0].status).toBe('ACTIVE');
    expect(list1After.json().data[0].preflightPosition).toBeNull();
  });

  it(
    'AC-15 burst: 50 teams reserve concurrently, 50 uploads with throttling and backpressure',
    async () => {
      // Provision 50 teams
      const teams: { teamId: string; cookie: string; archive: { bytes: Uint8Array; sha256: string } }[] = [];
      for (let i = 0; i < 50; i++) {
        const t = await createTeamUser(`Burst Team ${i}`, `burst_team_${i}`, 'password123');
        teams.push({ ...t, archive: makeArchive(`burst-team-${i}`) });
      }

      // Step 1: All 50 teams reserve concurrently before deadline
      currentTime = new Date('2026-10-15T11:50:00.000Z'); // 10 min before deadline
      const reservations = await Promise.all(
        teams.map(async (t) => {
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/submission-reservations',
            headers: { cookie: t.cookie },
            payload: { archiveSha256: t.archive.sha256 },
          });
          expect(res.statusCode).toBe(201);
          return { team: t, reservationId: res.json().data.id };
        })
      );
      expect(reservations.length).toBe(50);

      // Configure a separate app with limiter: maxConcurrent 8, perTeam 1
      const burstApp = createAuthApp({
        database: db,
        redis,
        passwordHasher: createPasswordHasher({ memoryCost: 4096, timeCost: 1 }),
        secureCookies: false,
        storage: createS3Storage({ client: s3, bucket: process.env.S3_BUCKET! }),
        uploadLimiter: { maxConcurrent: 8, maxConcurrentPerTeam: 1, retryAfterBaseSeconds: 1 },
        now: () => currentTime,
      });
      await burstApp.ready();

      let retryCount = 0;
      const uploadTeam = async (
        t: (typeof teams)[0],
        reservationId: string | undefined,
        archiveBytes: Uint8Array
      ) => {
        let attempts = 0;
        while (attempts < 200) {
          attempts++;
          const headers: Record<string, string> = {
            cookie: t.cookie,
            'content-type': 'application/octet-stream',
          };
          if (reservationId) {
            headers['x-reservation-id'] = reservationId;
          }

          const res = await burstApp.inject({
            method: 'POST',
            url: '/api/v1/submissions',
            headers,
            payload: Buffer.from(archiveBytes),
          });

          if (res.statusCode === 201 || res.statusCode === 200) {
            return { teamId: t.teamId, statusCode: res.statusCode, body: res.json() };
          }

          if (res.statusCode === 429) {
            retryCount++;
            expect(res.headers['retry-after']).toBeDefined();
            const retryAfter = Number(res.headers['retry-after']);
            expect(retryAfter).toBeGreaterThanOrEqual(1);
            // Wait scaled down ~50-100 ms as recommended by reviewer
            const waitMs = Math.min(Math.max(50, retryAfter * 50), 100);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            continue;
          }

          if (res.statusCode === 409 || res.statusCode === 403) {
            return { teamId: t.teamId, statusCode: res.statusCode, body: res.json() };
          }

          throw new Error(`Unexpected status code: ${res.statusCode} ${res.body}`);
        }
        throw new Error(`Team ${t.teamId} exceeded retry limit`);
      };

      // Step 2: Upload burst phase 1 - 10 teams upload BEFORE deadline WITHOUT reservation
      currentTime = new Date('2026-10-15T11:55:00.000Z'); // 5 min before deadline
      const beforeDeadlineResults = await Promise.all(
        teams.slice(0, 10).map((t) => uploadTeam(t, undefined, t.archive.bytes))
      );
      for (const res of beforeDeadlineResults) {
        expect(res.statusCode).toBe(201);
      }

      // Step 3: Clock straddles deadline into grace period
      currentTime = new Date('2026-10-15T12:05:00.000Z'); // 5 min after deadline (grace period)

      // 40 teams upload concurrently in grace period:
      // - 35 teams with matching reservation
      // - 4 teams with wrong-hash archive (reserved hash != uploaded file hash)
      // - 1 team with NO reservation after deadline
      const validGracePromises = reservations.slice(10, 45).map((r) =>
        uploadTeam(r.team, r.reservationId, r.team.archive.bytes)
      );
      const wrongHashGracePromises = reservations.slice(45, 49).map((r) => {
        const wrongArchive = makeArchive(`mismatched-content-${r.team.teamId}`);
        return uploadTeam(r.team, r.reservationId, wrongArchive.bytes);
      });
      const noReservationGracePromises = [
        uploadTeam(teams[49]!, undefined, teams[49]!.archive.bytes),
      ];

      const graceResults = await Promise.all([
        ...validGracePromises,
        ...wrongHashGracePromises,
        ...noReservationGracePromises,
      ]);

      const validGraceResults = graceResults.slice(0, 35);
      const wrongHashResults = graceResults.slice(35, 39);
      const noResResults = graceResults.slice(39);

      // Verify valid grace-period uploads succeeded
      for (const res of validGraceResults) {
        expect(res.statusCode).toBe(201);
      }

      // Verify wrong-hash uploads in grace period were rejected (409 RESERVATION_HASH_MISMATCH)
      for (const res of wrongHashResults) {
        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('RESERVATION_HASH_MISMATCH');
      }

      // Verify unreserved upload after deadline was rejected (403 RESERVATION_REQUIRED)
      expect(noResResults[0]?.statusCode).toBe(403);
      expect(noResResults[0]?.body.error.code).toBe('RESERVATION_REQUIRED');

      // Confirm limiter throttled requests and returned 429 with Retry-After during the burst
      expect(retryCount).toBeGreaterThan(0);

      // Verify DB state: exactly 45 submissions rows (10 before deadline + 35 in grace)
      const finalSubs = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM submissions');
      expect(Number(finalSubs.rows[0]?.count)).toBe(45);

      const distinctTeams = await db.query<{ count: string }>(
        'SELECT COUNT(DISTINCT team_id)::text AS count FROM submissions'
      );
      expect(Number(distinctTeams.rows[0]?.count)).toBe(45);

      // Exactly 35 reservations completed (the ones used during grace period)
      const completedReservations = await db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM submission_reservations WHERE status = 'COMPLETED'"
      );
      expect(Number(completedReservations.rows[0]?.count)).toBe(35);

      await burstApp.close();
    },
    120_000
  );
});
