import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Fastify from 'fastify';
import type { QueryResult, QueryResultRow } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import { createAuthApp } from '../src/app.ts';
import { AuthorizationError } from '../src/modules/auth/authorize.ts';
import type { SessionPrincipal } from '../src/modules/auth/types.ts';
import { registerReferenceBotRoutes } from '../src/modules/reference-bots/routes.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';

function qr<Row extends QueryResultRow = QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

function createHarness(principal: SessionPrincipal | null) {
  const bots = new Map<string, Record<string, unknown>>();
  const audit: Record<string, unknown>[] = [];
  const query = vi.fn(async <Row extends QueryResultRow = QueryResultRow>(sql: string, values: readonly unknown[] = []) => {
    if (sql.includes('SELECT details FROM audit_events')) {
      const found = audit.find((event) => event.actor_account_id === values[0] && event.action === values[1] && event.idempotency_key === values[2]);
      return qr(found ? [{ details: found.details }] as unknown as Row[] : []);
    }
    if (sql.includes('FROM test_run_reference_bots') && sql.includes('archive_sha256 =')) {
      const found = [...bots.values()].find((bot) => bot.archive_sha256 === values[0]);
      return qr(found ? [found] as unknown as Row[] : []);
    }
    if (sql.includes('FROM test_run_reference_bots') && sql.includes('WHERE id =')) {
      const found = bots.get(String(values[0]));
      return qr(found ? [found] as unknown as Row[] : []);
    }
    if (sql.includes('FROM test_run_reference_bots')) {
      return qr([...bots.values()].sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))) as unknown as Row[]);
    }
    if (sql.includes('INSERT INTO test_run_reference_bots')) {
      const [id, displayName, objectKey, archiveSha256, manifestDigest, configDigest, entrypoint, policyVersion, actorId] = values;
      const row = {
        id, display_name: displayName, object_key: objectKey, archive_sha256: archiveSha256,
        manifest_digest: manifestDigest, config_digest: configDigest, entrypoint: JSON.parse(String(entrypoint)),
        policy_version: policyVersion, enabled: false, created_at: new Date(), enabled_at: null,
        disabled_at: null, created_by_account_id: actorId,
      };
      bots.set(String(id), row);
      return qr([row] as unknown as Row[]);
    }
    if (sql.includes('UPDATE test_run_reference_bots')) {
      const [id, enabled, actorId] = values;
      const row = bots.get(String(id));
      if (!row) return qr([]);
      Object.assign(row, { enabled, enabled_at: enabled ? new Date() : row.enabled_at, disabled_at: enabled ? null : new Date(), enabled_by_account_id: actorId });
      return qr([row] as unknown as Row[]);
    }
    if (sql.includes('INSERT INTO audit_events')) {
      const [id, actorId, action, targetId, reason, correlationId, details, idempotencyKey] = values;
      const targetType = 'REFERENCE_BOT';
      audit.push({ id, actor_account_id: actorId, action, target_type: targetType, target_id: targetId, reason, correlation_id: correlationId, details: JSON.parse(String(details)), idempotency_key: idempotencyKey });
      return qr();
    }
    return qr();
  });
  const database = {
    query,
    async transaction<T>(work: (tx: Database) => Promise<T>) { return work(database as unknown as Database); },
    async close() {},
  } as unknown as Database;
  const objects = new Map<string, Uint8Array>();
  const storage = {
    async get(key: string) { const value = objects.get(key); if (!value) { const error = new Error('missing'); error.name = 'NoSuchKey'; throw error; } return value; },
    async put(key: string, value: Uint8Array) { objects.set(key, value); },
    async copy() {},
    async remove(key: string) { objects.delete(key); },
  } as ObjectStorage;
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (request) => { request.principal = principal; });
  app.setErrorHandler((error, _request, reply) => error instanceof AuthorizationError
    ? reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } })
    : reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: String(error) } }));
  registerReferenceBotRoutes(app, { database, storage });
  return { app, bots, audit, objects, query, storage };
}

const admin: SessionPrincipal = { accountId: randomUUID(), role: 'BTC_ADMIN', teamId: undefined };
const archivePath = path.resolve(__dirname, '../../web/public/downloads/ott-demo-bot-go-v1.oci.tar');
const validArchive = fs.readFileSync(archivePath);
const manualCheckArchive = fs.readFileSync(path.resolve(__dirname, '../../../../demo/manually-check/artifacts/team-test-run-first-legal.oci.tar'));

