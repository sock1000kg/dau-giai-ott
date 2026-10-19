import { createHash, randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import { CoreGameAdapter, FakeClock, ScriptedBot, runMatch, serializeEventLog } from '@ott/match-runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAuthApp } from '../src/app.ts';
import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { stageReplayPublication, publishReplayPublication, getPublicReplay, getPrivateReplay } from '../src/modules/replays/service.ts';
import { type ObjectStorage } from '../src/storage/s3.ts';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const integration = databaseUrl && redisUrl ? describe : describe.skip;

function memoryStorage(): ObjectStorage {
  const objects = new Map<string, Uint8Array>();
  return {
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

function sessionCookie(value: unknown): string {
  const cookie = Array.isArray(value) ? value[0] : typeof value === 'string' ? value : undefined;
  if (cookie === undefined) throw new Error('Expected set-cookie header');
  return cookie.split(';', 1)[0]!;
}

integration('P3-D05 Replay authorization integration test', () => {
  let database: Database;
  let adminDatabase: Database;
  let redis: RedisClientType;
  let storage: ObjectStorage;
  let app: ReturnType<typeof createAuthApp>;

  const suffix = randomUUID();
  const schemaName = `replay_auth_${suffix.replaceAll('-', '')}`;

  const teamXId = randomUUID();
  const teamOId = randomUUID();
  const thirdTeamId = randomUUID();

  const btcAccountId = randomUUID();
  const teamXAccountId = randomUUID();
  const teamOAccountId = randomUUID();
  const thirdTeamAccountId = randomUUID();

  let btcCookie: string;
  let teamXCookie: string;
  let teamOCookie: string;
  let thirdTeamCookie: string;

  const qualSeriesId = randomUUID();
  const finalsSeriesId = randomUUID();

  const qualMatchId = randomUUID();
  const qualV2MatchId = randomUUID();
  const finalsPrivateMatchId = randomUUID();
  const finalsStagedMatchId = randomUUID();
  const finalsPublishedMatchId = randomUUID();

  let qualEventLogKey: string;
  let qualOriginalBytes: Buffer;
  let qualV2EventLogKey: string;
  let qualV2OriginalBytes: Buffer;
  let finalsPubOriginalBytes: Buffer;
  let setupMatch: (matchId: string, seriesId: string, pubState: 'PRIVATE' | 'STAGED' | 'PUBLISHED') => Promise<{ eventLogKey: string; rawBytes: Buffer }>;
  let setupMatchV2: (matchId: string, seriesId: string, pubState: 'PRIVATE' | 'STAGED' | 'PUBLISHED') => Promise<{ eventLogKey: string; rawBytes: Buffer }>;

  beforeAll(async () => {
    adminDatabase = createDatabase({ connectionString: databaseUrl! });
    await adminDatabase.query(`CREATE SCHEMA "${schemaName}"`);
    const isolatedUrl = new URL(databaseUrl!);
    isolatedUrl.searchParams.set('options', `-c search_path=${schemaName}`);
    database = createDatabase({ connectionString: isolatedUrl.toString() });
    redis = createClient({ url: redisUrl! });
    await redis.connect();
    storage = memoryStorage();
    await runMigrations(database);

    // Seed teams
    await database.query(
      'INSERT INTO teams (id, name) VALUES ($1, $2), ($3, $4), ($5, $6)',
      [teamXId, `Team-X-${suffix}`, teamOId, `Team-O-${suffix}`, thirdTeamId, `Third-${suffix}`],
    );

    // Seed accounts
    await database.query(
      `INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES
       ($1, $2, 'test-hash', 'BTC_ADMIN', NULL),
       ($3, $4, 'test-hash', 'TEAM_ACCOUNT', $5),
       ($6, $7, 'test-hash', 'TEAM_ACCOUNT', $8),
       ($9, $10, 'test-hash', 'TEAM_ACCOUNT', $11)`,
      [
        btcAccountId, `btc-${suffix}`,
        teamXAccountId, `team-x-${suffix}`, teamXId,
        teamOAccountId, `team-o-${suffix}`, teamOId,
        thirdTeamAccountId, `third-${suffix}`, thirdTeamId,
      ],
    );

    // Create series: one QUALIFICATION, one FINALS
    await database.query(
      "INSERT INTO series (id, tournament_stage, status, team_a_id, team_b_id) VALUES ($1, 'QUALIFICATION', 'FINALIZED', $2, $3)",
      [qualSeriesId, teamXId, teamOId],
    );
    await database.query(
      "INSERT INTO series (id, tournament_stage, status, team_a_id, team_b_id) VALUES ($1, 'FINALS', 'FINALIZED', $2, $3)",
      [finalsSeriesId, teamXId, teamOId],
    );

    // Seed submissions
    const subIds = [randomUUID(), randomUUID()];
    await database.query(
      `INSERT INTO submissions (id, team_id, tournament_stage, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, status)
       VALUES ($1, $2, 'QUALIFICATION', $3, $4, $5, $6, 'VALID'),
              ($7, $8, 'QUALIFICATION', $3, $4, $5, $9, 'VALID')`,
      [
        subIds[0], teamXId, `sha256:${'1'.repeat(64)}`, `sha256:${'2'.repeat(64)}`, `sha256:${'3'.repeat(64)}`, `priv/${subIds[0]}`,
        subIds[1], teamOId, `priv/${subIds[1]}`,
      ],
    );

    // Helper to generate terminal match + event log
    const game = new CoreGameAdapter();
    setupMatch = async (matchId: string, seriesId: string, pubState: 'PRIVATE' | 'STAGED' | 'PUBLISHED') => {
      const gameConfig = { gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 };
      const firstState = game.create(gameConfig);
      const firstAction = game.listLegalActions(firstState, 'X')[0]!;
      const report = await runMatch(
        { matchId, seed: `SEED-${matchId}`, game: gameConfig, limits: { ...DEFAULT_LIMITS, maxTurns: 1 } },
        { game, bots: { X: new ScriptedBot({ replies: [{ kind: 'action', action: firstAction }] }), O: new ScriptedBot({ replies: [] }) } },
      );
      const rawBytes = Buffer.from(serializeEventLog(report.log), 'utf8');
      const checksum = `sha256:${createHash('sha256').update(rawBytes).digest('hex')}`;
      const eventLogKey = `match-results/${matchId}/event-log/${checksum}.json`;
      await storage.put(eventLogKey, rawBytes);

      const ownSeriesId = randomUUID();
      await database.query(
        'INSERT INTO series (id, tournament_stage, status, team_a_id, team_b_id) SELECT $1, tournament_stage, status, team_a_id, team_b_id FROM series WHERE id = $2',
        [ownSeriesId, seriesId],
      );
      await database.query(
        "INSERT INTO matches (id, series_id, x_submission_id, o_submission_id, status, game_number, seed) VALUES ($1, $2, $3, $4, 'FINALIZED', 1, $5)",
        [matchId, ownSeriesId, subIds[0], subIds[1], `SEED-${matchId}`],
      );
      await database.query(
        "INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash, event_log_key, event_log_sha256) VALUES ($1, 'X', 'TURN_LIMIT', 1, $2, $3, $4)",
        [matchId, report.log.footer.result.finalStateHash, eventLogKey, checksum],
      );
      // Assert 0006 trigger finalized_result_replay_publication auto-created the row in PRIVATE state
      const autoPub = await database.query<{ state: string }>(
        'SELECT state FROM replay_publications WHERE match_id = $1',
        [matchId],
      );
      expect(autoPub.rows[0]?.state).toBe('PRIVATE');

      if (pubState === 'STAGED' || pubState === 'PUBLISHED') {
        await database.query("UPDATE replay_publications SET state = 'STAGED' WHERE match_id = $1", [matchId]);
      }
      if (pubState === 'PUBLISHED') {
        await database.query("UPDATE replay_publications SET state = 'PUBLISHED' WHERE match_id = $1", [matchId]);
      }
      return { eventLogKey, rawBytes };
    };

    setupMatchV2 = async (matchId: string, seriesId: string, pubState: 'PRIVATE' | 'STAGED' | 'PUBLISHED') => {
      const gameConfig = { gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 };
      const firstState = game.create(gameConfig);
      const firstAction = game.listLegalActions(firstState, 'X')[0]!;
      const report = await runMatch(
        {
          matchId,
          seed: `SEED-${matchId}`,
          game: gameConfig,
          limits: { ...DEFAULT_LIMITS, maxTurns: 1 },
          protocolV2: {
            timeControl: {
              startupMs: 5000,
              totalBotBudgetMs: 60000,
              matchWallClockMs: 120000,
              perTurn: { mode: 'FIXED', fixedMs: 3000 },
            },
            botSeeds: { X: 'BOT-X', O: 'BOT-O' },
          },
        },
        { game, bots: { X: new ScriptedBot({ replies: [{ kind: 'action', action: firstAction }] }), O: new ScriptedBot({ replies: [] }) }, clock: new FakeClock() },
      );
      const rawBytes = Buffer.from(serializeEventLog(report.log), 'utf8');
      const checksum = `sha256:${createHash('sha256').update(rawBytes).digest('hex')}`;
      const eventLogKey = `match-results/${matchId}/event-log/${checksum}.json`;
      await storage.put(eventLogKey, rawBytes);

      const ownSeriesId = randomUUID();
      await database.query(
        'INSERT INTO series (id, tournament_stage, status, team_a_id, team_b_id) SELECT $1, tournament_stage, status, team_a_id, team_b_id FROM series WHERE id = $2',
        [ownSeriesId, seriesId],
      );
      await database.query(
        "INSERT INTO matches (id, series_id, x_submission_id, o_submission_id, status, game_number, seed) VALUES ($1, $2, $3, $4, 'FINALIZED', 1, $5)",
        [matchId, ownSeriesId, subIds[0], subIds[1], `SEED-${matchId}`],
      );
      await database.query(
        "INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash, event_log_key, event_log_sha256) VALUES ($1, 'X', 'TURN_LIMIT', 1, $2, $3, $4)",
        [matchId, report.log.footer.result.finalStateHash, eventLogKey, checksum],
      );
      if (pubState === 'STAGED' || pubState === 'PUBLISHED') {
        await database.query("UPDATE replay_publications SET state = 'STAGED' WHERE match_id = $1", [matchId]);
      }
      if (pubState === 'PUBLISHED') {
        await database.query("UPDATE replay_publications SET state = 'PUBLISHED' WHERE match_id = $1", [matchId]);
      }
      return { eventLogKey, rawBytes };
    };

    const qSetup = await setupMatch(qualMatchId, qualSeriesId, 'PRIVATE');
    qualEventLogKey = qSetup.eventLogKey;
    qualOriginalBytes = qSetup.rawBytes;

    const qV2Setup = await setupMatchV2(qualV2MatchId, qualSeriesId, 'PRIVATE');
    qualV2EventLogKey = qV2Setup.eventLogKey;
    qualV2OriginalBytes = qV2Setup.rawBytes;

    await setupMatch(finalsPrivateMatchId, finalsSeriesId, 'PRIVATE');
    await setupMatch(finalsStagedMatchId, finalsSeriesId, 'STAGED');
    const fpSetup = await setupMatch(finalsPublishedMatchId, finalsSeriesId, 'PUBLISHED');
    finalsPubOriginalBytes = fpSetup.rawBytes;

    app = createAuthApp({
      database,
      redis,
      passwordHasher: {
        async hash() { return 'test-hash'; },
        async verify() { return true; },
      },
      secureCookies: false,
      storage,
    });
    await app.ready();

    // Log in all actors to get cookies
    const btcLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: `btc-${suffix}`, password: 'any' } });
    btcCookie = sessionCookie(btcLogin.headers['set-cookie']);

    const xLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: `team-x-${suffix}`, password: 'any' } });
    teamXCookie = sessionCookie(xLogin.headers['set-cookie']);

    const oLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: `team-o-${suffix}`, password: 'any' } });
    teamOCookie = sessionCookie(oLogin.headers['set-cookie']);

    const thirdLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: `third-${suffix}`, password: 'any' } });
    thirdTeamCookie = sessionCookie(thirdLogin.headers['set-cookie']);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (database) await database.close();
    if (redis) await redis.quit();
    if (adminDatabase) {
      await adminDatabase.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await adminDatabase.close();
    }
  });

  it('rejects direct SQL update to STAGED or PUBLISHED for non-FINALS matches via 0011 trigger', async () => {
    // 1. Updating PRIVATE -> STAGED on a QUALIFICATION match is rejected by 0011 trigger
    await expect(
      database.query("UPDATE replay_publications SET state = 'STAGED' WHERE match_id = $1", [qualMatchId]),
    ).rejects.toThrow('replay publication requires FINALS stage');

    // 2. Updating STAGED -> PUBLISHED on a QUALIFICATION match is also rejected by 0011 trigger
    const isolatedQualMatchId = randomUUID();
    await setupMatch(isolatedQualMatchId, qualSeriesId, 'PRIVATE');
    await database.query('ALTER TABLE replay_publications DISABLE TRIGGER replay_publications_stage_guard');
    try {
      await database.query("UPDATE replay_publications SET state = 'STAGED' WHERE match_id = $1", [isolatedQualMatchId]);
    } finally {
      await database.query('ALTER TABLE replay_publications ENABLE TRIGGER replay_publications_stage_guard');
    }

    await expect(
      database.query("UPDATE replay_publications SET state = 'PUBLISHED' WHERE match_id = $1", [isolatedQualMatchId]),
    ).rejects.toThrow('replay publication requires FINALS stage');
  });

  it('rejects service stage and publish calls for QUALIFICATION matches with 409 REPLAY_NOT_PUBLIC_STAGE', async () => {
    await expect(
      stageReplayPublication(database, storage, {
        matchId: qualMatchId,
        actorAccountId: btcAccountId,
        idempotencyKey: randomUUID(),
        reason: 'Attempt stage qual',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'REPLAY_NOT_PUBLIC_STAGE' });

    await expect(
      publishReplayPublication(database, storage, {
        matchId: qualMatchId,
        actorAccountId: btcAccountId,
        idempotencyKey: randomUUID(),
        reason: 'Attempt publish qual',
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'REPLAY_NOT_PUBLIC_STAGE' });

    // Assert publication events remained 0 and state is still PRIVATE
    const events = await database.query('SELECT count(*)::text AS c FROM replay_publication_events WHERE match_id = $1', [qualMatchId]);
    expect(events.rows[0]?.c).toBe('0');
    const state = await database.query<{ state: string }>('SELECT state FROM replay_publications WHERE match_id = $1', [qualMatchId]);
    expect(state.rows[0]?.state).toBe('PRIVATE');
  });

  it('verifies the full actor × match × endpoint authorization matrix', async () => {
    const testCases = [
      { matchId: qualMatchId, stage: 'QUALIFICATION', state: 'PRIVATE', version: 1 },
      { matchId: qualV2MatchId, stage: 'QUALIFICATION', state: 'PRIVATE', version: 2 },
      { matchId: finalsPrivateMatchId, stage: 'FINALS', state: 'PRIVATE', version: 1 },
      { matchId: finalsStagedMatchId, stage: 'FINALS', state: 'STAGED', version: 1 },
      { matchId: finalsPublishedMatchId, stage: 'FINALS', state: 'PUBLISHED', version: 1 },
    ];

    for (const tc of testCases) {
      // 1. Anonymous
      const anonPriv = await app.inject({ method: 'GET', url: `/api/v1/replays/${tc.matchId}` });
      expect(anonPriv.statusCode).toBe(401);
      const anonPub = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${tc.matchId}` });
      if (tc.stage === 'FINALS' && tc.state === 'PUBLISHED') {
        expect(anonPub.statusCode).toBe(200);
        expect(anonPub.headers['content-type']).toMatch(new RegExp(`version="?${tc.version}"?`));
      } else {
        expect(anonPub.statusCode).toBe(404);
      }

      // 2. Team X
      const xPriv = await app.inject({ method: 'GET', url: `/api/v1/replays/${tc.matchId}`, headers: { cookie: teamXCookie } });
      expect(xPriv.statusCode).toBe(200);
      expect(xPriv.headers['cache-control']).toBe('private, no-store');
      expect(xPriv.headers['content-type']).toMatch(new RegExp(`version="?${tc.version}"?`));
      const xBody = xPriv.json();
      expect(xBody.schemaVersion).toBe(tc.version);
      expect(xBody.header.formatVersion).toBe(tc.version);
      if (tc.version === 2) {
        expect(Array.isArray(xBody.timing)).toBe(true);
        expect(xBody.timing.length).toBeGreaterThan(0);
        // Secret/seed leak check for v2 (Item 4)
        expect(xPriv.body).not.toContain(`SEED-${tc.matchId}`);
        expect(xPriv.body).not.toContain('BOT-X');
        expect(xPriv.body).not.toContain('BOT-O');
        expect(xPriv.body).not.toContain(qualV2EventLogKey);
        expect(xBody.header.seed).toBeUndefined();
        expect(xPriv.body).not.toMatch(/"seed"\s*:/);
      }

      // 3. Team O
      const oPriv = await app.inject({ method: 'GET', url: `/api/v1/replays/${tc.matchId}`, headers: { cookie: teamOCookie } });
      expect(oPriv.statusCode).toBe(200);
      expect(oPriv.headers['cache-control']).toBe('private, no-store');
      expect(oPriv.headers['content-type']).toMatch(new RegExp(`version="?${tc.version}"?`));
      const oBody = oPriv.json();
      expect(oBody.schemaVersion).toBe(tc.version);

      // 4. Third team (404, existence not leaked)
      const thirdPriv = await app.inject({ method: 'GET', url: `/api/v1/replays/${tc.matchId}`, headers: { cookie: thirdTeamCookie } });
      expect(thirdPriv.statusCode).toBe(404);
      expect(thirdPriv.json()).toEqual({ error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' } });

      // 5. BTC Admin
      const btcPriv = await app.inject({ method: 'GET', url: `/api/v1/replays/${tc.matchId}`, headers: { cookie: btcCookie } });
      expect(btcPriv.statusCode).toBe(200);
      expect(btcPriv.headers['content-type']).toMatch(new RegExp(`version="?${tc.version}"?`));
      const btcBody = btcPriv.json();
      expect(btcBody.schemaVersion).toBe(tc.version);
    }
  });

  it('fails with 409 REPLAY_INTEGRITY_FAILED on tampered storage artifact during private read', async () => {
    const tampered = Buffer.from(qualOriginalBytes);
    tampered[0] = tampered[0]! ^ 1;
    await storage.put(qualEventLogKey, tampered);

    const res = await app.inject({ method: 'GET', url: `/api/v1/replays/${qualMatchId}`, headers: { cookie: teamXCookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'REPLAY_INTEGRITY_FAILED', message: 'Replay integrity verification failed' } });

    // Restore
    await storage.put(qualEventLogKey, qualOriginalBytes);
    const restored = await app.inject({ method: 'GET', url: `/api/v1/replays/${qualMatchId}`, headers: { cookie: teamXCookie } });
    expect(restored.statusCode).toBe(200);
  });

  it('fails with 409 REPLAY_INTEGRITY_FAILED on tampered v2 storage artifact during private read', async () => {
    const tampered = Buffer.from(qualV2OriginalBytes);
    tampered[0] = tampered[0]! ^ 1;
    await storage.put(qualV2EventLogKey, tampered);

    const res = await app.inject({ method: 'GET', url: `/api/v1/replays/${qualV2MatchId}`, headers: { cookie: teamXCookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'REPLAY_INTEGRITY_FAILED', message: 'Replay integrity verification failed' } });

    // Restore
    await storage.put(qualV2EventLogKey, qualV2OriginalBytes);
    const restored = await app.inject({ method: 'GET', url: `/api/v1/replays/${qualV2MatchId}`, headers: { cookie: teamXCookie } });
    expect(restored.statusCode).toBe(200);
  });

  it('proves defense in depth: legacy PUBLISHED non-FINALS row is blocked by getPublicReplay read guard', async () => {
    const legacyMatchId = randomUUID();
    await setupMatch(legacyMatchId, qualSeriesId, 'PRIVATE');

    // Temporarily disable trigger to simulate legacy/corrupted PUBLISHED non-finals row
    await database.query('ALTER TABLE replay_publications DISABLE TRIGGER replay_publications_stage_guard');
    try {
      await database.query("UPDATE replay_publications SET state = 'STAGED' WHERE match_id = $1", [legacyMatchId]);
      await database.query("UPDATE replay_publications SET state = 'PUBLISHED' WHERE match_id = $1", [legacyMatchId]);
    } finally {
      await database.query('ALTER TABLE replay_publications ENABLE TRIGGER replay_publications_stage_guard');
    }

    // getPublicReplay service must still return 404
    await expect(getPublicReplay(database, storage, legacyMatchId)).rejects.toMatchObject({
      statusCode: 404,
      code: 'REPLAY_NOT_FOUND',
    });

    const pubRes = await app.inject({ method: 'GET', url: `/api/v1/public/replays/${legacyMatchId}` });
    expect(pubRes.statusCode).toBe(404);
  });
});
