import {
  createHash,
  createPublicKey,
  type KeyObject,
} from 'node:crypto';

import type { Database } from '../../db/client.ts';

export interface ResultBundleKeyRecord {
  readonly keyId: string;
  readonly fingerprint: string;
  readonly algorithm: 'Ed25519';
  readonly allowlistedAt: Date;
  readonly revokedAt: Date | null;
  readonly bundleCount: number;
}

export interface AllowlistKeyInput {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly fingerprintConfirmation: string;
  readonly reason: string;
  readonly actorAccountId: string;
}

export interface AllowlistKeyResult {
  readonly keyId: string;
  readonly fingerprint: string;
  readonly algorithm: 'Ed25519';
  readonly allowlistedAt: Date;
  readonly revokedAt: Date | null;
  readonly replayed: boolean;
}

export interface RevokeKeyInput {
  readonly keyId: string;
  readonly reason: string;
  readonly actorAccountId: string;
}

export interface RevokeKeyResult {
  readonly keyId: string;
  readonly revokedAt: Date;
  readonly replayed: boolean;
}

const KEY_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Normalizes fingerprint confirmation strings by stripping colons, whitespace and lowercasing.
 */
export function normalizeFingerprint(raw: string): string {
  return raw.toLowerCase().replace(/[\s:]+/g, '');
}

/**
 * Validates the keyId format (1-128 alphanumeric, underscore, hyphen chars).
 */
export function validateKeyId(keyId: unknown): string {
  if (typeof keyId !== 'string' || !KEY_ID_REGEX.test(keyId)) {
    throw new Error('RESULT_BUNDLE_KEY_ID_INVALID');
  }
  return keyId;
}

/**
 * Validates an administrative reason (1-500 characters).
 */
export function validateReason(reason: unknown): string {
  if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 500) {
    throw new Error('INVALID_REASON');
  }
  return reason.trim();
}

/**
 * Computes the canonical fingerprint of an Ed25519 public key.
 *
 * Definition: SHA-256 hex digest of the SubjectPublicKeyInfo (SPKI) DER-encoded byte sequence.
 */
export function computeKeyFingerprint(key: string | KeyObject | Buffer): string {
  let der: Buffer;
  if (Buffer.isBuffer(key)) {
    der = key;
  } else if (typeof key === 'string') {
    const keyObject = createPublicKey(key);
    if (keyObject.asymmetricKeyType !== 'ed25519') {
      throw new Error('RESULT_BUNDLE_KEY_INVALID');
    }
    der = keyObject.export({ type: 'spki', format: 'der' });
  } else {
    if (key.asymmetricKeyType !== 'ed25519') {
      throw new Error('RESULT_BUNDLE_KEY_INVALID');
    }
    der = key.export({ type: 'spki', format: 'der' });
  }
  return createHash('sha256').update(der).digest('hex');
}

/**
 * Strict parser & validator for public key PEM strings:
 * - Refuses any string containing 'PRIVATE' (case-insensitive) without logging or echoing the key.
 * - Must parse as valid SPKI Ed25519 public key.
 */
export function validatePublicKeyPem(pem: unknown): {
  readonly keyObject: KeyObject;
  readonly fingerprint: string;
  readonly normalizedPem: string;
} {
  if (typeof pem !== 'string' || pem.trim().length === 0) {
    throw new Error('RESULT_BUNDLE_KEY_INVALID');
  }
  if (pem.toUpperCase().includes('PRIVATE')) {
    throw new Error('RESULT_BUNDLE_KEY_PRIVATE_REJECTED');
  }
  try {
    const keyObject = createPublicKey(pem);
    if (keyObject.type !== 'public' || keyObject.asymmetricKeyType !== 'ed25519') {
      throw new Error('RESULT_BUNDLE_KEY_INVALID');
    }
    const fingerprint = computeKeyFingerprint(keyObject);
    const normalizedPem = keyObject.export({ type: 'spki', format: 'pem' }).toString();
    return { keyObject, fingerprint, normalizedPem };
  } catch (error) {
    if (error instanceof Error && error.message === 'RESULT_BUNDLE_KEY_PRIVATE_REJECTED') {
      throw error;
    }
    throw new Error('RESULT_BUNDLE_KEY_INVALID');
  }
}

interface RawKeyRow {
  readonly key_id: string;
  readonly algorithm: 'Ed25519';
  readonly public_key_pem: string;
  readonly allowlisted_at: Date;
  readonly revoked_at: Date | null;
  readonly bundle_count: number | string;
}

/**
 * Lists all allowlisted result bundle keys with their bundle usage count.
 */
export async function listResultBundleKeys(database: Database): Promise<readonly ResultBundleKeyRecord[]> {
  const result = await database.query<RawKeyRow>(
    `SELECT k.key_id, k.algorithm, k.public_key_pem, k.allowlisted_at, k.revoked_at,
            COUNT(b.bundle_id)::int AS bundle_count
     FROM result_bundle_keys k
     LEFT JOIN result_bundles b ON b.key_id = k.key_id
     GROUP BY k.key_id, k.algorithm, k.public_key_pem, k.allowlisted_at, k.revoked_at
     ORDER BY k.allowlisted_at DESC`,
  );

  return result.rows.map((row) => {
    let fingerprint = '';
    try {
      fingerprint = computeKeyFingerprint(row.public_key_pem);
    } catch {
      fingerprint = 'unknown';
    }
    return {
      keyId: row.key_id,
      fingerprint,
      algorithm: row.algorithm,
      allowlistedAt: row.allowlisted_at,
      revokedAt: row.revoked_at,
      bundleCount: typeof row.bundle_count === 'number' ? row.bundle_count : Number(row.bundle_count || 0),
    };
  });
}

