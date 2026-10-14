import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '../../db/client.ts';
import { appendAuditEvent } from '../auth/audit.ts';
import type { SessionStore } from '../auth/sessions.ts';
import type { PasswordHasher } from '../auth/types.ts';

export interface CsvRowError {
  readonly row: number;
  readonly column?: string;
  readonly code: string;
  readonly relatedRow?: number;
}

export interface ValidatedTeamRow {
  readonly teamName: string;
  readonly representativeEmail: string;
}

export type CsvValidationResult =
  | { readonly ok: true; readonly rows: readonly ValidatedTeamRow[] }
  | { readonly ok: false; readonly errors: readonly CsvRowError[] };

export interface TeamCredentialRow {
  readonly teamName: string;
  readonly representativeEmail: string | null;
  readonly username: string;
  readonly password: string;
}

export interface BulkResult {
  readonly csvContent: string;
  readonly batchId: string;
  readonly filename: string;
}

export class BulkConflictError extends Error {
  public readonly errors: readonly CsvRowError[];
  public constructor(errors: readonly CsvRowError[]) {
    super('CSV conflict with existing data');
    this.name = 'BulkConflictError';
    this.errors = errors;
  }
}

export class BulkNotFoundError extends Error {
  public readonly missingIndexes: readonly number[];
  public constructor(missingIndexes: readonly number[]) {
    super('One or more teams not found');
    this.name = 'BulkNotFoundError';
    this.missingIndexes = missingIndexes;
  }
}

export function generateCredential(name: string): { username: string; password: string } {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'team';
  return {
    username: `${slug}-${randomBytes(4).toString('hex')}`,
    password: randomBytes(24).toString('base64url'),
  };
}

/**
 * Pure RFC 4180 CSV parser.
 * Handles quoted fields, embedded commas, newlines, and escaped quotes ("").
 */
