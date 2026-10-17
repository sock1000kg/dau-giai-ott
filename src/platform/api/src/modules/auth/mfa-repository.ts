import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/client.ts';
import type { EncryptedTotpSecret } from './totp.ts';

export interface AdminMfaRecord {
  readonly account_id: string;
  readonly secret_ciphertext: Buffer;
  readonly secret_iv: Buffer;
  readonly secret_tag: Buffer;
  readonly key_version: number;
  readonly enrolled_at: Date;
  readonly last_used_step: string | null;
}

export async function getAdminMfa(database: Database, accountId: string): Promise<AdminMfaRecord | null> {
  const result = await database.query<AdminMfaRecord>(
    'SELECT account_id, secret_ciphertext, secret_iv, secret_tag, key_version, enrolled_at, last_used_step FROM admin_mfa WHERE account_id = $1',
    [accountId],
  );
  return result.rows[0] ?? null;
}

export async function upsertAdminMfa(
  database: Database,
  accountId: string,
  encrypted: EncryptedTotpSecret,
  step?: bigint,
): Promise<void> {
  const stepValue = step !== undefined ? step.toString() : null;
  await database.query(
    `INSERT INTO admin_mfa (account_id, secret_ciphertext, secret_iv, secret_tag, key_version, enrolled_at, last_used_step)
     VALUES ($1, $2, $3, $4, $5, now(), $6)
     ON CONFLICT (account_id) DO UPDATE SET
       secret_ciphertext = EXCLUDED.secret_ciphertext,
       secret_iv = EXCLUDED.secret_iv,
       secret_tag = EXCLUDED.secret_tag,
       key_version = EXCLUDED.key_version,
       enrolled_at = now(),
       last_used_step = EXCLUDED.last_used_step`,
    [accountId, encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion, stepValue],
  );
}

export async function recordTotpStepIfNewer(database: Database, accountId: string, step: bigint): Promise<boolean> {
  const result = await database.query<{ readonly account_id: string }>(
    `UPDATE admin_mfa
     SET last_used_step = $2
     WHERE account_id = $1 AND (last_used_step IS NULL OR last_used_step < $2)
     RETURNING account_id`,
    [accountId, step.toString()],
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function saveRecoveryCodesInTransaction(tx: Database, accountId: string, hashes: readonly string[]): Promise<void> {
  // Revoke old unused recovery codes
  await tx.query(
    'UPDATE admin_recovery_codes SET used_at = now() WHERE account_id = $1 AND used_at IS NULL',
    [accountId],
  );

  // Insert new recovery codes
  for (const hash of hashes) {
    await tx.query(
      'INSERT INTO admin_recovery_codes (id, account_id, code_sha256, created_at) VALUES ($1, $2, $3, now())',
      [randomUUID(), accountId, hash],
    );
  }
}

export async function saveRecoveryCodes(database: Database, accountId: string, hashes: readonly string[]): Promise<void> {
  await database.transaction((tx) => saveRecoveryCodesInTransaction(tx, accountId, hashes));
}

export async function consumeRecoveryCode(database: Database, accountId: string, codeHash: string): Promise<boolean> {
  const result = await database.query<{ readonly id: string }>(
    `UPDATE admin_recovery_codes
     SET used_at = now()
     WHERE code_sha256 = $1 AND account_id = $2 AND used_at IS NULL
     RETURNING id`,
    [codeHash, accountId],
  );
  return result.rowCount !== null && result.rowCount > 0;
}
