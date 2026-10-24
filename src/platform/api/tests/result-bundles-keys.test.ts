import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db/client.ts';
import {
  allowlistResultBundleKey,
  computeKeyFingerprint,
  listResultBundleKeys,
  normalizeFingerprint,
  revokeResultBundleKey,
  validateKeyId,
  validatePublicKeyPem,
  validateReason,
} from '../src/modules/result-bundles/keys.ts';

describe('ResultBundle keys module', () => {
  const ed25519KeyPair = generateKeyPairSync('ed25519');
  const validPublicPem = ed25519KeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const validPrivatePem = ed25519KeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const otherKeyPair = generateKeyPairSync('ed25519');
  const otherPublicPem = otherKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const rsaKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaPublicPem = rsaKeyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  describe('fingerprint & parsing', () => {
    it('computes consistent 64-hex SHA-256 fingerprint from Ed25519 SPKI DER', () => {
      const fp1 = computeKeyFingerprint(validPublicPem);
      const fp2 = computeKeyFingerprint(ed25519KeyPair.publicKey);
      expect(fp1).toMatch(/^[0-9a-f]{64}$/);
      expect(fp1).toBe(fp2);
    });

    it('normalizes fingerprint confirmation ignoring whitespace and colons', () => {
      const fp = 'a1b2c3d4e5f6';
      expect(normalizeFingerprint('A1:B2:C3:D4:E5:F6')).toBe(fp);
      expect(normalizeFingerprint('  a1 b2 c3 d4 e5 f6 ')).toBe(fp);
    });

    it('rejects any key input containing "PRIVATE" without echoing the private key', () => {
      expect(() => validatePublicKeyPem(validPrivatePem)).toThrow('RESULT_BUNDLE_KEY_PRIVATE_REJECTED');
      expect(() => validatePublicKeyPem('-----BEGIN PRIVATE KEY-----\nMIG...')).toThrow('RESULT_BUNDLE_KEY_PRIVATE_REJECTED');
      expect(() => validatePublicKeyPem('something with private key text')).toThrow('RESULT_BUNDLE_KEY_PRIVATE_REJECTED');
    });

    it('rejects non-Ed25519 keys (e.g. RSA)', () => {
      expect(() => validatePublicKeyPem(rsaPublicPem)).toThrow('RESULT_BUNDLE_KEY_INVALID');
      expect(() => computeKeyFingerprint(rsaKeyPair.publicKey)).toThrow('RESULT_BUNDLE_KEY_INVALID');
    });

    it('validates keyId and reason', () => {
      expect(validateKeyId('valid-key_01')).toBe('valid-key_01');
      expect(() => validateKeyId('')).toThrow('RESULT_BUNDLE_KEY_ID_INVALID');
      expect(() => validateKeyId('invalid key with spaces')).toThrow('RESULT_BUNDLE_KEY_ID_INVALID');
      expect(() => validateKeyId('bad/char')).toThrow('RESULT_BUNDLE_KEY_ID_INVALID');

      expect(validateReason('Setup offline key')).toBe('Setup offline key');
      expect(() => validateReason('')).toThrow('INVALID_REASON');
      expect(() => validateReason('   ')).toThrow('INVALID_REASON');
      expect(() => validateReason('a'.repeat(501))).toThrow('INVALID_REASON');
    });
  });

  describe('allowlistResultBundleKey', () => {
    it('refuses registration when fingerprint confirmation does not match', async () => {
      const db = { query: vi.fn(), transaction: vi.fn() } as unknown as Database;
      await expect(
        allowlistResultBundleKey(db, {
          keyId: 'key-1',
          publicKeyPem: validPublicPem,
          fingerprintConfirmation: '0000000000000000000000000000000000000000000000000000000000000000',
          reason: 'Setup',
          actorAccountId: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow('FINGERPRINT_MISMATCH');
    });

    it('successfully registers a new key and inserts audit event', async () => {
      const expectedFp = computeKeyFingerprint(validPublicPem);
      const queryMock = vi.fn().mockResolvedValueOnce({ rows: [] }); // existing check
      const txQueryMock = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ allowlisted_at: new Date('2026-10-24T08:00:00Z') }] }) // insert key
        .mockResolvedValueOnce({ rows: [] }); // insert audit

      const db = {
        query: queryMock,
        transaction: vi.fn(async (fn: (tx: Database) => Promise<unknown>) => fn({ query: txQueryMock } as unknown as Database)),
      } as unknown as Database;

      const result = await allowlistResultBundleKey(db, {
        keyId: 'finals-key-1',
        publicKeyPem: validPublicPem,
        fingerprintConfirmation: expectedFp,
        reason: 'Initial setup for finals',
        actorAccountId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result).toMatchObject({
        keyId: 'finals-key-1',
        fingerprint: expectedFp,
        algorithm: 'Ed25519',
        replayed: false,
      });

      expect(txQueryMock).toHaveBeenCalledTimes(2);
      expect(txQueryMock.mock.calls[0]![0]).toContain('INSERT INTO result_bundle_keys');
      expect(txQueryMock.mock.calls[1]![0]).toContain('INSERT INTO audit_events');
      expect(txQueryMock.mock.calls[1]![0]).toContain('RESULT_BUNDLE_KEY_ALLOWLISTED');
      expect(txQueryMock.mock.calls[1]![1]![1]).toBe('Initial setup for finals');
    });

    it('is idempotent when re-registering the same keyId with the identical key', async () => {
      const expectedFp = computeKeyFingerprint(validPublicPem);
      const existingDate = new Date('2026-10-24T08:00:00Z');
      const queryMock = vi.fn().mockResolvedValueOnce({
        rows: [
          {
            key_id: 'finals-key-1',
            algorithm: 'Ed25519',
            public_key_pem: validPublicPem,
            allowlisted_at: existingDate,
            revoked_at: null,
          },
        ],
      });

      const db = { query: queryMock, transaction: vi.fn() } as unknown as Database;

      const result = await allowlistResultBundleKey(db, {
        keyId: 'finals-key-1',
        publicKeyPem: validPublicPem,
        fingerprintConfirmation: expectedFp,
        reason: 'Re-register identical key',
        actorAccountId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result).toMatchObject({
        keyId: 'finals-key-1',
        fingerprint: expectedFp,
        algorithm: 'Ed25519',
        allowlistedAt: existingDate,
        revokedAt: null,
        replayed: true,
      });
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('refuses registration (409 RESULT_BUNDLE_KEY_EXISTS) when keyId exists with different key', async () => {
      const otherFp = computeKeyFingerprint(otherPublicPem);
      const queryMock = vi.fn().mockResolvedValueOnce({
        rows: [
          {
            key_id: 'finals-key-1',
            algorithm: 'Ed25519',
            public_key_pem: validPublicPem,
            allowlisted_at: new Date(),
            revoked_at: null,
          },
        ],
      });

      const db = { query: queryMock, transaction: vi.fn() } as unknown as Database;

      await expect(
        allowlistResultBundleKey(db, {
          keyId: 'finals-key-1',
          publicKeyPem: otherPublicPem,
          fingerprintConfirmation: otherFp,
          reason: 'Overwrite attempt',
          actorAccountId: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow('RESULT_BUNDLE_KEY_EXISTS');
    });
  });

  describe('revokeResultBundleKey', () => {
    it('throws 404 RESULT_BUNDLE_KEY_NOT_FOUND if key does not exist', async () => {
      const db = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) } as unknown as Database;
      await expect(
        revokeResultBundleKey(db, {
          keyId: 'non-existent',
          reason: 'Revoke lost key',
          actorAccountId: '00000000-0000-0000-0000-000000000001',
        }),
      ).rejects.toThrow('RESULT_BUNDLE_KEY_NOT_FOUND');
    });

    it('revokes an active key and creates audit event', async () => {
      const queryMock = vi.fn().mockResolvedValueOnce({
        rows: [{ key_id: 'active-key', revoked_at: null }],
      });
      const revokedDate = new Date('2026-10-24T09:00:00Z');
      const txQueryMock = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ revoked_at: revokedDate }] })
        .mockResolvedValueOnce({ rows: [] });

      const db = {
        query: queryMock,
        transaction: vi.fn(async (fn: (tx: Database) => Promise<unknown>) => fn({ query: txQueryMock } as unknown as Database)),
      } as unknown as Database;

      const result = await revokeResultBundleKey(db, {
        keyId: 'active-key',
        reason: 'Compromised laptop',
        actorAccountId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result).toMatchObject({
        keyId: 'active-key',
        revokedAt: revokedDate,
        replayed: false,
      });
      expect(txQueryMock.mock.calls[1]![0]).toContain('RESULT_BUNDLE_KEY_REVOKED');
      expect(txQueryMock.mock.calls[1]![1]![1]).toBe('Compromised laptop');
    });

    it('is idempotent when key is already revoked', async () => {
      const revokedDate = new Date('2026-10-24T07:00:00Z');
      const queryMock = vi.fn().mockResolvedValueOnce({
        rows: [{ key_id: 'already-revoked', revoked_at: revokedDate }],
      });
      const db = { query: queryMock, transaction: vi.fn() } as unknown as Database;

      const result = await revokeResultBundleKey(db, {
        keyId: 'already-revoked',
        reason: 'Revoke again',
        actorAccountId: '00000000-0000-0000-0000-000000000001',
      });

      expect(result).toMatchObject({
        keyId: 'already-revoked',
        revokedAt: revokedDate,
        replayed: true,
      });
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('listResultBundleKeys', () => {
    it('returns keys with computed fingerprints and bundle counts', async () => {
      const expectedFp = computeKeyFingerprint(validPublicPem);
      const queryMock = vi.fn().mockResolvedValueOnce({
        rows: [
          {
            key_id: 'key-1',
            algorithm: 'Ed25519',
            public_key_pem: validPublicPem,
            allowlisted_at: new Date('2026-10-24T08:00:00Z'),
            revoked_at: null,
            bundle_count: 2,
          },
        ],
      });
      const db = { query: queryMock } as unknown as Database;

      const keys = await listResultBundleKeys(db);
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatchObject({
        keyId: 'key-1',
        fingerprint: expectedFp,
        algorithm: 'Ed25519',
        bundleCount: 2,
        revokedAt: null,
      });
    });
  });
});