export function parseCsvRows(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i += 1;
          continue;
        }
      } else {
        currentField += char;
        i += 1;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i += 1;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField);
        currentField = '';
        i += 1;
        continue;
      } else if (char === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i += 1;
        }
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i += 1;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = '';
        i += 1;
        continue;
      } else {
        currentField += char;
        i += 1;
        continue;
      }
    }
  }

  // Final field/row if any
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCsv(input: string): CsvValidationResult {
  const rawRows = parseCsvRows(input);
  const errors: CsvRowError[] = [];

  // Trailing empty lines are allowed and stripped
  while (rawRows.length > 0) {
    const lastRow = rawRows[rawRows.length - 1]!;
    if (lastRow.length === 0 || (lastRow.length === 1 && lastRow[0]!.trim() === '')) {
      rawRows.pop();
    } else {
      break;
    }
  }

  if (rawRows.length === 0) {
    return { ok: false, errors: [{ row: 0, code: 'CSV_EMPTY' }] };
  }

  // Header check (row 0)
  const header = rawRows[0]!;
  if (
    header.length !== 2 ||
    header[0]!.trim().toLowerCase() !== 'team_name' ||
    header[1]!.trim().toLowerCase() !== 'representative_email'
  ) {
    return { ok: false, errors: [{ row: 0, code: 'CSV_HEADER_INVALID' }] };
  }

  const dataRows = rawRows.slice(1);
  if (dataRows.length === 0) {
    return { ok: false, errors: [{ row: 0, code: 'CSV_EMPTY' }] };
  }
  if (dataRows.length > 500) {
    return { ok: false, errors: [{ row: 0, code: 'CSV_TOO_MANY_ROWS' }] };
  }

  const validated: ValidatedTeamRow[] = [];
  const seenTeamNames = new Map<string, number>(); // lower(name) -> 1-based row
  const seenEmails = new Map<string, number>(); // lower(email) -> 1-based row

  for (let idx = 0; idx < dataRows.length; idx += 1) {
    const rowNum = idx + 1; // 1-based data row
    const row = dataRows[idx]!;

    if (row.length !== 2) {
      errors.push({ row: rowNum, code: 'ROW_FIELD_COUNT' });
      continue;
    }

    const rawTeamName = row[0]!;
    const rawEmail = row[1]!;

    const trimmedName = rawTeamName.trim();
    let nameValid = true;
    if (trimmedName.length === 0 || trimmedName.length > 100 || CONTROL_CHAR_REGEX.test(trimmedName)) {
      errors.push({ row: rowNum, column: 'team_name', code: 'TEAM_NAME_INVALID' });
      nameValid = false;
    }

    const trimmedEmail = rawEmail.trim().toLowerCase();
    let emailValid = true;
    if (
      trimmedEmail.length === 0 ||
      trimmedEmail.length > 254 ||
      CONTROL_CHAR_REGEX.test(trimmedEmail) ||
      !EMAIL_REGEX.test(trimmedEmail)
    ) {
      errors.push({ row: rowNum, column: 'representative_email', code: 'EMAIL_INVALID' });
      emailValid = false;
    }

    // In-file duplicate checks
    if (nameValid) {
      const lowerName = trimmedName.toLowerCase();
      const prevRow = seenTeamNames.get(lowerName);
      if (prevRow !== undefined) {
        errors.push({
          row: rowNum,
          column: 'team_name',
          code: 'DUPLICATE_TEAM_NAME',
          relatedRow: prevRow,
        });
      } else {
        seenTeamNames.set(lowerName, rowNum);
      }
    }

    if (emailValid) {
      const prevRow = seenEmails.get(trimmedEmail);
      if (prevRow !== undefined) {
        errors.push({
          row: rowNum,
          column: 'representative_email',
          code: 'DUPLICATE_EMAIL',
          relatedRow: prevRow,
        });
      } else {
        seenEmails.set(trimmedEmail, rowNum);
      }
    }

    if (nameValid && emailValid) {
      validated.push({
        teamName: trimmedName,
        representativeEmail: trimmedEmail,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, rows: validated };
}

function escapeCsvCell(value: string): string {
  let result = value;
  // Formula / injection safety: if starts with =, +, -, @, \t, or \r prepend '
  if (result.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(result[0]!)) {
    result = `'${result}`;
  }

  // Quoting if contains comma, double-quote, \r, or \n
  if (result.includes(',') || result.includes('"') || result.includes('\r') || result.includes('\n')) {
    result = `"${result.replace(/"/g, '""')}"`;
  }

  return result;
}

export function formatCredentialsCsv(rows: readonly TeamCredentialRow[]): string {
  const lines: string[] = [];
  // UTF-8 BOM
  lines.push('team_name,representative_email,username,password');

  for (const row of rows) {
    const teamName = escapeCsvCell(row.teamName);
    const email = escapeCsvCell(row.representativeEmail ?? '');
    const username = escapeCsvCell(row.username);
    const password = escapeCsvCell(row.password);
    lines.push(`${teamName},${email},${username},${password}`);
  }

  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function createCredentialFilename(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `team-credentials-${iso}.csv`;
}

/**
 * Executes a function with bounded concurrency.
 */
async function mapConcurrent<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex;
      nextIndex += 1;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function bulkImportTeams(
  database: Database,
  hasher: PasswordHasher,
  actorAccountId: string,
  rows: readonly ValidatedTeamRow[],
): Promise<BulkResult> {
  // Pre-generate credentials and hash passwords with concurrency 4 before transaction
  const prepared = await mapConcurrent(rows, 4, async (row) => {
    const cred = generateCredential(row.teamName);
    const passwordHash = await hasher.hash(cred.password);
    return {
      id: randomUUID(),
      accountId: randomUUID(),
      teamName: row.teamName,
      representativeEmail: row.representativeEmail,
      username: cred.username,
      password: cred.password,
      passwordHash,
    };
  });

  const batchId = randomUUID();

  await database.transaction(async (db) => {
    // Acquire advisory lock
    await db.query("SELECT pg_advisory_xact_lock(hashtext('teams:bulk'))");

    // Pre-check existing team names and emails
    const teamNames = rows.map((r) => r.teamName.toLowerCase());
    const emails = rows.map((r) => r.representativeEmail.toLowerCase());

    const existingNamesRes = await db.query<{ name: string }>(
      'SELECT lower(name) AS name FROM teams WHERE lower(name) = ANY($1)',
      [teamNames],
    );
    const existingEmailsRes = await db.query<{ email: string }>(
      'SELECT lower(representative_email) AS email FROM teams WHERE lower(representative_email) = ANY($1)',
      [emails],
    );

    const existingNamesSet = new Set(existingNamesRes.rows.map((r) => r.name.toLowerCase()));
    const existingEmailsSet = new Set(existingEmailsRes.rows.map((r) => r.email.toLowerCase()));

    const conflictErrors: CsvRowError[] = [];
    for (let idx = 0; idx < rows.length; idx += 1) {
      const rowNum = idx + 1; // 1-based data row
      const row = rows[idx]!;
      if (existingNamesSet.has(row.teamName.toLowerCase())) {
        conflictErrors.push({ row: rowNum, column: 'team_name', code: 'TEAM_NAME_TAKEN' });
      }
      if (existingEmailsSet.has(row.representativeEmail.toLowerCase())) {
        conflictErrors.push({ row: rowNum, column: 'representative_email', code: 'EMAIL_TAKEN' });
      }
    }

    if (conflictErrors.length > 0) {
      throw new BulkConflictError(conflictErrors);
    }

    // Insert teams and accounts
    for (const item of prepared) {
      try {
        await db.query('INSERT INTO teams (id, name, representative_email) VALUES ($1, $2, $3)', [
          item.id,
          item.teamName,
          item.representativeEmail,
        ]);
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
          // Unique violation fallback
          const message = 'detail' in err && typeof err.detail === 'string' ? err.detail : '';
          const isEmail = message.includes('representative_email') || message.includes('email');
          const rowIdx = rows.findIndex((r) =>
            isEmail
              ? r.representativeEmail.toLowerCase() === item.representativeEmail.toLowerCase()
              : r.teamName.toLowerCase() === item.teamName.toLowerCase(),
          );
          throw new BulkConflictError([
            {
              row: rowIdx >= 0 ? rowIdx + 1 : 1,
              column: isEmail ? 'representative_email' : 'team_name',
              code: isEmail ? 'EMAIL_TAKEN' : 'TEAM_NAME_TAKEN',
            },
          ]);
        }
        throw err;
      }

      // Username collision handling: retry up to 3 times
      let username = item.username;
      let insertedAccount = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await db.query(
            "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4)",
            [item.accountId, username, item.passwordHash, item.id],
          );
          insertedAccount = true;
          break;
        } catch (err: unknown) {
          if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
            username = generateCredential(item.teamName).username;
            continue;
          }
          throw err;
        }
      }

      if (!insertedAccount) {
        throw new BulkConflictError([
          { row: 1, column: 'username', code: 'USERNAME_TAKEN' },
        ]);
      }

      // One TEAM_CREATED audit event per team
      await appendAuditEvent(db, actorAccountId, 'TEAM_CREATED', 'TEAM', item.id);
    }

    // One TEAM_BULK_IMPORTED audit event for the batch
    await db.query(
      'INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), actorAccountId, 'TEAM_BULK_IMPORTED', 'TEAM_BATCH', batchId, `count=${prepared.length}`],
    );
  });

  const credentialRows: TeamCredentialRow[] = prepared.map((p) => ({
    teamName: p.teamName,
    representativeEmail: p.representativeEmail,
    username: p.username,
    password: p.password,
  }));

  const csvContent = formatCredentialsCsv(credentialRows);
  return {
    csvContent,
    batchId,
    filename: createCredentialFilename(),
  };
}

