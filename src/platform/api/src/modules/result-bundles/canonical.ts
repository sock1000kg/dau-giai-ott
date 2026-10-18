import { createHash } from 'node:crypto';

/**
 * RFC 8785 (JSON Canonicalization Scheme) used for ResultBundle manifests.
 *
 * Keys are ordered by UTF-16 code units, strings are escaped exactly as `JSON.stringify` does, and
 * numbers use ECMAScript `Number::toString`, which is what `JSON.stringify` already emits. The JCS
 * output is therefore `JSON.stringify` over a recursively key-sorted structure, so no dependency is
 * added for canonicalization. The offline finals side signs this byte string with Ed25519 and the
 * hosted importer re-derives it before verifying the signature (see finals-result-bundle-v1.md).
 */

function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CANONICAL_NUMBER_INVALID');
    // JSON.stringify already normalizes -0 to 0, which is what RFC 8785 requires.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => serialize(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${serialize(entryValue)}`).join(',')}}`;
  }
  throw new Error('CANONICAL_VALUE_INVALID');
}

/** Canonical (RFC 8785) UTF-8 JSON text of `value`. */
export function canonicalizeJson(value: unknown): string {
  return serialize(value);
}

/** SHA-256 (hex) of the canonical manifest text: the value the importer recomputes and publishes. */
export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex');
}

/** SHA-256 (hex) of one artifact payload. */
export function sha256HexOf(payload: Uint8Array | string): string {
  return createHash('sha256').update(payload).digest('hex');
}
