import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabase, type Database } from '../db/client.ts';
import { createPasswordHasher } from '../modules/auth/passwords.ts';
import type { PasswordHasher } from '../modules/auth/types.ts';

export const PUBLIC_DEMO_PASSWORD = 'ABC123';

export interface SeedDemoAccountsOptions {
  readonly database: Database;
  readonly passwordHasher: PasswordHasher;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly csvPath?: string;
  readonly now?: () => Date;
}

export interface SeedDemoAccountSummary {
  readonly username: string;
  readonly role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
  readonly created: boolean;
}

export function assertDemoEnvironment(env: Readonly<Record<string, string | undefined>>): void {
  const demoMode = env.OTT_DEMO_MODE;
  if (demoMode !== 'true') {
    throw new Error(`Demo seeder refused: OTT_DEMO_MODE must be 'true' (got '${demoMode ?? 'undefined'}')`);
  }
  const deploymentMode = env.OTT_DEPLOYMENT_MODE;
  if (deploymentMode !== 'dev' && deploymentMode !== 'test') {
    throw new Error(
      `Demo seeder refused: OTT_DEPLOYMENT_MODE must be 'dev' or 'test' (got '${deploymentMode ?? 'undefined'}')`,
    );
  }
}

export async function seedDemoAccounts(
  options: SeedDemoAccountsOptions,
): Promise<readonly SeedDemoAccountSummary[]> {
  const env = options.environment ?? process.env;
  assertDemoEnvironment(env);

  const demoPasswordHash = await options.passwordHasher.hash(PUBLIC_DEMO_PASSWORD);

  const { results, accountDetails } = await options.database.transaction(async (tx) => {
    // 1. Teams: Team 01 and Team 02
    const teamIdsByName = new Map<string, string>();
    const teamsToEnsure = [
      { name: 'Team 01', email: 'team01@demo.invalid' },
      { name: 'Team 02', email: 'team02@demo.invalid' },
    ];

    for (const team of teamsToEnsure) {
      const newId = randomUUID();
      const inserted = await tx.query<{ readonly id: string }>(
        'INSERT INTO teams (id, name, representative_email) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING RETURNING id',
        [newId, team.name, team.email],
      );
      if (inserted.rows[0] !== undefined) {
        teamIdsByName.set(team.name, inserted.rows[0].id);
      } else {
        const existing = await tx.query<{ readonly id: string }>(
          'SELECT id FROM teams WHERE name = $1',
          [team.name],
        );
        if (existing.rows[0] === undefined) {
          throw new Error(`Team '${team.name}' not found after conflict`);
        }
        teamIdsByName.set(team.name, existing.rows[0].id);
      }
    }

    // 2. Accounts: btc, team01, team02
    const accountsToSeed = [
      { username: 'btc', role: 'BTC_ADMIN' as const, teamId: null, teamName: null },
      { username: 'team01', role: 'TEAM_ACCOUNT' as const, teamId: teamIdsByName.get('Team 01')!, teamName: 'Team 01' },
      { username: 'team02', role: 'TEAM_ACCOUNT' as const, teamId: teamIdsByName.get('Team 02')!, teamName: 'Team 02' },
    ];

    const summaries: SeedDemoAccountSummary[] = [];
    const details: {
      username: string;
      role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
      teamName: string | null;
      storedHash: string;
      created: boolean;
    }[] = [];

    for (const acc of accountsToSeed) {
      const newId = randomUUID();
      const insertResult = await tx.query<{ readonly id: string }>(
        'INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING RETURNING id',
        [newId, acc.username, demoPasswordHash, acc.role, acc.teamId],
      );

      if (insertResult.rows[0] !== undefined) {
        summaries.push({ username: acc.username, role: acc.role, created: true });
        details.push({
          username: acc.username,
          role: acc.role,
          teamName: acc.teamName,
          storedHash: demoPasswordHash,
          created: true,
        });
      } else {
        const existing = await tx.query<{
          readonly id: string;
          readonly role: string;
          readonly team_id: string | null;
          readonly password_hash: string;
        }>(
          'SELECT id, role, team_id, password_hash FROM accounts WHERE username = $1 FOR UPDATE',
          [acc.username],
        );
        const existingRow = existing.rows[0];
        if (existingRow === undefined) {
          throw new Error(`Account '${acc.username}' not found after conflict`);
        }

        if (existingRow.role !== acc.role || existingRow.team_id !== acc.teamId) {
          throw new Error(
            `Account '${acc.username}' already exists with a different role or team binding (expected role='${acc.role}', team_id='${acc.teamId}'; found role='${existingRow.role}', team_id='${existingRow.team_id}')`,
          );
        }

        summaries.push({ username: acc.username, role: acc.role, created: false });
        details.push({
          username: acc.username,
          role: acc.role,
          teamName: acc.teamName,
          storedHash: existingRow.password_hash,
          created: false,
        });
      }
    }

    return { results: summaries, accountDetails: details };
  });

  // 3. Write CSV atomically
  const targetCsvPath =
    options.csvPath ?? env.OTT_DEMO_ACCOUNTS_CSV ?? path.resolve(process.cwd(), '.local/demo/accounts.csv');

  const csvRows: string[] = ['username,password,role,team'];

  for (const acc of accountDetails) {
    let passwordCell = '';
    if (acc.created) {
      passwordCell = PUBLIC_DEMO_PASSWORD;
    } else {
      const verified = await options.passwordHasher.verify(acc.storedHash, PUBLIC_DEMO_PASSWORD);
      if (verified) {
        passwordCell = PUBLIC_DEMO_PASSWORD;
      } else {
        passwordCell = '';
        process.stdout.write(`account ${acc.username} exists with a non-demo password; CSV cell left empty\n`);
      }
    }
    const teamCell = acc.teamName ?? '';
    csvRows.push(`${acc.username},${passwordCell},${acc.role},${teamCell}`);
  }

  const csvContent = `${csvRows.join('\n')}\n`;

  const dir = path.dirname(targetCsvPath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(dir, 0o700);

  const tempPath = path.join(dir, `.accounts.${randomUUID()}.tmp`);
  await fs.promises.writeFile(tempPath, csvContent, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.chmod(tempPath, 0o600);
  await fs.promises.rename(tempPath, targetCsvPath);
  await fs.promises.chmod(targetCsvPath, 0o600);

  return results;
}

export async function main(): Promise<void> {
  const env = process.env;
  assertDemoEnvironment(env);

  const connectionString = env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error('DATABASE_URL is required to run demo seeder');
  }

  const database = createDatabase({ connectionString });
  try {
    const passwordHasher = createPasswordHasher();
    const csvPath = env.OTT_DEMO_ACCOUNTS_CSV ?? path.resolve(process.cwd(), '.local/demo/accounts.csv');
    const summary = await seedDemoAccounts({
      database,
      passwordHasher,
      environment: env,
      csvPath,
    });
    process.stdout.write(`Seeded demo accounts to CSV: ${csvPath}\n`);
    process.stdout.write(`Accounts: ${summary.map((s) => s.username).join(', ')}\n`);
  } finally {
    await database.close();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1] === fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
