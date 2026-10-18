import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import { canonicalSha256, canonicalizeJson, sha256HexOf } from './canonical.ts';

/**
 * P3-D09 hosted importer for signed ResultBundles (docs/contracts/finals-result-bundle-v1.md).
 *
 * Trust model: the offline finals side owns the Ed25519 private key; the hosted system stores only an
 * allowlisted public key identified by `keyId`. One bad byte rejects the whole bundle, and nothing is
 * published until every declared artifact is stored and verified.
 */

export interface ResultBundleManifestArtifact {
  readonly path: string;
  readonly mediaType: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ResultBundleCorrection {
  readonly bundleId: string;
  readonly bundleVersion: number;
  readonly reason: string;
}

export interface ResultBundleManifestV1 {
  readonly schemaVersion: 1;
  readonly bundleId: string;
  readonly bundleVersion: number;
  readonly tournamentId: string;
  readonly finalsRuleSetId: string;
  readonly keyId: string;
  readonly createdAt: string;
  readonly correctionOf?: ResultBundleCorrection;
  readonly artifacts: readonly ResultBundleManifestArtifact[];
}

export interface ResultBundleArtifactPayload {
  readonly path: string;
  readonly payload: Uint8Array;
}

export interface ResultBundleImportInput {
  /** Parsed manifest; the canonical text is re-derived here, never taken from the caller. */
  readonly manifest: unknown;
  /** Base64 Ed25519 signature over the canonical manifest text. */
  readonly signature: string;
  readonly artifacts: readonly ResultBundleArtifactPayload[];
}

export interface ResultBundleImportResult {
  readonly bundleId: string;
  readonly bundleVersion: number;
  readonly keyId: string;
  readonly manifestSha256: string;
  readonly importedAt: Date;
  readonly status: 'VERIFIED';
  readonly replayed: boolean;
}

const sha256Pattern = /^[0-9a-f]{64}$/;
const rfc3339Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const allowedManifestKeys = new Set([
  'schemaVersion',
  'bundleId',
  'bundleVersion',
  'tournamentId',
  'finalsRuleSetId',
  'keyId',
  'createdAt',
  'correctionOf',
  'artifacts',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= max ? value : null;
}

/**
 * Paths are normalized, relative and unique: leading slashes, `..` segments, Windows drive letters and
 * duplicate entries are rejected so a bundle cannot address anything outside its own artifact set.
 */
export function normalizeArtifactPath(raw: string): string | null {
  if (raw.length === 0 || raw.length > 512) return null;
  if (raw.startsWith('/') || raw.startsWith('\\')) return null;
  if (/^[A-Za-z]:/.test(raw)) return null;
  const segments = raw.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

/** Strict manifest validation: unknown fields, bad versions, bad hashes and bad paths are refused. */
export function parseResultBundleManifest(value: unknown): ResultBundleManifestV1 {
  if (!isRecord(value)) throw new Error('RESULT_BUNDLE_MANIFEST_INVALID');
  for (const key of Object.keys(value)) {
    if (!allowedManifestKeys.has(key)) throw new Error('RESULT_BUNDLE_MANIFEST_INVALID');
  }
  if (value['schemaVersion'] !== 1) throw new Error('RESULT_BUNDLE_MANIFEST_INVALID');
  const bundleId = readText(value['bundleId'], 128);
  const tournamentId = readText(value['tournamentId'], 128);
  const finalsRuleSetId = readText(value['finalsRuleSetId'], 128);
  const keyId = readText(value['keyId'], 128);
  const createdAt = readText(value['createdAt'], 64);
  const bundleVersion = value['bundleVersion'];
  if (
    bundleId === null ||
    tournamentId === null ||
    finalsRuleSetId === null ||
    keyId === null ||
    createdAt === null ||
    !rfc3339Pattern.test(createdAt) ||
    !Number.isSafeInteger(bundleVersion) ||
    (bundleVersion as number) <= 0
  ) {
    throw new Error('RESULT_BUNDLE_MANIFEST_INVALID');
  }

  const rawArtifacts = value['artifacts'];
  if (!Array.isArray(rawArtifacts) || rawArtifacts.length === 0) throw new Error('RESULT_BUNDLE_MANIFEST_INVALID');
  const seen = new Set<string>();
  const artifacts: ResultBundleManifestArtifact[] = [];
  for (const entry of rawArtifacts) {
    if (!isRecord(entry)) throw new Error('RESULT_BUNDLE_MANIFEST_INVALID');
    const rawPath = readText(entry['path'], 512);
    const path = rawPath === null ? null : normalizeArtifactPath(rawPath);
    const mediaType = readText(entry['mediaType'], 128);
    const sha256 = entry['sha256'];
    const bytes = entry['bytes'];
    if (
      path === null ||
      mediaType === null ||
      typeof sha256 !== 'string' ||
      !sha256Pattern.test(sha256) ||
      !Number.isSafeInteger(bytes) ||
      (bytes as number) < 0 ||
      seen.has(path)
    ) {
      throw new Error('RESULT_BUNDLE_MANIFEST_INVALID');
    }
    seen.add(path);
    artifacts.push({ path, mediaType, sha256, bytes: bytes as number });
  }

  let correctionOf: ResultBundleCorrection | undefined;
  const rawCorrection = value['correctionOf'];
  if (rawCorrection !== undefined) {
    if (!isRecord(rawCorrection)) throw new Error('RESULT_BUNDLE_CORRECTION_INVALID');
    const correctedId = readText(rawCorrection['bundleId'], 128);
    const correctedVersion = rawCorrection['bundleVersion'];
    const reason = readText(rawCorrection['reason'], 500);
    if (
      correctedId === null ||
      reason === null ||
      !Number.isSafeInteger(correctedVersion) ||
      (correctedVersion as number) <= 0 ||
      (correctedVersion as number) >= (bundleVersion as number)
    ) {
      throw new Error('RESULT_BUNDLE_CORRECTION_INVALID');
    }
    correctionOf = { bundleId: correctedId, bundleVersion: correctedVersion as number, reason };
  }

  return {
    schemaVersion: 1,
    bundleId,
    bundleVersion: bundleVersion as number,
    tournamentId,
    finalsRuleSetId,
    keyId,
    createdAt,
    ...(correctionOf === undefined ? {} : { correctionOf }),
    artifacts,
  };
}

interface BundleKeyRow {
  readonly public_key_pem: string;
}

interface BundleRow {
  readonly manifest_sha256: string;
  readonly signature: string;
  readonly created_at: Date;
  readonly status: string;
}

function verifyEd25519(publicKeyPem: string, canonical: string, signatureBase64: string): boolean {
  try {
    return verifySignature(
      null,
      Buffer.from(canonical, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

export interface ImportResultBundleOptions {
  readonly actorAccountId: string;
}

/**
 * Verifies a signed bundle and publishes it all-or-nothing: strict manifest → canonical text →
 * allowlisted key → Ed25519 signature → every artifact present with matching byte length and SHA-256 →
 * one transaction that stores everything and only then marks `VERIFIED`. Re-importing the same
 * bundle/version/content is idempotent; changed content for the same version is refused, so a
 * correction must use a higher `bundleVersion` with `correctionOf.reason`.
 */
export async function importResultBundle(
  database: Database,
  input: ResultBundleImportInput,
  options: ImportResultBundleOptions,
): Promise<ResultBundleImportResult> {
  const manifest = parseResultBundleManifest(input.manifest);
  const canonical = canonicalizeJson(manifest);
  const manifestSha256 = canonicalSha256(manifest);

  const key = await database.query<BundleKeyRow>(
    'SELECT public_key_pem FROM result_bundle_keys WHERE key_id = $1 AND revoked_at IS NULL',
    [manifest.keyId],
  );
  const allowlisted = key.rows[0];
  if (allowlisted === undefined) throw new Error('RESULT_BUNDLE_KEY_UNKNOWN');
  if (!verifyEd25519(allowlisted.public_key_pem, canonical, input.signature)) {
    throw new Error('RESULT_BUNDLE_SIGNATURE_INVALID');
  }

  const provided = new Map<string, Uint8Array>();
  for (const artifact of input.artifacts) {
    const path = normalizeArtifactPath(artifact.path);
    if (path === null) throw new Error('RESULT_BUNDLE_ARTIFACT_UNLISTED');
    provided.set(path, artifact.payload);
  }
  for (const declared of manifest.artifacts) {
    const payload = provided.get(declared.path);
    if (payload === undefined) throw new Error('RESULT_BUNDLE_ARTIFACT_MISSING');
    if (payload.byteLength !== declared.bytes || sha256HexOf(payload) !== declared.sha256) {
      throw new Error('RESULT_BUNDLE_ARTIFACT_TAMPERED');
    }
  }
  if (provided.size !== manifest.artifacts.length) throw new Error('RESULT_BUNDLE_ARTIFACT_UNLISTED');

  return database.transaction(async (transaction) => {
    const existing = await transaction.query<BundleRow>(
      'SELECT manifest_sha256, signature, created_at, status FROM result_bundles WHERE bundle_id = $1 AND bundle_version = $2',
      [manifest.bundleId, manifest.bundleVersion],
    );
    const previous = existing.rows[0];
    if (previous !== undefined) {
      if (previous.manifest_sha256 === manifestSha256 && previous.signature === input.signature) {
        return {
          bundleId: manifest.bundleId,
          bundleVersion: manifest.bundleVersion,
          keyId: manifest.keyId,
          manifestSha256,
          importedAt: previous.created_at,
          status: 'VERIFIED' as const,
          replayed: true,
        };
      }
      throw new Error('RESULT_BUNDLE_VERSION_CONFLICT');
    }

    const inserted = await transaction.query<{ readonly created_at: Date }>(
      `INSERT INTO result_bundles
         (bundle_id, bundle_version, tournament_id, finals_rule_set_id, key_id, manifest, manifest_sha256,
          signature, correction_of_bundle_id, correction_of_bundle_version, correction_reason, status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,'IMPORTED')
       RETURNING created_at`,
      [
        manifest.bundleId,
        manifest.bundleVersion,
        manifest.tournamentId,
        manifest.finalsRuleSetId,
        manifest.keyId,
        JSON.stringify(manifest),
        manifestSha256,
        input.signature,
        manifest.correctionOf?.bundleId ?? null,
        manifest.correctionOf?.bundleVersion ?? null,
        manifest.correctionOf?.reason ?? null,
      ],
    );

    for (const declared of manifest.artifacts) {
      await transaction.query(
        `INSERT INTO result_bundle_artifacts (bundle_id, bundle_version, path, media_type, sha256, bytes, content)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          manifest.bundleId,
          manifest.bundleVersion,
          declared.path,
          declared.mediaType,
          declared.sha256,
          declared.bytes,
          Buffer.from(provided.get(declared.path)!),
        ],
      );
    }

    // Publication is the last write of the transaction: the deferred constraint trigger refuses a
    // VERIFIED bundle whose declared artifacts are not all stored.
    const verified = await transaction.query<{ readonly verified_at: Date }>(
      "UPDATE result_bundles SET status = 'VERIFIED', verified_at = now() WHERE bundle_id = $1 AND bundle_version = $2 RETURNING verified_at",
      [manifest.bundleId, manifest.bundleVersion],
    );
    await transaction.query(
      `INSERT INTO audit_events (id, actor_account_id, action, target_type, reason, details)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        randomUUID(),
        options.actorAccountId,
        'RESULT_BUNDLE_IMPORTED',
        'result_bundle',
        manifest.correctionOf === undefined ? 'import result bundle' : manifest.correctionOf.reason,
        JSON.stringify({
          bundleId: manifest.bundleId,
          bundleVersion: manifest.bundleVersion,
          keyId: manifest.keyId,
          manifestSha256,
          artifacts: manifest.artifacts.length,
          correctionOf: manifest.correctionOf ?? null,
        }),
      ],
    );

    return {
      bundleId: manifest.bundleId,
      bundleVersion: manifest.bundleVersion,
      keyId: manifest.keyId,
      manifestSha256,
      importedAt: verified.rows[0]?.verified_at ?? inserted.rows[0]!.created_at,
      status: 'VERIFIED' as const,
      replayed: false,
    };
  });
}

export interface ResultBundlePublicProof {
  readonly bundleId: string;
  readonly bundleVersion: number;
  readonly keyId: string;
  readonly manifestSha256: string;
  readonly importedAt: Date;
  readonly status: 'VERIFIED';
}

/** Public proof metadata only: never the private key, internal object key or unpublished replay. */
export async function getPublishedResultBundleProof(
  database: Database,
  bundleId: string,
): Promise<readonly ResultBundlePublicProof[]> {
  const rows = await database.query<{
    readonly bundle_id: string;
    readonly bundle_version: number;
    readonly key_id: string;
    readonly manifest_sha256: string;
    readonly verified_at: Date;
  }>(
    `SELECT bundle_id, bundle_version, key_id, manifest_sha256, verified_at
     FROM result_bundles WHERE bundle_id = $1 AND status = 'VERIFIED' ORDER BY bundle_version`,
    [bundleId],
  );
  return rows.rows.map((row) => ({
    bundleId: row.bundle_id,
    bundleVersion: row.bundle_version,
    keyId: row.key_id,
    manifestSha256: row.manifest_sha256,
    importedAt: row.verified_at,
    status: 'VERIFIED' as const,
  }));
}