/**
 * Registers an Ed25519 public key for verifying finals ResultBundles.
 *
 * Append-only semantics:
 * - If keyId exists with identical public key (matching fingerprint): idempotent 200.
 * - If keyId exists with different public key: 409 RESULT_BUNDLE_KEY_EXISTS.
 * - Otherwise: inserts into result_bundle_keys and logs audit event RESULT_BUNDLE_KEY_ALLOWLISTED.
 */
export async function allowlistResultBundleKey(
  database: Database,
  input: AllowlistKeyInput,
): Promise<AllowlistKeyResult> {
  const keyId = validateKeyId(input.keyId);
  const reason = validateReason(input.reason);
  const { fingerprint, normalizedPem } = validatePublicKeyPem(input.publicKeyPem);

  const normalizedConfirmation = normalizeFingerprint(input.fingerprintConfirmation ?? '');
  if (normalizedConfirmation !== fingerprint) {
    throw new Error('FINGERPRINT_MISMATCH');
  }

  const existing = await database.query<{
    readonly key_id: string;
    readonly algorithm: 'Ed25519';
    readonly public_key_pem: string;
    readonly allowlisted_at: Date;
    readonly revoked_at: Date | null;
  }>(
    'SELECT key_id, algorithm, public_key_pem, allowlisted_at, revoked_at FROM result_bundle_keys WHERE key_id = $1',
    [keyId],
  );

  const prev = existing.rows[0];
  if (prev !== undefined) {
    const prevFingerprint = computeKeyFingerprint(prev.public_key_pem);
    if (prevFingerprint === fingerprint) {
      return {
        keyId: prev.key_id,
        fingerprint,
        algorithm: prev.algorithm,
        allowlistedAt: prev.allowlisted_at,
        revokedAt: prev.revoked_at,
        replayed: true,
      };
    }
    throw new Error('RESULT_BUNDLE_KEY_EXISTS');
  }

  return database.transaction(async (tx) => {
    const inserted = await tx.query<{ readonly allowlisted_at: Date }>(
      `INSERT INTO result_bundle_keys (key_id, algorithm, public_key_pem)
       VALUES ($1, 'Ed25519', $2)
       RETURNING allowlisted_at`,
      [keyId, normalizedPem],
    );

    await tx.query(
      `INSERT INTO audit_events (id, actor_account_id, action, target_type, reason, details)
       VALUES (gen_random_uuid(), $1, 'RESULT_BUNDLE_KEY_ALLOWLISTED', 'result_bundle_key', $2, $3::jsonb)`,
      [
        input.actorAccountId,
        reason,
        JSON.stringify({
          keyId,
          fingerprint,
          reason,
        }),
      ],
    );

    return {
      keyId,
      fingerprint,
      algorithm: 'Ed25519' as const,
      allowlistedAt: inserted.rows[0]!.allowlisted_at,
      revokedAt: null,
      replayed: false,
    };
  });
}

/**
 * Revokes an existing ResultBundle key.
 *
 * Sets revoked_at = now() and logs RESULT_BUNDLE_KEY_REVOKED.
 * Idempotent: already revoked key returns 200 with existing revoked_at.
 */
export async function revokeResultBundleKey(
  database: Database,
  input: RevokeKeyInput,
): Promise<RevokeKeyResult> {
  const keyId = validateKeyId(input.keyId);
  const reason = validateReason(input.reason);

  const existing = await database.query<{
    readonly key_id: string;
    readonly revoked_at: Date | null;
  }>(
    'SELECT key_id, revoked_at FROM result_bundle_keys WHERE key_id = $1',
    [keyId],
  );

  const row = existing.rows[0];
  if (row === undefined) {
    throw new Error('RESULT_BUNDLE_KEY_NOT_FOUND');
  }

  if (row.revoked_at !== null) {
    return {
      keyId,
      revokedAt: row.revoked_at,
      replayed: true,
    };
  }

  return database.transaction(async (tx) => {
    const updated = await tx.query<{ readonly revoked_at: Date }>(
      'UPDATE result_bundle_keys SET revoked_at = now() WHERE key_id = $1 RETURNING revoked_at',
      [keyId],
    );

    await tx.query(
      `INSERT INTO audit_events (id, actor_account_id, action, target_type, reason, details)
       VALUES (gen_random_uuid(), $1, 'RESULT_BUNDLE_KEY_REVOKED', 'result_bundle_key', $2, $3::jsonb)`,
      [
        input.actorAccountId,
        reason,
        JSON.stringify({
          keyId,
          reason,
        }),
      ],
    );

    return {
      keyId,
      revokedAt: updated.rows[0]!.revoked_at,
      replayed: false,
    };
  });
}
