import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';

import { createDatabase, type Database } from '../db/client.ts';
import { createPasswordHasher } from '../modules/auth/passwords.ts';
import type { PasswordHasher } from '../modules/auth/types.ts';
import { createS3Storage } from '../storage/s3.ts';
import { seedDemoReferenceBot } from './seed-reference-bot.ts';

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

function parseTeamCount(env: Readonly<Record<string, string | undefined>>): number {
  const val = env.OTT_DEMO_TEAM_COUNT;
  if (val === undefined || val === '') {
    return 2;
  }
  const parsed = Number(val);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error(
      `Demo seeder refused: OTT_DEMO_TEAM_COUNT must be an integer between 1 and 50 (got '${val}')`,
    );
  }
  return parsed;
}

function parsePassword(
  name: string,
  raw: string | undefined,
  defaultPassword: string,
): string {
  if (raw === undefined) {
    return defaultPassword;
  }
  if (typeof raw !== 'string' || raw.length < 6 || raw.length > 128) {
    throw new Error(`Demo seeder refused: ${name} must be between 6 and 128 characters`);
  }
  if (/[\x00-\x1F\x7F,"'\r\n]/.test(raw)) {
    throw new Error(
      `Demo seeder refused: ${name} contains forbidden control characters, commas, quotes, or newlines`,
    );
  }
  return raw;
}

export async function seedDemoAccounts(
  options: SeedDemoAccountsOptions,
): Promise<readonly SeedDemoAccountSummary[]> {
  const env = options.environment ?? process.env;
  assertDemoEnvironment(env);

  const teamCount = parseTeamCount(env);
  const btcPassword = parsePassword('OTT_DEMO_BTC_PASSWORD', env.OTT_DEMO_BTC_PASSWORD, PUBLIC_DEMO_PASSWORD);
  const teamPassword = parsePassword('OTT_DEMO_TEAM_PASSWORD', env.OTT_DEMO_TEAM_PASSWORD, PUBLIC_DEMO_PASSWORD);

  const btcPasswordHash = await options.passwordHasher.hash(btcPassword);
  const teamPasswordHash =
    btcPassword === teamPassword ? btcPasswordHash : await options.passwordHasher.hash(teamPassword);

  const { results, accountDetails } = await options.database.transaction(async (tx) => {
    // 1. Teams: Team 01 .. Team NN
    const teamIdsByName = new Map<string, string>();
    const teamsToEnsure: { name: string; email: string }[] = [];
    for (let i = 1; i <= teamCount; i++) {
      const numStr = String(i).padStart(2, '0');
      teamsToEnsure.push({
        name: `Team ${numStr}`,
        email: `team${numStr}@demo.invalid`,
      });
    }

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

    // 2. Accounts: btc, team01 .. teamNN
    const accountsToSeed: {
      username: string;
      role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
      teamId: string | null;
      teamName: string | null;
      passwordHash: string;
      expectedPassword: string;
    }[] = [
      {
        username: 'btc',
        role: 'BTC_ADMIN' as const,
        teamId: null,
        teamName: null,
        passwordHash: btcPasswordHash,
        expectedPassword: btcPassword,
      },
    ];

    for (let i = 1; i <= teamCount; i++) {
      const numStr = String(i).padStart(2, '0');
      const teamName = `Team ${numStr}`;
      const teamId = teamIdsByName.get(teamName);
      if (teamId === undefined) {
        throw new Error(`Missing team ID for '${teamName}'`);
      }
      accountsToSeed.push({
        username: `team${numStr}`,
        role: 'TEAM_ACCOUNT' as const,
        teamId,
        teamName,
        passwordHash: teamPasswordHash,
        expectedPassword: teamPassword,
      });
    }

    const summaries: SeedDemoAccountSummary[] = [];
    const details: {
      username: string;
      role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
      teamName: string | null;
      storedHash: string;
      expectedPassword: string;
      created: boolean;
    }[] = [];

    for (const acc of accountsToSeed) {
      const newId = randomUUID();
      const insertResult = await tx.query<{ readonly id: string }>(
        'INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (username) DO NOTHING RETURNING id',
        [newId, acc.username, acc.passwordHash, acc.role, acc.teamId],
      );

      if (insertResult.rows[0] !== undefined) {
        summaries.push({ username: acc.username, role: acc.role, created: true });
        details.push({
          username: acc.username,
          role: acc.role,
          teamName: acc.teamName,
          storedHash: acc.passwordHash,
          expectedPassword: acc.expectedPassword,
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
          expectedPassword: acc.expectedPassword,
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
      passwordCell = acc.expectedPassword;
    } else {
      const verified = await options.passwordHasher.verify(acc.storedHash, acc.expectedPassword);
      if (verified) {
        passwordCell = acc.expectedPassword;
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

    const s3Configured = Boolean(
      env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
    );
    if (s3Configured) {
      const s3Client = new S3Client({
        endpoint: env.S3_ENDPOINT!,
        region: env.S3_REGION ?? 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        },
      });
      try {
        const seeded = await seedDemoReferenceBot({
          database,
          storage: createS3Storage({ client: s3Client, bucket: env.S3_BUCKET! }),
          environment: env,
        });
        process.stdout.write(
          `Seeded BTC reference bot ${seeded.id} (${seeded.archiveSha256})\n`,
        );
      } finally {
        s3Client.destroy();
      }
    } else {
      process.stdout.write('S3 not configured; skipping BTC reference bot seed.\n');
    }
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
