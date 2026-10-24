import { generateKeyPairSync, createHash } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db/client.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';
import {
  buildSyntheticDemoBundle,
  DEMO_KEY_ID,
} from '../src/modules/result-bundles/demo-bundle.ts';
import { buildSignedResultBundle, type BuildResultBundleInput } from '../src/modules/result-bundles/exporter.ts';
import { computeKeyFingerprint } from '../src/modules/result-bundles/keys.ts';
import { registerResultBundleRoutes } from '../src/modules/result-bundles/routes.ts';
import { registerReplayRoutes } from '../src/modules/replays/routes.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';
import { parseSpectatorReplay } from '../../web/src/features/spectator/replay-schema.ts';

const btcAdmin: SessionPrincipal = {
  accountId: '00000000-0000-0000-0000-000000000001',
  role: 'BTC_ADMIN',
  teamId: undefined,
};

const teamPrincipal: SessionPrincipal = {
  accountId: '00000000-0000-0000-0000-000000000002',
  role: 'TEAM_ACCOUNT',
  teamId: 'team-01',
};

type DbHandler = (text: string, values?: readonly unknown[]) => { rows: unknown[]; rowCount?: number } | undefined;

function createApp(principal: SessionPrincipal | null, handler: DbHandler = () => undefined) {
  const calls: { text: string; values: readonly unknown[] | undefined }[] = [];
  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    calls.push({ text, values });
    return handler(text, values) ?? { rows: [], rowCount: 0 };
  });

  const txQuery = vi.fn(async (text: string, values?: readonly unknown[]) => {
    calls.push({ text, values });
    return handler(text, values) ?? { rows: [], rowCount: 0 };
  });

  const database = {
    query,
    transaction: vi.fn(async (work: (tx: Database) => Promise<unknown>) =>
      work({ query: txQuery, transaction: vi.fn(), close: vi.fn() } as unknown as Database),
    ),
    close: vi.fn(),
  } as unknown as Database;

  const storage: ObjectStorage = {
    get: vi.fn(async () => { throw new Error('Not in storage'); }),
    put: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };

  const app = Fastify({ logger: false });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => {
    request.principal = principal;
  });
  registerResultBundleRoutes(app, { database });
  registerReplayRoutes(app, { database, storage });
  return { app, query, txQuery, calls, database };
}

