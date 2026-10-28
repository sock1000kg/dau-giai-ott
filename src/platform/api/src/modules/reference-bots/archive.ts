import { createHash } from 'node:crypto';
import { validateOciSubmission } from '@ott/job-contract';

export const REFERENCE_BOT_ARCHIVE_LIMITS = {
  maxArchiveBytes: 256 * 1024 * 1024,
  maxUncompressedBytes: 512 * 1024 * 1024,
} as const;

export const REFERENCE_BOT_POLICY_VERSION = 'P2_BASELINE_V1';

export interface ValidatedReferenceBotArchive {
  readonly archiveSha256: string;
  readonly objectKey: string;
  readonly manifestDigest: string;
  readonly configDigest: string;
  readonly entrypoint: readonly string[];
}

export class ReferenceBotArchiveError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'ReferenceBotArchiveError';
    this.code = code;
  }
}

export function validateReferenceBotArchive(
  archive: Uint8Array,
  expectedSha256?: string,
): ValidatedReferenceBotArchive {
  if (archive.byteLength === 0) throw new ReferenceBotArchiveError('ARCHIVE_EMPTY');
  if (archive.byteLength > REFERENCE_BOT_ARCHIVE_LIMITS.maxArchiveBytes) {
    throw new ReferenceBotArchiveError('ARCHIVE_TOO_LARGE');
  }

  const hex = createHash('sha256').update(archive).digest('hex');
  if (expectedSha256 !== undefined && hex !== expectedSha256.replace(/^sha256:/, '')) {
    throw new ReferenceBotArchiveError('ARCHIVE_SHA256_MISMATCH');
  }

  const checked = validateOciSubmission(archive, REFERENCE_BOT_ARCHIVE_LIMITS);
  if (!checked.ok) throw new ReferenceBotArchiveError(checked.code);

  return {
    archiveSha256: `sha256:${hex}`,
    objectKey: `reference-bots/${hex}.oci.tar`,
    manifestDigest: checked.value.ociManifestDigest,
    configDigest: checked.value.ociConfigDigest,
    entrypoint: checked.value.entrypoint,
  };
}

export function isMissingReferenceBotObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { readonly name?: unknown; readonly code?: unknown; readonly $metadata?: { readonly httpStatusCode?: unknown } };
  return candidate.name === 'NoSuchKey'
    || candidate.name === 'NotFound'
    || candidate.code === 'NoSuchKey'
    || candidate.code === 'NotFound'
    || (error instanceof Error && /^(NoSuchKey|NotFound)$/.test(error.message))
    || candidate.$metadata?.httpStatusCode === 404;
}