export async function bulkResetTeams(
  database: Database,
  hasher: PasswordHasher,
  sessionStore: SessionStore,
  actorAccountId: string,
  teamIds: readonly string[],
): Promise<BulkResult> {
  // Query all teams and accounts for teamIds
  const result = await database.query<{
    id: string;
    name: string;
    representative_email: string | null;
    account_id: string;
  }>(
    "SELECT teams.id, teams.name, teams.representative_email, accounts.id AS account_id FROM teams JOIN accounts ON accounts.team_id = teams.id WHERE teams.id = ANY($1) AND accounts.role = 'TEAM_ACCOUNT'",
    [teamIds],
  );

  const teamMap = new Map(result.rows.map((row) => [row.id, row]));
  const missingIndexes: number[] = [];

  for (let i = 0; i < teamIds.length; i += 1) {
    if (!teamMap.has(teamIds[i]!)) {
      missingIndexes.push(i);
    }
  }

  if (missingIndexes.length > 0) {
    throw new BulkNotFoundError(missingIndexes);
  }

  // Preserve request order
  const orderedTeams = teamIds.map((id) => teamMap.get(id)!);

  // Pre-generate credentials and hash passwords before transaction
  const prepared = await mapConcurrent(orderedTeams, 4, async (team) => {
    const cred = generateCredential(team.name);
    const passwordHash = await hasher.hash(cred.password);
    return {
      teamId: team.id,
      teamName: team.name,
      representativeEmail: team.representative_email,
      accountId: team.account_id,
      username: cred.username,
      password: cred.password,
      passwordHash,
    };
  });

  const batchId = randomUUID();

  await database.transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('teams:bulk'))");

    for (const item of prepared) {
      await db.query(
        'UPDATE accounts SET username = $1, password_hash = $2, updated_at = now() WHERE id = $3',
        [item.username, item.passwordHash, item.accountId],
      );
      await appendAuditEvent(db, actorAccountId, 'TEAM_CREDENTIAL_RESET', 'TEAM', item.teamId);
    }

    await db.query(
      'INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason) VALUES ($1, $2, $3, $4, $5, $6)',
      [randomUUID(), actorAccountId, 'TEAM_BULK_CREDENTIAL_RESET', 'TEAM_BATCH', batchId, `count=${prepared.length}`],
    );
  });

  // Revoke sessions after commit
  for (const item of prepared) {
    await sessionStore.revokeAccount(item.accountId);
  }

  const credentialRows: TeamCredentialRow[] = prepared.map((p) => ({
    teamName: p.teamName,
    representativeEmail: p.representativeEmail,
    username: p.username,
    password: p.password,
  }));

  const csvContent = formatCredentialsCsv(credentialRows);
  return {
    csvContent,
    batchId,
    filename: createCredentialFilename(),
  };
}
