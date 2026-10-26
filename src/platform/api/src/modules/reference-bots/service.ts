import { createHash, randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type { Database } from '../../db/client.ts';
import type { ObjectStorage } from '../../storage/s3.ts';
import {
  isMissingReferenceBotObject,
  REFERENCE_BOT_POLICY_VERSION,
  validateReferenceBotArchive,
} from './archive.ts';

export interface ReferenceBotDto {
  readonly id: string;
  readonly displayName: string;
  readonly archiveSha256: string;
  readonly manifestDigest: string;
  readonly configDigest: string;
  readonly policyVersion: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly enabledAt: string | null;
  readonly disabledAt: string | null;
}

export interface ReferenceBotCall {
  readonly actorAccountId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
}

export class ReferenceBotServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ReferenceBotServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface ReferenceBotRow extends QueryResultRow {
  readonly id: string;
  readonly display_name: string;
  readonly object_key: string;
  readonly archive_sha256: string;
  readonly manifest_digest: string;
  readonly config_digest: string;
  readonly policy_version: string;
  readonly enabled: boolean;
  readonly created_at: Date | string;
  readonly enabled_at: Date | string | null;
  readonly disabled_at: Date | string | null;
}

interface AuditRow extends QueryResultRow {
  readonly details: { readonly requestHash?: string; readonly response?: ReferenceBotDto } | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDto(row: ReferenceBotRow): ReferenceBotDto {
  return {
    id: row.id,
    displayName: row.display_name,
    archiveSha256: row.archive_sha256,
    manifestDigest: row.manifest_digest,
    configDigest: row.config_digest,
    policyVersion: row.policy_version,
    enabled: row.enabled,
    createdAt: iso(row.created_at)!,
    enabledAt: iso(row.enabled_at),
    disabledAt: iso(row.disabled_at),
  };
}

function requestHash(action: string, targetId: string, payload: unknown, reason: string): string {
  return createHash('sha256').update(JSON.stringify({ action, targetId, payload, reason })).digest('hex');
}

function stableUploadId(actorAccountId: string, idempotencyKey: string): string {
  const chars = createHash('sha256').update(`REFERENCE_BOT_UPLOADED\0${actorAccountId}\0${idempotencyKey}`).digest('hex').slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 0x03) | 0x08).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function recordMutation(
  database: Database,
  call: ReferenceBotCall,
  action: string,
  targetId: string,
  payload: unknown,
  work: (tx: Database) => Promise<{ readonly before: unknown; readonly response: ReferenceBotDto }>,
): Promise<{ readonly data: ReferenceBotDto; readonly replayed: boolean }> {
  const hash = requestHash(action, targetId, payload, call.reason);
  return database.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `reference-bot:${call.actorAccountId}:${action}:${call.idempotencyKey}`,
    ]);
    const found = await tx.query<AuditRow>(
      'SELECT details FROM audit_events WHERE actor_account_id = $1 AND action = $2 AND idempotency_key = $3',
      [call.actorAccountId, action, call.idempotencyKey],
    );
    const prior = found.rows[0];
    if (prior !== undefined) {
      if (prior.details?.requestHash !== hash || prior.details.response === undefined) {
        throw new ReferenceBotServiceError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used for another request');
      }
      return { data: prior.details.response, replayed: true };
    }

    const result = await work(tx);
    await tx.query(
      `INSERT INTO audit_events
         (id, actor_account_id, action, target_type, target_id, reason, correlation_id, details, idempotency_key)
       VALUES ($1, $2, $3, 'REFERENCE_BOT', $4, $5, $6, $7::jsonb, $8)`,
      [
        randomUUID(), call.actorAccountId, action, targetId, call.reason, call.correlationId,
        JSON.stringify({ before: result.before, after: result.response, response: result.response, requestHash: hash }),
        call.idempotencyKey,
      ],
    );
    return { data: result.response, replayed: false };
  });
}

export async function listReferenceBots(database: Database): Promise<readonly ReferenceBotDto[]> {
  const result = await database.query<ReferenceBotRow>(
    `SELECT id, display_name, archive_sha256, manifest_digest, config_digest,
            policy_version, enabled, created_at, enabled_at, disabled_at
     FROM test_run_reference_bots
     ORDER BY created_at DESC, id`,
  );
  return result.rows.map(toDto);
}

