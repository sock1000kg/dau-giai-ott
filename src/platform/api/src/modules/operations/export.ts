import { SECRET_KEY_PATTERN } from './types.ts';

/** Recursively drops every key that looks like a seed, credential, stderr, object key or token. */
export function stripSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecretKeys);
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      out[key] = stripSecretKeys(item);
    }
    return out;
  }
  return value;
}

export const AUDIT_EXPORT_FIELDS = ['id', 'actorAccountId', 'action', 'targetType', 'targetId', 'reason', 'correlationId', 'createdAt', 'details'] as const;
export const CASE_EXPORT_FIELDS = ['id', 'kind', 'status', 'teamId', 'roundId', 'submissionId', 'matchId', 'seriesId', 'openedBy', 'openedAt', 'decidedAt', 'correlationId', 'events'] as const;
export const CASE_EVENT_EXPORT_FIELDS = ['seq', 'eventType', 'actorAccountId', 'reason', 'evidence', 'decision', 'correlationId', 'createdAt'] as const;

function pick(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in row && !SECRET_KEY_PATTERN.test(field)) out[field] = row[field];
  }
  return out;
}

export function sanitizeAuditRecord(row: Record<string, unknown>): Record<string, unknown> {
  return stripSecretKeys(pick(row, AUDIT_EXPORT_FIELDS)) as Record<string, unknown>;
}

export function sanitizeCaseRecord(row: Record<string, unknown>): Record<string, unknown> {
  const picked = pick(row, CASE_EXPORT_FIELDS);
  if (Array.isArray(picked.events)) {
    picked.events = (picked.events as Record<string, unknown>[]).map((event) => pick(event, CASE_EVENT_EXPORT_FIELDS));
  }
  return stripSecretKeys(picked) as Record<string, unknown>;
}

export function toNdjson(records: readonly Record<string, unknown>[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : '');
}
