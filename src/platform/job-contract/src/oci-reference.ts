const DIGEST = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OciArtifactReference {
  readonly submissionId: string;
  readonly archiveSha256: string;
  readonly manifestDigest: string;
  readonly configDigest: string;
  readonly policyVersion: string;
}

export function isOciArtifactReference(value: unknown): value is OciArtifactReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const expectedKeys = ['archiveSha256', 'configDigest', 'manifestDigest', 'policyVersion', 'submissionId'];
  return Object.keys(record).sort().join(',') === expectedKeys.join(',')
    && typeof record.submissionId === 'string' && UUID.test(record.submissionId)
    && typeof record.archiveSha256 === 'string' && DIGEST.test(record.archiveSha256)
    && typeof record.manifestDigest === 'string' && DIGEST.test(record.manifestDigest)
    && typeof record.configDigest === 'string' && DIGEST.test(record.configDigest)
    && typeof record.policyVersion === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(record.policyVersion);
}
