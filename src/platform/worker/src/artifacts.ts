import { createHash } from 'node:crypto';
import { validateOciSubmission, type OciArtifactReference, type OciSubmissionIdentity } from '@ott/job-contract';
import type { SandboxPolicy } from './sandbox/policy.ts';

export type ArtifactErrorCode =
  | 'ARTIFACT_ARCHIVE_CHECKSUM_MISMATCH'
  | 'ARTIFACT_MANIFEST_DIGEST_MISMATCH'
  | 'ARTIFACT_CONFIG_DIGEST_MISMATCH'
  | 'ARTIFACT_ENTRYPOINT_MISMATCH'
  | 'ARTIFACT_POLICY_VERSION_MISMATCH'
  | 'ARTIFACT_INVALID';

export type PinnedArtifact = OciSubmissionIdentity & { readonly policyVersion: string };

export class ArtifactValidationError extends Error {
  public readonly code: ArtifactErrorCode;
  constructor(code: ArtifactErrorCode) { super(code); this.code = code; }
}

export function validatePinnedOciArtifact(
  archive: Uint8Array,
  reference: OciArtifactReference,
  expectedEntrypoint: readonly string[],
  policy: SandboxPolicy,
): PinnedArtifact {
  if (reference.policyVersion !== policy.version) throw new ArtifactValidationError('ARTIFACT_POLICY_VERSION_MISMATCH');
  if (archive.byteLength > 256 * 1024 * 1024) throw new ArtifactValidationError('ARTIFACT_INVALID');
  const actualArchiveSha = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
  if (actualArchiveSha !== reference.archiveSha256) throw new ArtifactValidationError('ARTIFACT_ARCHIVE_CHECKSUM_MISMATCH');
  const identity = validateOciSubmission(archive, {
    maxArchiveBytes: 256 * 1024 * 1024,
    maxUncompressedBytes: 512 * 1024 * 1024,
  });
  if (!identity.ok) throw new ArtifactValidationError('ARTIFACT_INVALID');
  if (actualArchiveSha !== identity.value.archiveSha256) {
    throw new ArtifactValidationError('ARTIFACT_ARCHIVE_CHECKSUM_MISMATCH');
  }
  if (identity.value.ociManifestDigest !== reference.manifestDigest) throw new ArtifactValidationError('ARTIFACT_MANIFEST_DIGEST_MISMATCH');
  if (identity.value.ociConfigDigest !== reference.configDigest) throw new ArtifactValidationError('ARTIFACT_CONFIG_DIGEST_MISMATCH');
  if (JSON.stringify(identity.value.entrypoint) !== JSON.stringify(expectedEntrypoint)) throw new ArtifactValidationError('ARTIFACT_ENTRYPOINT_MISMATCH');
  return { ...identity.value, entrypoint: [...identity.value.entrypoint], policyVersion: policy.version };
}
