import { isOciArtifactReference, type OciArtifactReference } from './oci-reference.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MatchJobV1 {
  readonly schemaVersion: 'ott.match-job.v1';
  readonly matchId: string;
  readonly idempotencyKey: string;
  readonly policyVersion: string;
  readonly x: OciArtifactReference;
  readonly o: OciArtifactReference;
}

export type MatchJobValidation =
  | { readonly ok: true; readonly value: MatchJobV1 }
  | { readonly ok: false; readonly code: 'MATCH_JOB_INVALID' };

/** Strict allowlist rejects mutable tags, commands, and unrecognized payload fields. */
export function validateMatchJob(value: unknown): MatchJobValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, code: 'MATCH_JOB_INVALID' };
  const record = value as Record<string, unknown>;
  const expectedKeys = ['idempotencyKey', 'matchId', 'o', 'policyVersion', 'schemaVersion', 'x'];
  if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')) return { ok: false, code: 'MATCH_JOB_INVALID' };
  if (record.schemaVersion !== 'ott.match-job.v1'
    || typeof record.matchId !== 'string' || !UUID.test(record.matchId)
    || record.idempotencyKey !== record.matchId
    || typeof record.policyVersion !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(record.policyVersion)
    || !isOciArtifactReference(record.x) || !isOciArtifactReference(record.o)
    || record.x.policyVersion !== record.policyVersion || record.o.policyVersion !== record.policyVersion) {
    return { ok: false, code: 'MATCH_JOB_INVALID' };
  }
  return { ok: true, value: value as MatchJobV1 };
}