describe('BTC reference bot management API', () => {
  it('registers the authenticated BTC API in the production app when object storage is configured', async () => {
    const harness = createHarness(null);
    const redis = {
      async get() { return null; }, async set() {}, async del() { return 0; },
      async incr() { return 1; }, async expire() {}, async sAdd() { return 0; }, async sMembers() { return []; },
    };
    const app = createAuthApp({
      database: {} as Database,
      redis,
      passwordHasher: { async hash() { return 'unused'; }, async verify() { return false; } },
      secureCookies: false,
      storage: harness.storage,
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/reference-bots' });
    expect(response.statusCode).toBe(401);
    await app.close();
    await harness.app.close();
  });

  it('lists safe metadata for BTC and rejects team access', async () => {
    const harness = createHarness({ accountId: admin.accountId, role: 'TEAM_ACCOUNT', teamId: randomUUID() });
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/admin/reference-bots' });
    expect(response.statusCode).toBe(403);
    await harness.app.close();

    const btc = createHarness(admin);
    const allowed = await btc.app.inject({ method: 'GET', url: '/api/v1/admin/reference-bots' });
    expect(allowed.statusCode).toBe(200);
    expect(JSON.stringify(allowed.json())).not.toContain('object_key');
    await btc.app.close();
  });

  it('validates and stores an OCI archive as disabled until BTC activates it', async () => {
    const harness = createHarness(admin);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/admin/reference-bots',
      headers: {
        'content-type': 'application/vnd.oci.image.archive.v1+tar',
        'x-reference-bot-name': 'BTC first legal',
        'x-change-reason': 'Publish reference bot for team practice',
        'idempotency-key': 'upload-reference-1',
      },
      payload: validArchive,
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().data).toMatchObject({ displayName: 'BTC first legal', enabled: false });
    expect(response.json().data.objectKey).toBeUndefined();
    expect(harness.bots.size).toBe(1);
    expect(harness.audit).toHaveLength(1);
    expect(harness.audit[0]?.target_id).toBe(response.json().data.id);
    expect(harness.objects.size).toBe(1);
    await harness.app.close();
  });

  it('accepts the prepared manual-check OCI archive above the API global body limit', async () => {
    const harness = createHarness(admin);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/admin/reference-bots',
      headers: {
        'content-type': 'application/vnd.oci.image.archive.v1+tar',
        'x-reference-bot-name': 'BTC team practice',
        'x-change-reason': 'Validate the prepared manual-check bot',
        'idempotency-key': 'upload-large-manual-check-1',
      },
      payload: manualCheckArchive,
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().data.archiveSha256).toBe(`sha256:${createHash('sha256').update(manualCheckArchive).digest('hex')}`);
    await harness.app.close();
  }, 15_000);

  it('rejects corrupt OCI bytes without storing an object or catalog row', async () => {
    const harness = createHarness(admin);
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/admin/reference-bots',
      headers: {
        'content-type': 'application/vnd.oci.image.archive.v1+tar',
        'x-reference-bot-name': 'Broken image',
        'x-change-reason': 'Must not be accepted',
        'idempotency-key': 'upload-reference-invalid',
      },
      payload: Buffer.from('not an OCI archive'),
    });

    expect(response.statusCode).toBe(400);
    expect(harness.bots.size).toBe(0);
    expect(harness.objects.size).toBe(0);
    expect(harness.audit).toHaveLength(0);
    await harness.app.close();
  });

  it('replays the same upload idempotently and rejects a changed request with the same key', async () => {
    const harness = createHarness(admin);
    const request = (name: string, reason: string) => harness.app.inject({
      method: 'POST', url: '/api/v1/admin/reference-bots',
      headers: {
        'content-type': 'application/vnd.oci.image.archive.v1+tar',
        'x-reference-bot-name': name, 'x-change-reason': reason, 'idempotency-key': 'upload-replay-1',
      }, payload: validArchive,
    });

    const first = await request('BTC first legal', 'Publish to teams');
    const replay = await request('BTC first legal', 'Publish to teams');
    const conflict = await request('Different display name', 'Publish to teams');
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.replayed).toBe(true);
    expect(replay.json().data.id).toBe(first.json().data.id);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(harness.bots.size).toBe(1);
    expect(harness.audit).toHaveLength(1);
    await harness.app.close();
  });

  it('rejects unsupported media types and incomplete upload metadata', async () => {
    const harness = createHarness(admin);
    const wrongType = await harness.app.inject({
      method: 'POST', url: '/api/v1/admin/reference-bots',
      headers: { 'content-type': 'application/octet-stream' }, payload: validArchive,
    });
    const missingReason = await harness.app.inject({
      method: 'POST', url: '/api/v1/admin/reference-bots',
      headers: { 'content-type': 'application/vnd.oci.image.archive.v1+tar', 'x-reference-bot-name': 'No reason', 'idempotency-key': 'missing-reason' },
      payload: validArchive,
    });
    expect(wrongType.statusCode, wrongType.body).toBe(415);
    expect(missingReason.statusCode).toBe(400);
    expect(harness.bots.size).toBe(0);
    expect(harness.objects.size).toBe(0);
    await harness.app.close();
  });

  it('enables and disables a bot with reasoned idempotent audit events', async () => {
    const harness = createHarness(admin);
    const uploaded = await harness.app.inject({
      method: 'POST', url: '/api/v1/admin/reference-bots',
      headers: {
        'content-type': 'application/vnd.oci.image.archive.v1+tar',
        'x-reference-bot-name': 'BTC first legal', 'x-change-reason': 'Publish for teams', 'idempotency-key': 'upload-for-toggle',
      }, payload: validArchive,
    });
    const id = uploaded.json().data.id as string;
    const enableHeaders = { 'idempotency-key': 'enable-reference-1', 'x-correlation-id': randomUUID() };
    const enabled = await harness.app.inject({ method: 'POST', url: `/api/v1/admin/reference-bots/${id}/activate`, headers: enableHeaders, payload: { reason: 'Approved for practice' } });
    const replay = await harness.app.inject({ method: 'POST', url: `/api/v1/admin/reference-bots/${id}/activate`, headers: enableHeaders, payload: { reason: 'Approved for practice' } });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().data.enabled).toBe(true);
    expect(replay.json().data.replayed).toBe(true);
    expect(harness.audit.filter((event) => event.action === 'REFERENCE_BOT_ACTIVATED')).toHaveLength(1);

    const disabled = await harness.app.inject({
      method: 'POST', url: `/api/v1/admin/reference-bots/${id}/disable`,
      headers: { 'idempotency-key': 'disable-reference-1' }, payload: { reason: 'Replace with updated image' },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().data.enabled).toBe(false);
    expect(harness.audit.filter((event) => event.action === 'REFERENCE_BOT_DISABLED')).toHaveLength(1);
    await harness.app.close();
  });
});
