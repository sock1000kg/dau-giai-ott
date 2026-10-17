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

export interface OfficialBaseImage {
  readonly id: string;
  readonly name: string;
  readonly tag: string;
  readonly manifestDigest: string;
  readonly layerDigests: readonly string[];
}

export const OFFICIAL_BASE_IMAGES: readonly OfficialBaseImage[] = [
  {
    id: 'python-3.12-slim',
    name: 'python',
    tag: '3.12-slim',
    manifestDigest: 'sha256:d17ec283626e959ecbf8e1b6f0e9b9cf98544d642da652a9709f18b3cb3efd4c',
    layerDigests: [
      'sha256:4f4fb700ef54461cfa02571ae0db9a0dc1e0cdb55774843d523e3b86325dbb90',
      'sha256:02c1554c30c5e7b34d708f3f87e5ee5ebc9823330fc3b8a13a0fc3efb075e81f',
      'sha256:3266ca11136b85675eecbc1829283ae09b9f395b058f4c2c1593c66f97d5d787',
      'sha256:9276d49cd4b523f03b6e8f00030560a631f49635bf7c834f828a559868725fa8',
    ],
  },
  {
    id: 'node-22-slim',
    name: 'node',
    tag: '22-bookworm-slim',
    manifestDigest: 'sha256:6909477e3c1532f6b864d293f0b2f654b9d07f311333e21074e2d3dcf3a89073',
    layerDigests: [
      'sha256:4f4fb700ef54461cfa02571ae0db9a0dc1e0cdb55774843d523e3b86325dbb90',
      'sha256:a3ed95caeb02ffe68cdd9fd84406680ae93d633cb16422d00e8a7c22955b46d4',
      'sha256:49c0c80d4653609825b29dbf0a71be7ad7d49b29cfbe3a7bcf188981df98ef9e',
    ],
  },
  {
    id: 'golang-1.22-alpine',
    name: 'golang',
    tag: '1.22-alpine',
    manifestDigest: 'sha256:1a84b3967468fb7920ab7cbdd129ba0e30095908ef136fbccb780ea3b53f31cf',
    layerDigests: [
      'sha256:ec99f8b99825a742d50fb3ce1112224e61de0d9e4243300b3497d68f4acf9a6f',
      'sha256:3b83c74384ab1b54a20b7f61c3905e4fb7f0be36c646fa01c349a239d226a35f',
      'sha256:5664b15f108bf943ff3333ec509b92261002a40d37f6e69e7377eab560492994',
    ],
  },
] as const;

export const OFFICIAL_BASE_LAYER_DIGESTS: ReadonlySet<string> = new Set(
  OFFICIAL_BASE_IMAGES.flatMap((img) => img.layerDigests),
);

export function isOfficialBaseLayer(digest: string): boolean {
  return OFFICIAL_BASE_LAYER_DIGESTS.has(digest);
}

export interface OciLayerDescriptor {
  readonly mediaType: string;
  readonly digest: string;
  readonly size: number;
}

export interface ExtractedOciLayers {
  readonly manifestDigest: string;
  readonly configDigest: string;
  readonly layers: readonly OciLayerDescriptor[];
  readonly baseLayerDigests: readonly string[];
  readonly nonBaseLayerDigests: readonly string[];
}

function parseTarSimple(archive: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0.*$/, '').trim();
    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '').trim();
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;

    const rawSize = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim();
    const size = Number.parseInt(rawSize, 8) || 0;
    const bodyOffset = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;

    if (path.length > 0 && size > 0 && bodyOffset + size <= archive.byteLength) {
      entries.set(path, archive.subarray(bodyOffset, bodyOffset + size));
    }
    offset = bodyOffset + paddedSize;
  }
  return entries;
}

export function extractOciLayersFromArchive(
  archive: Uint8Array,
  knownBaseLayers: ReadonlySet<string> = OFFICIAL_BASE_LAYER_DIGESTS,
): ExtractedOciLayers {
  const entries = parseTarSimple(archive);
  const decoder = new TextDecoder();

  const indexEntry = entries.get('index.json');
  if (!indexEntry) {
    throw new ArtifactValidationError('ARTIFACT_INVALID');
  }

  let manifestDigest = '';
  try {
    const index = JSON.parse(decoder.decode(indexEntry));
    const manifestDesc = index.manifests?.[0];
    if (!manifestDesc || typeof manifestDesc.digest !== 'string') {
      throw new ArtifactValidationError('ARTIFACT_INVALID');
    }
    manifestDigest = manifestDesc.digest;
  } catch {
    throw new ArtifactValidationError('ARTIFACT_INVALID');
  }

  const manifestPath = `blobs/sha256/${manifestDigest.replace(/^sha256:/, '')}`;
  const manifestBytes = entries.get(manifestPath);
  if (!manifestBytes) {
    throw new ArtifactValidationError('ARTIFACT_INVALID');
  }

  try {
    const manifest = JSON.parse(decoder.decode(manifestBytes));
    const configDigest = String(manifest.config?.digest ?? '');
    const layers: OciLayerDescriptor[] = [];
    const baseLayerDigests: string[] = [];
    const nonBaseLayerDigests: string[] = [];

    if (Array.isArray(manifest.layers)) {
      for (const l of manifest.layers) {
        if (typeof l.digest === 'string' && typeof l.mediaType === 'string' && typeof l.size === 'number') {
          const descriptor: OciLayerDescriptor = {
            mediaType: l.mediaType,
            digest: l.digest,
            size: l.size,
          };
          layers.push(descriptor);
          if (knownBaseLayers.has(l.digest)) {
            baseLayerDigests.push(l.digest);
          } else {
            nonBaseLayerDigests.push(l.digest);
          }
        }
      }
    }

    return {
      manifestDigest,
      configDigest,
      layers,
      baseLayerDigests,
      nonBaseLayerDigests,
    };
  } catch {
    throw new ArtifactValidationError('ARTIFACT_INVALID');
  }
}