export async function uploadReferenceBot(
  database: Database,
  storage: ObjectStorage,
  call: ReferenceBotCall,
  input: { readonly displayName: string; readonly archive: Uint8Array },
): Promise<{ readonly data: ReferenceBotDto; readonly replayed: boolean }> {
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new ReferenceBotServiceError(400, 'REFERENCE_BOT_NAME_INVALID', 'Bot name must be 1-80 visible characters');
  }
  let validated;
  try {
    validated = validateReferenceBotArchive(input.archive);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'OCI_ARCHIVE_INVALID';
    const status = code === 'ARCHIVE_TOO_LARGE' ? 413 : 400;
    throw new ReferenceBotServiceError(status, code, 'OCI archive is empty, oversized, or invalid');
  }

  try {
    const existing = await storage.get(validated.objectKey);
    const existingDigest = `sha256:${createHash('sha256').update(existing).digest('hex')}`;
    if (existingDigest !== validated.archiveSha256) {
      throw new ReferenceBotServiceError(500, 'REFERENCE_BOT_OBJECT_CORRUPT', 'Stored reference bot object failed its digest check');
    }
  } catch (error) {
    if (error instanceof ReferenceBotServiceError) throw error;
    if (!isMissingReferenceBotObject(error)) throw error;
    await storage.put(validated.objectKey, input.archive);
  }

  const payload = {
    displayName,
    archiveSha256: validated.archiveSha256,
    manifestDigest: validated.manifestDigest,
    configDigest: validated.configDigest,
    policyVersion: REFERENCE_BOT_POLICY_VERSION,
  };
  const id = stableUploadId(call.actorAccountId, call.idempotencyKey);
  try {
    return await recordMutation(database, call, 'REFERENCE_BOT_UPLOADED', id, payload, async (tx) => {
      const duplicate = await tx.query<{ readonly id: string }>(
        'SELECT id FROM test_run_reference_bots WHERE archive_sha256 = $1',
        [validated.archiveSha256],
      );
      if (duplicate.rows.length > 0) {
        throw new ReferenceBotServiceError(409, 'REFERENCE_BOT_ARCHIVE_EXISTS', 'This OCI archive is already in the BTC catalog');
      }
      const created = await tx.query<ReferenceBotRow>(
        `INSERT INTO test_run_reference_bots
           (id, display_name, object_key, archive_sha256, manifest_digest, config_digest,
            entrypoint, policy_version, enabled, created_by_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,FALSE,$9)
         RETURNING id, display_name, archive_sha256, manifest_digest, config_digest,
                   policy_version, enabled, created_at, enabled_at, disabled_at`,
        [id, displayName, validated.objectKey, validated.archiveSha256, validated.manifestDigest,
          validated.configDigest, JSON.stringify(validated.entrypoint), REFERENCE_BOT_POLICY_VERSION, call.actorAccountId],
      );
      const row = created.rows[0];
      if (row === undefined) throw new ReferenceBotServiceError(500, 'REFERENCE_BOT_CREATE_FAILED', 'Reference bot could not be created');
      return { before: null, response: toDto(row) };
    });
  } catch (error) {
    if (error instanceof ReferenceBotServiceError) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      throw new ReferenceBotServiceError(409, 'REFERENCE_BOT_ARCHIVE_EXISTS', 'This OCI archive is already in the BTC catalog');
    }
    throw error;
  }
}

export async function setReferenceBotEnabled(
  database: Database,
  call: ReferenceBotCall,
  id: string,
  enabled: boolean,
): Promise<{ readonly data: ReferenceBotDto; readonly replayed: boolean }> {
  const action = enabled ? 'REFERENCE_BOT_ACTIVATED' : 'REFERENCE_BOT_DISABLED';
  return recordMutation(database, call, action, id, { enabled }, async (tx) => {
    const found = await tx.query<ReferenceBotRow>(
      `SELECT id, display_name, archive_sha256, manifest_digest, config_digest,
              policy_version, enabled, created_at, enabled_at, disabled_at
       FROM test_run_reference_bots WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const prior = found.rows[0];
    if (prior === undefined) throw new ReferenceBotServiceError(404, 'REFERENCE_BOT_NOT_FOUND', 'Reference bot not found');
    if (prior.enabled === enabled) {
      throw new ReferenceBotServiceError(409, enabled ? 'REFERENCE_BOT_ALREADY_ACTIVE' : 'REFERENCE_BOT_ALREADY_DISABLED', 'Reference bot is already in that state');
    }
    const changed = await tx.query<ReferenceBotRow>(
      `UPDATE test_run_reference_bots
       SET enabled = $2,
           enabled_at = CASE WHEN $2 THEN now() ELSE enabled_at END,
           disabled_at = CASE WHEN $2 THEN NULL ELSE now() END,
           last_enabled_by_account_id = CASE WHEN $2 THEN $3 ELSE last_enabled_by_account_id END
       WHERE id = $1
       RETURNING id, display_name, archive_sha256, manifest_digest, config_digest,
                 policy_version, enabled, created_at, enabled_at, disabled_at`,
      [id, enabled, call.actorAccountId],
    );
    const row = changed.rows[0];
    if (row === undefined) throw new ReferenceBotServiceError(404, 'REFERENCE_BOT_NOT_FOUND', 'Reference bot not found');
    return { before: toDto(prior), response: toDto(row) };
  });
}
