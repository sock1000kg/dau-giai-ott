import { generateKeyPairSync, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { canonicalizeJson, sha256HexOf } from '../src/modules/result-bundles/canonical.ts';
import { buildSignedResultBundle, type BuildResultBundleInput } from '../src/modules/result-bundles/exporter.ts';
import {
  getPublishedResultBundleProof,
  importResultBundle,
  type ResultBundleImportInput,
} from '../src/modules/result-bundles/importer.ts';

/**
 * P3-D09 signed ResultBundle import (PostgreSQL required).
 *
 * Source of truth: docs/contracts/finals-result-bundle-v1.md — AC-20 valid/tamper/wrong-key/missing-file,
 * plus unlisted artifacts, idempotent re-import, correction rules and the no-partial-publication guard.
 * The suite is skipped when DATABASE_URL is unset.
 */

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

const KEY_ID = 'poc-test-key';

integration('P3-D09 signed ResultBundle import (PostgreSQL)', () => {
  let database: Database;
  const actorId = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const otherKeyPair = generateKeyPairSync('ed25519');
  const otherPrivateKeyPem = otherKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  function buildInput(bundleId: string, bundleVersion: number): BuildResultBundleInput {
    return {
      bundleId,
      bundleVersion,
      tournamentId: 'TOURNAMENT_INT',
      finalsRuleSetId: randomUUID(),
      keyId: KEY_ID,
      createdAt: new Date().toISOString(),
      artifacts: [
        { path: 'bracket.json', mediaType: 'application/json', payload: Buffer.from('{"bracket":true}') },
        { path: 'results/m1.json', mediaType: 'application/json', payload: Buffer.from('{"score":2}') },
      ],
    };
  }

  function signed(bundleId: string, bundleVersion = 1, privateKeyOverride?: string): {
    readonly payload: ResultBundleImportInput;
    readonly manifestSha256: string;
  } {
    const built = buildSignedResultBundle(buildInput(bundleId, bundleVersion), privateKeyOverride ?? privateKeyPem);
    return {
      payload: { manifest: built.manifest, signature: built.signature, artifacts: built.artifacts },
      manifestSha256: sha256HexOf(canonicalizeJson(built.manifest)),
    };
  }

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
    await database.query("INSERT INTO accounts (id, username, password_hash, role) VALUES ($1,$2,'x','BTC_ADMIN')", [
      actorId,
      `rb-int-${actorId.slice(0, 8)}`,
    ]);
    await database.query('INSERT INTO result_bundle_keys (key_id, algorithm, public_key_pem) VALUES ($1,$2,$3)', [
      KEY_ID,
      'Ed25519',
      publicKeyPem,
    ]);
  });

  afterAll(async () => {
    if (database === undefined) return;
    await database.query("DELETE FROM result_bundle_artifacts WHERE bundle_id LIKE 'rb-int-%'");
    await database.query("DELETE FROM result_bundles WHERE bundle_id LIKE 'rb-int-%'");
    await database.query('DELETE FROM result_bundle_keys WHERE key_id = $1', [KEY_ID]);
    await database.query('DELETE FROM audit_events WHERE actor_account_id = $1', [actorId]);
    await database.query('DELETE FROM accounts WHERE id = $1', [actorId]);
    await database.close();
  });

  it('AC-20 valid: imports a signed bundle, publishes proof and replays idempotently', async () => {
    const { payload, manifestSha256 } = signed(`rb-int-valid-${randomUUID()}`);
    const imported = await importResultBundle(database, payload, { actorAccountId: actorId });
    expect(imported).toMatchObject({ status: 'VERIFIED', replayed: false, keyId: KEY_ID, manifestSha256 });

    const proof = await getPublishedResultBundleProof(database, imported.bundleId);
    expect(proof).toHaveLength(1);
    expect(proof[0]).toMatchObject({ bundleVersion: 1, keyId: KEY_ID, manifestSha256, status: 'VERIFIED' });

    const replayed = await importResultBundle(database, payload, { actorAccountId: actorId });
    expect(replayed.replayed).toBe(true);
    expect(await getPublishedResultBundleProof(database, imported.bundleId)).toHaveLength(1);
  });

  it('AC-20 tamper: one changed byte rejects the whole bundle', async () => {
    const { payload } = signed(`rb-int-tamper-${randomUUID()}`);
    const bundleId = (payload.manifest as { readonly bundleId: string }).bundleId;
    const tampered: ResultBundleImportInput = {
      ...payload,
      artifacts: payload.artifacts.map((artifact, index) =>
        index === 0 ? { path: artifact.path, payload: Buffer.from('{"bracket":false}') } : artifact,
      ),
    };
    await expect(importResultBundle(database, tampered, { actorAccountId: actorId })).rejects.toThrow(
      'RESULT_BUNDLE_ARTIFACT_TAMPERED',
    );
    expect(await getPublishedResultBundleProof(database, bundleId)).toEqual([]);
  });

  it('AC-20 missing file: a declared artifact that is not uploaded is refused', async () => {
    const { payload } = signed(`rb-int-missing-${randomUUID()}`);
    const incomplete: ResultBundleImportInput = { ...payload, artifacts: payload.artifacts.slice(0, 1) };
    await expect(importResultBundle(database, incomplete, { actorAccountId: actorId })).rejects.toThrow(
      'RESULT_BUNDLE_ARTIFACT_MISSING',
    );
  });

  it('rejects artifacts the manifest does not declare', async () => {
    const { payload } = signed(`rb-int-unlisted-${randomUUID()}`);
    const extra: ResultBundleImportInput = {
      ...payload,
      artifacts: [...payload.artifacts, { path: 'secret.env', payload: Buffer.from('KEY=1') }],
    };
    await expect(importResultBundle(database, extra, { actorAccountId: actorId })).rejects.toThrow(
      'RESULT_BUNDLE_ARTIFACT_UNLISTED',
    );
  });

  it('rejects a manifest that points at a key which is not allowlisted', async () => {
    const built = buildSignedResultBundle(
      { ...buildInput(`rb-int-unknown-key-${randomUUID()}`, 1), keyId: 'not-allowlisted' },
      privateKeyPem,
    );
    await expect(
      importResultBundle(
        database,
        { manifest: built.manifest, signature: built.signature, artifacts: built.artifacts },
        { actorAccountId: actorId },
      ),
    ).rejects.toThrow('RESULT_BUNDLE_KEY_UNKNOWN');
  });

  it('rejects a manifest with a traversal path', async () => {
    const { payload } = signed(`rb-int-path-${randomUUID()}`);
    const manifest = { ...(payload.manifest as Record<string, unknown>), artifacts: [{ path: '../escape.json', mediaType: 'application/json', sha256: sha256HexOf('x'), bytes: 1 }] };
    await expect(
      importResultBundle(database, { ...payload, manifest }, { actorAccountId: actorId }),
    ).rejects.toThrow('RESULT_BUNDLE_MANIFEST_INVALID');
  });

  it('AC-20 wrong key: a signature from another key is refused', async () => {
    const { payload } = signed(`rb-int-wrong-key-${randomUUID()}`, 1, otherPrivateKeyPem);
    await expect(importResultBundle(database, payload, { actorAccountId: actorId })).rejects.toThrow(
      'RESULT_BUNDLE_SIGNATURE_INVALID',
    );
  });

  it('refuses different content for an already imported bundle version', async () => {
    const bundleId = `rb-int-conflict-${randomUUID()}`;
    const { payload } = signed(bundleId, 1);
    await importResultBundle(database, payload, { actorAccountId: actorId });

    const different = buildSignedResultBundle(
      {
        ...buildInput(bundleId, 1),
        artifacts: [
          { path: 'bracket.json', mediaType: 'application/json', payload: Buffer.from('{"bracket":"changed"}') },
          { path: 'results/m1.json', mediaType: 'application/json', payload: Buffer.from('{"score":2}') },
        ],
      },
      privateKeyPem,
    );
    await expect(
      importResultBundle(
        database,
        { manifest: different.manifest, signature: different.signature, artifacts: different.artifacts },
        { actorAccountId: actorId },
      ),
    ).rejects.toThrow('RESULT_BUNDLE_VERSION_CONFLICT');
    expect(await getPublishedResultBundleProof(database, bundleId)).toHaveLength(1);
  });

  it('accepts a correction with a higher version and a reason, and refuses a lower one', async () => {
    const bundleId = `rb-int-corrected-${randomUUID()}`;
    await importResultBundle(database, signed(bundleId, 1).payload, { actorAccountId: actorId });

    const corrected = buildSignedResultBundle(
      {
        ...buildInput(bundleId, 2),
        correctionOf: { bundleId, bundleVersion: 1, reason: 'score transcription fix' },
      },
      privateKeyPem,
    );
    const imported = await importResultBundle(
      database,
      { manifest: corrected.manifest, signature: corrected.signature, artifacts: corrected.artifacts },
      { actorAccountId: actorId },
    );
    expect(imported.bundleVersion).toBe(2);
    expect(await getPublishedResultBundleProof(database, bundleId)).toHaveLength(2);

    expect(() =>
      buildSignedResultBundle(
        {
          ...buildInput(bundleId, 2),
          correctionOf: { bundleId, bundleVersion: 2, reason: 'same version correction' },
        },
        privateKeyPem,
      ),
    ).toThrow('RESULT_BUNDLE_CORRECTION_INVALID');
  });

  it('never publishes a partial bundle: VERIFIED without all artifacts is refused at commit', async () => {
    const bundleId = `rb-int-partial-${randomUUID()}`;
    const manifest = signed(bundleId, 1).payload.manifest as Record<string, unknown>;
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO result_bundles
             (bundle_id, bundle_version, tournament_id, finals_rule_set_id, key_id, manifest, manifest_sha256,
              signature, status, verified_at)
           VALUES ($1,1,'TOURNAMENT_INT',$2,$3,$4::jsonb,$5,'sig','VERIFIED', now())`,
          [bundleId, randomUUID(), KEY_ID, JSON.stringify(manifest), sha256HexOf('manifest')],
        );
        // Only one of the two declared artifacts is stored, so the deferred trigger must fire.
        await transaction.query(
          `INSERT INTO result_bundle_artifacts (bundle_id, bundle_version, path, media_type, sha256, bytes, content)
           VALUES ($1,1,'bracket.json','application/json',$2,1,'x')`,
          [bundleId, sha256HexOf('x')],
        );
      }),
    ).rejects.toThrow(/cannot be published/);
    expect(await getPublishedResultBundleProof(database, bundleId)).toEqual([]);
  });
});
