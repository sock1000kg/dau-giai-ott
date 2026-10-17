import { randomUUID } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import type { PasswordHasher } from './types.ts';
import { encryptTotpSecret } from './totp.ts';
import { upsertAdminMfa } from './mfa-repository.ts';

export interface BootstrapBtcAdminOptions {
  readonly database: Database;
  readonly passwordHasher: PasswordHasher;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly totpEncryptionKey?: Buffer | null;
}

export interface BootstrapBtcAdminResult {
  readonly accountId: string;
  readonly created: boolean;
}

interface ExistingAccount {
  readonly id: string;
  readonly role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
}

function resolveEncryptionKey(options: BootstrapBtcAdminOptions, env: Readonly<Record<string, string | undefined>>): Buffer | null {
  if (options.totpEncryptionKey !== undefined) {
    return options.totpEncryptionKey;
  }
  const keyRaw = env.OTT_TOTP_ENCRYPTION_KEY;
  if (keyRaw !== undefined && keyRaw.trim() !== '') {
    const buf = Buffer.from(keyRaw.trim(), 'base64');
    if (buf.length === 32) {
      return buf;
    }
  }
  return null;
}

export async function bootstrapBtcAdmin(options: BootstrapBtcAdminOptions): Promise<BootstrapBtcAdminResult | null> {
  const environment = options.environment ?? process.env;
  const username = environment.OTT_BOOTSTRAP_BTC_USERNAME;
  const password = environment.OTT_BOOTSTRAP_BTC_PASSWORD;
  if (username === undefined && password === undefined) {
    return null;
  }
  if (username === undefined || password === undefined || username.trim() === '' || password === '') {
    throw new Error('OTT_BOOTSTRAP_BTC_USERNAME and OTT_BOOTSTRAP_BTC_PASSWORD must both be set');
  }

  const totpSecret = environment.OTT_BOOTSTRAP_BTC_TOTP_SECRET;

  return options.database.transaction(async (database) => {
    let accountId: string;
    let created: boolean;

    const newAccountId = randomUUID();
    const inserted = await database.query<{ readonly id: string }>(
      "INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, $2, $3, 'BTC_ADMIN') ON CONFLICT (username) DO NOTHING RETURNING id",
      [newAccountId, username, await options.passwordHasher.hash(password)],
    );
    if (inserted.rows[0] !== undefined) {
      accountId = inserted.rows[0].id;
      created = true;
    } else {
      const existing = await database.query<ExistingAccount>('SELECT id, role FROM accounts WHERE username = $1 FOR UPDATE', [username]);
      const account = existing.rows[0];
      if (account === undefined) {
        throw new Error('BTC bootstrap account was not found after username conflict');
      }
      if (account.role !== 'BTC_ADMIN') {
        throw new Error('OTT_BOOTSTRAP_BTC_USERNAME is already assigned to a non-BTC account');
      }
      accountId = account.id;
      created = false;
    }

    if (totpSecret !== undefined && totpSecret.trim() !== '') {
      const encryptionKey = resolveEncryptionKey(options, environment);
      if (encryptionKey === null || encryptionKey.length !== 32) {
        throw new Error('TOTP encryption key must be configured when OTT_BOOTSTRAP_BTC_TOTP_SECRET is provided');
      }
      const encrypted = encryptTotpSecret(totpSecret.trim(), encryptionKey);
      await upsertAdminMfa(database, accountId, encrypted);
    }

    return { accountId, created };
  });
}
