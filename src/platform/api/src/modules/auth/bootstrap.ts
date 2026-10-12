import { randomUUID } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import type { PasswordHasher } from './types.ts';

export interface BootstrapBtcAdminOptions {
  readonly database: Database;
  readonly passwordHasher: PasswordHasher;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface BootstrapBtcAdminResult {
  readonly accountId: string;
  readonly created: boolean;
}

interface ExistingAccount {
  readonly id: string;
  readonly role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
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

  return options.database.transaction(async (database) => {
    const accountId = randomUUID();
    const inserted = await database.query<{ readonly id: string }>(
      "INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, $2, $3, 'BTC_ADMIN') ON CONFLICT (username) DO NOTHING RETURNING id",
      [accountId, username, await options.passwordHasher.hash(password)],
    );
    if (inserted.rows[0] !== undefined) {
      return { accountId: inserted.rows[0].id, created: true };
    }

    const existing = await database.query<ExistingAccount>('SELECT id, role FROM accounts WHERE username = $1 FOR UPDATE', [username]);
    const account = existing.rows[0];
    if (account === undefined) {
      throw new Error('BTC bootstrap account was not found after username conflict');
    }
    if (account.role !== 'BTC_ADMIN') {
      throw new Error('OTT_BOOTSTRAP_BTC_USERNAME is already assigned to a non-BTC account');
    }
    return { accountId: account.id, created: false };
  });
}