describe('ResultBundle API routes', () => {
  const keyPair = generateKeyPairSync('ed25519');
  const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const fingerprint = computeKeyFingerprint(publicKeyPem);

  const KEY_ID = 'demo-finals-key';

  async function createValidSignedBundle() {
    return buildSyntheticDemoBundle(privateKeyPem);
  }

  function createSchemaInvalidSignedBundle() {
    const input: BuildResultBundleInput = {
      bundleId: 'bundle-invalid-schema-01',
      bundleVersion: 1,
      tournamentId: 'TOURNAMENT_2026',
      finalsRuleSetId: 'finals-rules-1',
      keyId: KEY_ID,
      createdAt: '2026-10-24T00:00:00Z',
      artifacts: [
        {
          path: 'bracket.json',
          mediaType: 'application/json',
          payload: Buffer.from('{"invalid":"no_schema_here"}'),
        },
      ],
    };
    const signed = buildSignedResultBundle(input, privateKeyPem);
    return {
      manifest: signed.manifest,
      signature: signed.signature,
      artifacts: signed.artifacts.map((a) => ({
        path: a.path,
        payloadBase64: Buffer.from(a.payload).toString('base64'),
      })),
    };
  }

  describe('RBAC guards', () => {
    it('rejects unauthenticated requests to admin endpoints with 401', async () => {
      const { app } = createApp(null);
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/result-bundles/keys' });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('rejects team accounts from admin endpoints with 403', async () => {
      const { app } = createApp(teamPrincipal);
      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/result-bundles/keys' });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  });

  describe('Key registration and revocation endpoints', () => {
    it('GET /api/v1/admin/result-bundles/keys returns list with usage counts', async () => {
      const { app } = createApp(btcAdmin, (text) => {
        if (text.includes('SELECT k.key_id')) {
          return {
            rows: [
              {
                key_id: KEY_ID,
                algorithm: 'Ed25519',
                public_key_pem: publicKeyPem,
                allowlisted_at: new Date('2026-10-24T08:00:00Z'),
                revoked_at: null,
                bundle_count: '2',
              },
            ],
          };
        }
        return undefined;
      });

      const res = await app.inject({ method: 'GET', url: '/api/v1/admin/result-bundles/keys' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        keyId: KEY_ID,
        fingerprint,
        bundleCount: 2,
      });
      await app.close();
    });

    it('POST /api/v1/admin/result-bundles/keys allows new Ed25519 key with confirmation', async () => {
      const { app } = createApp(btcAdmin, (text) => {
        if (text.includes('SELECT key_id')) return { rows: [] };
        if (text.includes('INSERT INTO result_bundle_keys')) return { rows: [{ allowlisted_at: new Date() }] };
        return undefined;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles/keys',
        payload: {
          keyId: KEY_ID,
          publicKeyPem,
          fingerprintConfirmation: fingerprint,
          reason: 'Initial setup',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.data).toMatchObject({
        keyId: KEY_ID,
        fingerprint,
        algorithm: 'Ed25519',
        replayed: false,
      });
      await app.close();
    });

    it('POST /api/v1/admin/result-bundles/keys rejects private key payload with 400', async () => {
      const { app } = createApp(btcAdmin);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles/keys',
        payload: {
          keyId: KEY_ID,
          publicKeyPem: privateKeyPem,
          fingerprintConfirmation: fingerprint,
          reason: 'Should be rejected',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RESULT_BUNDLE_KEY_PRIVATE_REJECTED');
      // Assert private key is never echoed
      expect(res.body).not.toContain('PRIVATE KEY');
      await app.close();
    });

    it('POST /api/v1/admin/result-bundles/keys returns 422 on fingerprint mismatch', async () => {
      const { app } = createApp(btcAdmin, (text) => {
        if (text.includes('SELECT public_key_pem')) return { rows: [] };
        return undefined;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles/keys',
        payload: {
          keyId: KEY_ID,
          publicKeyPem,
          fingerprintConfirmation: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          reason: 'Mismatch test',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FINGERPRINT_MISMATCH');
      await app.close();
    });

    it('POST /api/v1/admin/result-bundles/keys/:keyId/revoke revokes an existing key', async () => {
      const { app } = createApp(btcAdmin, (text) => {
        if (text.includes('SELECT key_id, revoked_at')) {
          return { rows: [{ key_id: KEY_ID, revoked_at: null }] };
        }
        if (text.includes('UPDATE result_bundle_keys SET revoked_at')) {
          return { rows: [{ revoked_at: new Date('2026-10-24T09:00:00Z') }] };
        }
        return undefined;
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/result-bundles/keys/${KEY_ID}/revoke`,
        payload: { reason: 'Key rotation' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toMatchObject({
        keyId: KEY_ID,
        replayed: false,
      });
      await app.close();
    });

    it('POST /api/v1/admin/result-bundles/keys/:keyId/revoke returns 404 for unknown key', async () => {
      const { app } = createApp(btcAdmin, () => ({ rows: [] }));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles/keys/unknown-key/revoke',
        payload: { reason: 'Revoke unknown' },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RESULT_BUNDLE_KEY_NOT_FOUND');
      await app.close();
    });
  });

  describe('Dry-run verification and import endpoints', () => {
    it('POST /api/v1/admin/result-bundles?dryRun=true returns verification summary without database writes', async () => {
      const bundle = await createValidSignedBundle();

      const { app, calls } = createApp(btcAdmin, (text) => {
        if (text.includes('SELECT public_key_pem FROM result_bundle_keys WHERE key_id = $1 AND revoked_at IS NULL')) {
          return { rows: [{ public_key_pem: publicKeyPem }] };
        }
        return undefined;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles?dryRun=true',
        payload: bundle,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data).toMatchObject({
        bundleId: bundle.manifest.bundleId,
        bundleVersion: 1,
        keyId: KEY_ID,
        fingerprint,
        valid: true,
      });
      expect(body.data.artifacts).toBeGreaterThanOrEqual(15);

      // Verification only queries key; never inserts into result_bundles or audit_events
      expect(calls.some((c) => c.text.includes('INSERT INTO result_bundles'))).toBe(false);
      expect(calls.some((c) => c.text.includes('INSERT INTO audit_events'))).toBe(false);
      await app.close();
    });

    it('POST /api/v1/admin/result-bundles?dryRun=true rejects schema-invalid artifacts with 422', async () => {
      const invalidBundle = createSchemaInvalidSignedBundle();

      const { app } = createApp(btcAdmin, (text) => {
        if (text.includes('SELECT public_key_pem FROM result_bundle_keys')) {
          return { rows: [{ public_key_pem: publicKeyPem }] };
        }
        return undefined;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles?dryRun=true',
        payload: invalidBundle,
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RESULT_BUNDLE_ARTIFACT_INVALID');
      await app.close();
    });

    it('POST /api/v1/admin/result-bundles rejects schema-invalid artifacts on publish with 422 and writes nothing', async () => {
      const invalidBundle = createSchemaInvalidSignedBundle();
      let wroteToDb = false;

      const { app } = createApp(btcAdmin, (text) => {
        if (text.includes('SELECT public_key_pem FROM result_bundle_keys')) {
          return { rows: [{ public_key_pem: publicKeyPem }] };
        }
        if (text.includes('INSERT INTO') || text.includes('UPDATE')) {
          wroteToDb = true;
          return { rows: [] };
        }
        return undefined;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles',
        payload: invalidBundle,
      });

      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('RESULT_BUNDLE_ARTIFACT_INVALID');
      expect(wroteToDb).toBe(false);
      await app.close();
    });

    it('POST /api/v1/admin/result-bundles/verify acts as dry-run endpoint', async () => {
      const bundle = await createValidSignedBundle();

      const { app } = createApp(btcAdmin, (text) => {
        if (text.includes('SELECT public_key_pem FROM result_bundle_keys')) {
          return { rows: [{ public_key_pem: publicKeyPem }] };
        }
        return undefined;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles/verify',
        payload: bundle,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.valid).toBe(true);
      await app.close();
    });

    it('rejects revoked keys in both dry-run and import with 422 RESULT_BUNDLE_KEY_UNKNOWN', async () => {
      const bundle = await createValidSignedBundle();

      // revoked_at IS NULL condition means revoked key returns 0 rows
      const { app, calls } = createApp(btcAdmin, (text) => {
        if (text.includes('FROM result_bundle_keys WHERE key_id = $1 AND revoked_at IS NULL')) {
          return { rows: [] };
        }
        return undefined;
      });

      const dryRunRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles?dryRun=true',
        payload: bundle,
      });
      expect(dryRunRes.statusCode).toBe(422);
      expect(JSON.parse(dryRunRes.body).error.code).toBe('RESULT_BUNDLE_KEY_UNKNOWN');
      expect(calls.some((c) => c.text.includes('INSERT INTO'))).toBe(false);

      const importRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles',
        payload: bundle,
      });
      expect(importRes.statusCode).toBe(422);
      expect(JSON.parse(importRes.body).error.code).toBe('RESULT_BUNDLE_KEY_UNKNOWN');

      await app.close();
    });

    it('rejects tampered artifacts in dry-run with 422 RESULT_BUNDLE_ARTIFACT_TAMPERED', async () => {
      const bundle = await createValidSignedBundle();
      // Tamper artifact payload
      const tampered = {
        ...bundle,
        artifacts: bundle.artifacts.map((a, i) => (i === 0 ? { ...a, payloadBase64: Buffer.from('{"tampered":true}').toString('base64') } : a)),
      };

      const { app } = createApp(btcAdmin, (text) => {
        if (text.includes('FROM result_bundle_keys')) {
          return { rows: [{ public_key_pem: publicKeyPem }] };
        }
        return undefined;
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/result-bundles?dryRun=true',
        payload: tampered,
      });
      expect(res.statusCode).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('RESULT_BUNDLE_ARTIFACT_TAMPERED');
      await app.close();
    });
  });

  describe('Public endpoints and replay resolution', () => {
    it('serves bundle replays through GET /api/v1/public/result-bundles/:bundleId/replays/:matchId', async () => {
      const matchId = '00000000-0000-4000-8000-000000000102';
      const bundleId = 'test-bundle-01';
      const fakeReplay = {
        schema: 'ott.spectator-replay',
        schemaVersion: 1,
        matchId,
        header: { format: 'ott.match-event-log', formatVersion: 1, matchId, protocolVersion: 1, engineVersion: '1.0.0', game: { engineVersion: '1.0.0', maxTurns: 10, map: { id: 'map-standard-01' } } },
        entries: [],
        result: { winnerSide: 'O' },
        faults: { X: { recoverableTotal: 0, lastErrorCode: null }, O: { recoverableTotal: 0, lastErrorCode: null } },
      };
      const replayText = JSON.stringify(fakeReplay);
      const replaySha = createHash('sha256').update(replayText).digest('hex');

      const { app } = createApp(null, (text, values) => {
        if (
          text.includes('FROM result_bundle_artifacts rba') &&
          values?.[0] === bundleId &&
          values?.[1] === `replays/${matchId}.json`
        ) {
          return {
            rows: [
              {
                payload: Buffer.from(replayText, 'utf8'),
                sha256: replaySha,
              },
            ],
          };
        }
        return undefined;
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/result-bundles/${bundleId}/replays/${matchId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/vnd.ott.spectator-replay+json');
      expect(res.headers['x-replay-sha256']).toBe(`sha256:${replaySha}`);
      const body = JSON.parse(res.body);
      expect(body.matchId).toBe(matchId);

      const notFoundRes = await app.inject({
        method: 'GET',
        url: `/api/v1/public/result-bundles/${bundleId}/replays/00000000-0000-4000-8000-999999999999`,
      });
      expect(notFoundRes.statusCode).toBe(404);
      expect(JSON.parse(notFoundRes.body).error.code).toBe('REPLAY_NOT_FOUND');

      await app.close();
    });

    it('serves real synthetic demo bundle replay through D2 route and passes web parseSpectatorReplay validation', async () => {
      const demoBundle = await buildSyntheticDemoBundle(privateKeyPem);
      const replayArtifact = demoBundle.artifacts.find((a) => a.path.startsWith('replays/'));
      expect(replayArtifact).toBeDefined();

      const matchId = replayArtifact!.path.replace('replays/', '').replace('.json', '');
      const rawPayload = Buffer.from(replayArtifact!.payloadBase64, 'base64');
      const expectedSha = createHash('sha256').update(rawPayload).digest('hex');

      const { app } = createApp(null, (text, values) => {
        if (
          text.includes('FROM result_bundle_artifacts rba') &&
          values?.[0] === demoBundle.manifest.bundleId &&
          values?.[1] === replayArtifact!.path
        ) {
          return {
            rows: [
              {
                payload: rawPayload,
                sha256: expectedSha,
              },
            ],
          };
        }
        return undefined;
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/result-bundles/${demoBundle.manifest.bundleId}/replays/${matchId}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/vnd.ott.spectator-replay+json');
      expect(res.headers['x-replay-sha256']).toBe(`sha256:${expectedSha}`);

      const body = JSON.parse(res.body);
      const parsed = parseSpectatorReplay(body);
      expect(parsed.matchId).toBe(matchId);
      expect(parsed.schema).toBe('ott.spectator-replay');
      expect(parsed.result).toBeDefined();
      await app.close();
    });
  });
});
