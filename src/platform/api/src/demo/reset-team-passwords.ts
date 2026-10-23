import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from 'redis';
import { createDatabase, type Database } from '../db/client.ts';
import { createPasswordHasher } from '../modules/auth/passwords.ts';
import { createRedisAuthStore } from '../modules/auth/sessions.ts';
import type { PasswordHasher } from '../modules/auth/types.ts';

const RESET_ACTION = 'DEMO_TEAM_PASSWORD_RESET';
type Environment = Readonly<Record<string, string | undefined>>;

export function resetTargets(env: Environment): string[] {
  if (env.OTT_DEMO_PASSWORD_RESET_ENABLED !== 'true') throw new Error('Demo password reset refused: OTT_DEMO_PASSWORD_RESET_ENABLED must be true');
  if (env.OTT_DEMO_MODE !== 'true') throw new Error('Demo password reset refused: OTT_DEMO_MODE must be true');
  if (env.OTT_DEPLOYMENT_MODE !== 'dev' && env.OTT_DEPLOYMENT_MODE !== 'test') throw new Error('Demo password reset refused: deployment mode must be dev or test');
  if (env.OTT_DEMO_PUBLIC === 'true' || env.DEMO_PUBLIC === 'true' || env.OTT_HOSTED_POC === 'true' || env.OTT_FINALS_MODE === 'true') throw new Error('Demo password reset refused in public, hosted, or finals mode');
  const targetUsers = (env.OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (targetUsers.length === 0 || new Set(targetUsers).size !== targetUsers.length) throw new Error('Demo password reset refused: explicit unique username allowlist is required');
  const password = env.OTT_DEMO_TEAM_PASSWORD ?? 'ABC123';
  if (password.length < 6 || password.length > 128 || /[\x00-\x1f\x7f,"'\r\n]/u.test(password)) throw new Error('Demo password reset refused: OTT_DEMO_TEAM_PASSWORD is invalid');
  return targetUsers;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { values.push(value); value = ''; }
    else value += char;
  }
  if (quoted) throw new Error('Demo accounts CSV has an unterminated quoted field');
  values.push(value);
  return values;
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

async function updateCredentialsCsv(csvPath: string, targetUsers: readonly string[], password: string): Promise<void> {
  const content = await fs.promises.readFile(csvPath, 'utf8');
  const lines = content.replace(/\r\n/gu, '\n').trimEnd().split('\n');
  const header = lines.shift();
  if (header === undefined) throw new Error('Demo accounts CSV is empty');
  const columns = parseCsvLine(header);
  const usernameIndex = columns.indexOf('username');
  const passwordIndex = columns.indexOf('password');
  const roleIndex = columns.indexOf('role');
  if (usernameIndex < 0 || passwordIndex < 0 || roleIndex < 0) throw new Error('Demo accounts CSV must contain username,password,role columns');
  const updated = new Set<string>();
  const rows = lines.map((line) => {
    const cells = parseCsvLine(line);
    const username = cells[usernameIndex];
    if (username !== undefined && targetUsers.includes(username)) {
      if (cells[roleIndex] !== 'TEAM_ACCOUNT') throw new Error('Demo accounts CSV contains a non-team allowlist entry');
      cells[passwordIndex] = password;
      updated.add(username);
    }
    return cells.map(csvCell).join(',');
  });
  if (targetUsers.some((username) => !updated.has(username))) throw new Error('Demo accounts CSV is missing one or more allowlisted team accounts');
  const directory = path.dirname(csvPath);
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.promises.chmod(directory, 0o700);
  const tempPath = path.join(directory, `.accounts-reset.${randomUUID()}.tmp`);
  await fs.promises.writeFile(tempPath, `${header}\n${rows.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.chmod(tempPath, 0o600);
  await fs.promises.rename(tempPath, csvPath);
  await fs.promises.chmod(csvPath, 0o600);
}

export async function resetDemoTeamPasswords(options: {
  readonly database: Database;
  readonly passwordHasher: PasswordHasher;
  readonly revokeAccount: (accountId: string) => Promise<void>;
  readonly environment?: Environment;
  readonly csvPath?: string;
}): Promise<number> {
  const env = options.environment ?? process.env;
  const targets = resetTargets(env);
  const password = env.OTT_DEMO_TEAM_PASSWORD ?? 'ABC123';
  const passwordHash = await options.passwordHasher.hash(password);
  const accounts = await options.database.transaction(async (tx) => {
    const result = await tx.query<{ id: string; username: string; team_id: string }>(
      "SELECT a.id, a.username, a.team_id FROM accounts a JOIN teams t ON t.id = a.team_id WHERE a.username = ANY($1::text[]) AND a.role = 'TEAM_ACCOUNT' AND a.status = 'ACTIVE' ORDER BY a.username FOR UPDATE OF a",
      [targets],
    );
    if (result.rows.length !== targets.length) throw new Error('Demo password reset refused: every allowlisted username must resolve to an active TEAM_ACCOUNT bound to a team');
    for (const account of result.rows) {
      await tx.query('UPDATE accounts SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, account.id]);
      await tx.query('INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason) VALUES ($1, $2, $3, $4, $5, $6)', [randomUUID(), account.id, RESET_ACTION, 'TEAM', account.team_id, 'Local demo scheduled reset']);
    }
    return result.rows;
  });
  for (const account of accounts) await options.revokeAccount(account.id);
  await updateCredentialsCsv(options.csvPath ?? env.OTT_DEMO_ACCOUNTS_CSV ?? path.resolve('.local/demo/accounts.csv'), targets, password);
  return accounts.length;
}

export async function main(): Promise<void> {
  const env = process.env;
  resetTargets(env);
  if (!env.DATABASE_URL || !env.REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required');
  const database = createDatabase({ connectionString: env.DATABASE_URL });
  const redis = createClient({ url: env.REDIS_URL });
  await redis.connect();
  try {
    const sessionStore = createRedisAuthStore(redis);
    const count = await resetDemoTeamPasswords({ database, passwordHasher: createPasswordHasher(), revokeAccount: (id) => sessionStore.revokeAccount(id), environment: env });
    process.stdout.write(`Reset ${count} allowlisted demo team account(s); credentials CSV updated.\n`);
  } finally {
    await Promise.all([database.close(), redis.quit()]);
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
