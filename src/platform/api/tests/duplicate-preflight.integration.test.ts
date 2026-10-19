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
import { checkDuplicateSubmission } from '../src/modules/submissions/layers.ts';
import { preflightSubmission } from '../../worker/src/preflight-submission.ts';

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
    new Uint8Array(1024),
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
    }),
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
        }),
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

enabled('AC-22: OCI Duplicate Check Wiring & Admin Flagged Visibility Integration', () => {
  let db: Database;
  let redis: RedisClientType;
  let s3: S3Client;
  let app: ReturnType<typeof createAuthApp>;
  let s3Storage: ReturnType<typeof createS3Storage>;

  let adminCookie: string;
  let team1Cookie: string;
  let team2Cookie: string;
  let team3Cookie: string;

  const team1Id = randomUUID();
  const team2Id = randomUUID();
  const team3Id = randomUUID();

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

    s3Storage = createS3Storage({ client: s3, bucket: process.env.S3_BUCKET! });
    const hasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });
    const passHash = await hasher.hash('password123');

    // Create BTC_ADMIN account
    const adminId = randomUUID();
    await db.query("INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, 'admin', $2, 'BTC_ADMIN')", [
      adminId,
      passHash,
    ]);

    // Create teams and accounts
    await db.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [team1Id, 'Team One']);
    await db.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, 'team1', $2, 'TEAM_ACCOUNT', $3)",
      [randomUUID(), passHash, team1Id],
    );

    await db.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [team2Id, 'Team Two']);
    await db.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, 'team2', $2, 'TEAM_ACCOUNT', $3)",
      [randomUUID(), passHash, team2Id],
    );

    await db.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [team3Id, 'Team Three']);
    await db.query(
      "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, 'team3', $2, 'TEAM_ACCOUNT', $3)",
      [randomUUID(), passHash, team3Id],
    );

    // Create round and rule set
    const ruleSetId = randomUUID();
    const roundId = randomUUID();
    const rules = {
      schemaVersion: 'ott.round-rules.v1',
      engineVersion: '1.0.0',
      mapSet: [{ mapId: 'map-1', checksum: 'abcdef' }],
      maxTurns: 100,
      faultPolicyVersion: '1.0.0',
      timeControl: { startupMs: 1000, totalBotBudgetMs: 10000, matchWallClockMs: 60000, perTurn: { mode: 'FIXED', fixedMs: 100 } },
      resources: { memoryMiB: 512, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 256, unpackedMiB: 512, maxLayers: 10 },
      schedule: {
        submissionOpensAt: new Date(Date.now() - 3600000).toISOString(),
        submissionDeadlineAt: new Date(Date.now() + 86400000).toISOString(),
        graceEndsAt: new Date(Date.now() + 172800000).toISOString(),
        runStartsAt: new Date(Date.now() + 259200000).toISOString(),
        runMaxHours: 24,
        appealEndsAt: new Date(Date.now() + 345600000).toISOString(),
      },
      testRun: { quotaPerTeamPerDay: 5, opponents: ['BTC_REFERENCE'] },
    };
    await db.query(
      'INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [ruleSetId, 'QUALIFICATION', 1, JSON.stringify(rules), 'a'.repeat(64), adminId, 'initial'],
    );
    await db.query(
      "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status, rule_set_id) VALUES ($1,$2,$3,'SUBMISSION_OPEN',$4)",
      [roundId, 'QUALIFICATION', 1, ruleSetId],
    );

    app = createAuthApp({
      database: db,
      redis,
      passwordHasher: hasher,
      secureCookies: false,
      storage: s3Storage,
    });
    await app.ready();

    // Login each actor to obtain session cookies
    const adminLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'password123' } });
    adminCookie = String(adminLogin.headers['set-cookie']).split(';')[0]!;

    const t1Login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'team1', password: 'password123' } });
    team1Cookie = String(t1Login.headers['set-cookie']).split(';')[0]!;

    const t2Login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'team2', password: 'password123' } });
    team2Cookie = String(t2Login.headers['set-cookie']).split(';')[0]!;

    const t3Login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'team3', password: 'password123' } });
    team3Cookie = String(t3Login.headers['set-cookie']).split(';')[0]!;
  });

  afterAll(async () => {
    await redis?.quit();
    await db?.close();
    s3?.destroy();
  });

  async function uploadSubmission(cookie: string, archiveData: { bytes: Uint8Array; sha256: string }): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(archiveData.bytes),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // Verify team upload response does NOT expose duplicate review flags
    expect(body.data.duplicateReviewFlag).toBeUndefined();
    expect(body.data.duplicate_review_flag).toBeUndefined();
    return body.data.id;
  }

  async function runPreflight(submissionId: string) {
    return preflightSubmission({
      submissionId,
      database: db,
      storage: s3Storage,
      dockerReachable: async () => true,
      createBotPort: () => ({
        start: async () => ({ ok: true }),
        requestAction: async () => ({ ok: true }),
        stop: async () => {},
      }),
    });
  }

  it('two teams with identical archives: second is ACTIVE and flagged MANIFEST with duplicate_of_submission_id, and duplicate check is idempotent on direct recall and replay', async () => {
    const archiveA = makeArchive('shared-logic-v1');

    // Team 1 uploads Archive A
    const sub1Id = await uploadSubmission(team1Cookie, archiveA);
    const preflight1 = await runPreflight(sub1Id);
    expect(preflight1.status).toBe('ACTIVE');

    const sub1Row = (await db.query<{ status: string; duplicate_review_flag: boolean }>(
      'SELECT status, duplicate_review_flag FROM submissions WHERE id = $1',
      [sub1Id],
    )).rows[0]!;
    expect(sub1Row.status).toBe('ACTIVE');
    expect(sub1Row.duplicate_review_flag).toBe(false);

    // Team 2 uploads identical Archive A
    const sub2Id = await uploadSubmission(team2Cookie, archiveA);
    const preflight2 = await runPreflight(sub2Id);
    expect(preflight2.status).toBe('ACTIVE');

    const sub2Row = (await db.query<{
      status: string;
      duplicate_review_flag: boolean;
      duplicate_of_submission_id: string;
      duplicate_review_reason: string;
    }>(
      'SELECT status, duplicate_review_flag, duplicate_of_submission_id, duplicate_review_reason FROM submissions WHERE id = $1',
      [sub2Id],
    )).rows[0]!;
    expect(sub2Row.status).toBe('ACTIVE');
    expect(sub2Row.duplicate_review_flag).toBe(true);
    expect(sub2Row.duplicate_of_submission_id).toBe(sub1Id);
    expect(sub2Row.duplicate_review_reason).toContain('Identical OCI manifest digest matches submission');

    // Audit event check
    const auditRes = await db.query<{ count: string; details: any }>(
      "SELECT COUNT(*)::text AS count, details FROM audit_events WHERE target_id = $1 AND action = 'DUPLICATE_SUBMISSION_FLAGGED' GROUP BY details",
      [sub2Id],
    );
    expect(Number(auditRes.rows[0]?.count ?? 0)).toBe(1);
    expect(auditRes.rows[0]?.details.matchType).toBe('MANIFEST');
    expect(auditRes.rows[0]?.details.duplicateOfSubmissionId).toBe(sub1Id);

    // Option A: Directly call checkDuplicateSubmission a second time with MANIFEST match inputs
    const sub2DigestRow = (await db.query<{ oci_manifest_digest: string }>(
      'SELECT oci_manifest_digest FROM submissions WHERE id = $1',
      [sub2Id],
    )).rows[0]!;
    const layerRows = (await db.query<{ layer_digest: string }>(
      'SELECT sl.layer_digest FROM submission_layers sl JOIN oci_layers ol ON ol.digest = sl.layer_digest WHERE sl.submission_id = $1 AND ol.is_base_layer = FALSE',
      [sub2Id],
    )).rows.map((r) => r.layer_digest);

    const dupResult2 = await checkDuplicateSubmission(db, {
      submissionId: sub2Id,
      teamId: team2Id,
      manifestDigest: sub2DigestRow.oci_manifest_digest,
      nonBaseLayerDigests: layerRows,
    });
    expect(dupResult2.isDuplicate).toBe(true);
    expect(dupResult2.duplicateOfSubmissionId).toBe(sub1Id);
    expect(dupResult2.matchType).toBe('MANIFEST');

    // Call a third time with layer-path inputs (different manifest digest so manifest match fails, non-base layers match)
    const dupResult3 = await checkDuplicateSubmission(db, {
      submissionId: sub2Id,
      teamId: team2Id,
      manifestDigest: 'sha256:differentmanifestforexercisinglayerpath1234567890abcdef',
      nonBaseLayerDigests: layerRows,
    });
    expect(dupResult3.isDuplicate).toBe(true);
    expect(dupResult3.duplicateOfSubmissionId).toBe(sub1Id);
    expect(dupResult3.matchType).toBe('NON_BASE_LAYERS');

    // Option B: Reset sub2 to PREFLIGHT to simulate a retry after an activate failure, and re-run preflight
    await db.query("UPDATE submissions SET status = 'PREFLIGHT' WHERE id = $1", [sub2Id]);
    const retryPreflight = await runPreflight(sub2Id);
    expect(retryPreflight.status).toBe('ACTIVE');

    // Verify still exactly one audit row and duplicate fields unchanged
    const auditAfterDupChecks = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit_events WHERE target_id = $1 AND action = 'DUPLICATE_SUBMISSION_FLAGGED'",
      [sub2Id],
    );
    expect(Number(auditAfterDupChecks.rows[0]?.count ?? 0)).toBe(1);

    const sub2RowAfter = (await db.query<{
      status: string;
      duplicate_review_flag: boolean;
      duplicate_of_submission_id: string;
    }>(
      'SELECT status, duplicate_review_flag, duplicate_of_submission_id FROM submissions WHERE id = $1',
      [sub2Id],
    )).rows[0]!;
    expect(sub2RowAfter.status).toBe('ACTIVE');
    expect(sub2RowAfter.duplicate_review_flag).toBe(true);
    expect(sub2RowAfter.duplicate_of_submission_id).toBe(sub1Id);

    // Replay preflight on sub2Id: replay of an ACTIVE submission is a no-op (preflight short-circuits before duplicate check)
    const replayResult = await runPreflight(sub2Id);
    expect(replayResult.status).toBe('ACTIVE');
    expect(replayResult.replayed).toBe(true);

    // Verify still exactly one audit row after no-op replay
    const auditAfterReplay = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM audit_events WHERE target_id = $1 AND action = 'DUPLICATE_SUBMISSION_FLAGGED'",
      [sub2Id],
    );
    expect(Number(auditAfterReplay.rows[0]?.count ?? 0)).toBe(1);
  });

  it('two different corpus fixtures produce no duplicate flag', async () => {
    const archiveB = makeArchive('unique-corpus-team3');
    const sub3Id = await uploadSubmission(team3Cookie, archiveB);
    const preflight3 = await runPreflight(sub3Id);
    expect(preflight3.status).toBe('ACTIVE');

    const sub3Row = (await db.query<{ status: string; duplicate_review_flag: boolean }>(
      'SELECT status, duplicate_review_flag FROM submissions WHERE id = $1',
      [sub3Id],
    )).rows[0]!;
    expect(sub3Row.status).toBe('ACTIVE');
    expect(sub3Row.duplicate_review_flag).toBe(false);

    const auditRes = await db.query(
      "SELECT * FROM audit_events WHERE target_id = $1 AND action = 'DUPLICATE_SUBMISSION_FLAGGED'",
      [sub3Id],
    );
    expect(auditRes.rows.length).toBe(0);
  });

  it('same team resubmitting identical archive produces no duplicate flag', async () => {
    const archiveA = makeArchive('shared-logic-v1');
    const sub1AgainId = await uploadSubmission(team1Cookie, archiveA);
    const preflight1Again = await runPreflight(sub1AgainId);
    expect(preflight1Again.status).toBe('ACTIVE');

    const sub1AgainRow = (await db.query<{ status: string; duplicate_review_flag: boolean }>(
      'SELECT status, duplicate_review_flag FROM submissions WHERE id = $1',
      [sub1AgainId],
    )).rows[0]!;
    expect(sub1AgainRow.status).toBe('ACTIVE');
    expect(sub1AgainRow.duplicate_review_flag).toBe(false);
  });

  it('layers rows exist in submission_layers for every ACTIVE submission', async () => {
    const activeSubmissions = await db.query<{ id: string }>(
      "SELECT id FROM submissions WHERE status = 'ACTIVE'",
    );
    expect(activeSubmissions.rows.length).toBeGreaterThan(0);

    for (const sub of activeSubmissions.rows) {
      const layersCount = await db.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM submission_layers WHERE submission_id = $1',
        [sub.id],
      );
      expect(Number(layersCount.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    }
  });

  describe('BTC Visibility & Team Isolation API', () => {
    it('GET /api/v1/admin/submissions/flagged returns 200 with flagged row for BTC_ADMIN', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/submissions/flagged',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(20);
      expect(body.total).toBe(1);
      expect(body.data.length).toBe(1);

      const item = body.data[0];
      expect(item.teamId).toBe(team2Id);
      expect(item.teamName).toBe('Team Two');
      expect(item.status).toBe('ACTIVE');
      expect(item.duplicateOfTeamName).toBe('Team One');
      expect(item.matchType).toBe('MANIFEST');
      expect(item.reason).toContain('Identical OCI manifest digest matches submission');
    });

    it('GET /api/v1/admin/submissions/flagged returns 403 for TEAM_ACCOUNT and 401 for anonymous', async () => {
      const teamRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/submissions/flagged',
        headers: { cookie: team1Cookie },
      });
      expect(teamRes.statusCode).toBe(403);

      const anonRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/submissions/flagged',
      });
      expect(anonRes.statusCode).toBe(401);
    });

    it('GET /api/v1/admin/submissions/flagged rejects invalid pagination bounds with 400', async () => {
      const invalidBounds = ['?page=0', '?pageSize=0', '?pageSize=101', '?page=abc'];
      for (const query of invalidBounds) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/admin/submissions/flagged${query}`,
          headers: { cookie: adminCookie },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('INVALID_PAGINATION');
      }
    });

    it('team-facing GET /api/v1/submissions does not expose duplicate review flag fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/submissions',
        headers: { cookie: team2Cookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThan(0);
      for (const sub of body.data) {
        expect(sub.duplicateReviewFlag).toBeUndefined();
        expect(sub.duplicate_review_flag).toBeUndefined();
        expect(sub.duplicateOfSubmissionId).toBeUndefined();
        expect(sub.duplicate_of_submission_id).toBeUndefined();
        expect(sub.duplicateReviewReason).toBeUndefined();
        expect(sub.duplicate_review_reason).toBeUndefined();
      }
    });
  });
});
