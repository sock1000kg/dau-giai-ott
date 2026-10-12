import { createHash } from 'node:crypto';

/** Stable, team-actionable failures emitted before any OCI archive is imported or executed. */
export type OciSubmissionErrorCode =
  | 'ARCHIVE_TOO_LARGE'
  | 'ARCHIVE_UNCOMPRESSED_TOO_LARGE'
  | 'ARCHIVE_TAR_INVALID'
  | 'ARCHIVE_PATH_INVALID'
  | 'ARCHIVE_ENTRY_UNSUPPORTED'
  | 'ARCHIVE_DUPLICATE_PATH'
  | 'OCI_LAYOUT_INVALID'
  | 'OCI_INDEX_INVALID'
  | 'OCI_MULTI_PLATFORM'
  | 'OCI_PLATFORM_UNSUPPORTED'
  | 'OCI_BLOB_MISSING'
  | 'OCI_DIGEST_MISMATCH'
  | 'OCI_MANIFEST_INVALID'
  | 'OCI_FOREIGN_LAYER'
  | 'OCI_CONFIG_INVALID'
  | 'OCI_ENTRYPOINT_MISSING';

export interface OciSubmissionLimits {
  readonly maxArchiveBytes: number;
  readonly maxUncompressedBytes: number;
}

export interface OciSubmissionIdentity {
  readonly artifactKind: 'OCI_IMAGE_LAYOUT_V1';
  readonly archiveSha256: string;
  readonly archiveBytes: number;
  readonly uncompressedBytes: number;
  readonly ociManifestDigest: string;
  readonly ociConfigDigest: string;
  readonly platform: 'linux/amd64';
  readonly entrypoint: readonly string[];
}

export type OciSubmissionValidation =
  | { readonly ok: true; readonly value: OciSubmissionIdentity }
  | { readonly ok: false; readonly code: OciSubmissionErrorCode };

type JsonRecord = Record<string, unknown>;
type TarEntry = { readonly path: string; readonly body: Uint8Array };
type Descriptor = { readonly mediaType: string; readonly digest: string; readonly size: number; readonly urls?: unknown };

const decoder = new TextDecoder();
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json';
const OCI_CONFIG = 'application/vnd.oci.image.config.v1+json';
const OCI_LAYER_PREFIX = 'application/vnd.oci.image.layer.v1.';

class ValidationFailure extends Error {
  public readonly code: OciSubmissionErrorCode;

  public constructor(code: OciSubmissionErrorCode) {
    super(code);
    this.code = code;
  }
}

function fail(code: OciSubmissionErrorCode): never {
  throw new ValidationFailure(code);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readText(value: Uint8Array, offset: number, width: number): string {
  const field = value.subarray(offset, offset + width);
  const terminator = field.indexOf(0);
  return decoder.decode(terminator === -1 ? field : field.subarray(0, terminator));
}

function readOctal(value: Uint8Array, offset: number, width: number): number {
  const raw = decoder.decode(value.subarray(offset, offset + width)).replace(/\0/g, '').trim();
  if (!/^[0-7]+$/.test(raw)) {
    fail('ARCHIVE_TAR_INVALID');
  }
  const parsed = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail('ARCHIVE_TAR_INVALID');
  }
  return parsed;
}

function isEmptyBlock(value: Uint8Array): boolean {
  return value.every((byte) => byte === 0);
}

function isSafePath(path: string): boolean {
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function validateChecksum(header: Uint8Array): void {
  const declared = readOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]!;
  }
  if (actual !== declared) {
    fail('ARCHIVE_TAR_INVALID');
  }
}

function parseTar(archive: Uint8Array, maxUncompressedBytes: number): Map<string, TarEntry> {
  const entries = new Map<string, TarEntry>();
  const paths = new Set<string>();
  let offset = 0;
  let uncompressedBytes = 0;

  while (offset < archive.byteLength) {
    if (offset + 512 > archive.byteLength) {
      fail('ARCHIVE_TAR_INVALID');
    }
    const header = archive.subarray(offset, offset + 512);
    if (isEmptyBlock(header)) {
      if (archive.subarray(offset).every((byte) => byte === 0)) {
        return entries;
      }
      fail('ARCHIVE_TAR_INVALID');
    }
    validateChecksum(header);
    const prefix = readText(header, 345, 155);
    const name = readText(header, 0, 100);
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    const type = String.fromCharCode(header[156] ?? 0);
    const size = readOctal(header, 124, 12);
    const bodyOffset = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;
    if (!isSafePath(path)) {
      fail('ARCHIVE_PATH_INVALID');
    }
    if (type !== '\0' && type !== '0' && type !== '5') {
      fail('ARCHIVE_ENTRY_UNSUPPORTED');
    }
    if (type === '5' && size !== 0) {
      fail('ARCHIVE_TAR_INVALID');
    }
    if (bodyOffset + paddedSize > archive.byteLength) {
      fail('ARCHIVE_TAR_INVALID');
    }
    if (paths.has(path)) {
      fail('ARCHIVE_DUPLICATE_PATH');
    }
    paths.add(path);
    uncompressedBytes += size;
    if (uncompressedBytes > maxUncompressedBytes) {
      fail('ARCHIVE_UNCOMPRESSED_TOO_LARGE');
    }
    if (type !== '5') {
      entries.set(path, { path, body: archive.subarray(bodyOffset, bodyOffset + size) });
    }
    offset = bodyOffset + paddedSize;
  }
  fail('ARCHIVE_TAR_INVALID');
}

function parseJson(entry: TarEntry, code: OciSubmissionErrorCode): JsonRecord {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(entry.body));
    if (!isRecord(parsed)) {
      fail(code);
    }
    return parsed;
  } catch (error) {
    if (error instanceof ValidationFailure) {
      throw error;
    }
    fail(code);
  }
}

function descriptor(value: unknown, code: OciSubmissionErrorCode): Descriptor {
  if (!isRecord(value) || typeof value.mediaType !== 'string' || typeof value.digest !== 'string' || typeof value.size !== 'number') {
    fail(code);
  }
  if (!SHA256.test(value.digest) || !Number.isSafeInteger(value.size) || value.size < 0) {
    fail(code);
  }
  return { mediaType: value.mediaType, digest: value.digest, size: value.size, ...(Object.hasOwn(value, 'urls') ? { urls: value.urls } : {}) };
}

function blob(entries: Map<string, TarEntry>, source: Descriptor, code: OciSubmissionErrorCode): TarEntry {
  const value = entries.get(`blobs/sha256/${source.digest.slice('sha256:'.length)}`);
  if (!value) {
    fail('OCI_BLOB_MISSING');
  }
  if (value.body.byteLength !== source.size || sha256(value.body) !== source.digest) {
    fail('OCI_DIGEST_MISMATCH');
  }
  if (source.mediaType.length === 0) {
    fail(code);
  }
  return value;
}

function platform(value: unknown): 'linux/amd64' {
  if (!isRecord(value) || value.os !== 'linux' || value.architecture !== 'amd64') {
    fail('OCI_PLATFORM_UNSUPPORTED');
  }
  return 'linux/amd64';
}

function entrypoint(config: JsonRecord): readonly string[] {
  const configValue = config.config;
  if (!isRecord(configValue) || !Array.isArray(configValue.Entrypoint) || configValue.Entrypoint.length === 0 || !configValue.Entrypoint.every((part) => typeof part === 'string' && part.trim().length > 0)) {
    fail('OCI_ENTRYPOINT_MISSING');
  }
  return [...configValue.Entrypoint] as string[];
}

/**
 * Defensively validates an uncompressed OCI Image Layout archive without extracting,
 * importing or executing it. P2-T07 is responsible for streaming/quarantine storage;
 * this pure validator makes structural admission deterministic and daemon-independent.
 */
export function validateOciSubmission(archive: Uint8Array, limits: OciSubmissionLimits): OciSubmissionValidation {
  try {
    if (!Number.isSafeInteger(limits.maxArchiveBytes) || !Number.isSafeInteger(limits.maxUncompressedBytes) || limits.maxArchiveBytes <= 0 || limits.maxUncompressedBytes <= 0) {
      fail('ARCHIVE_TAR_INVALID');
    }
    if (archive.byteLength > limits.maxArchiveBytes) {
      fail('ARCHIVE_TOO_LARGE');
    }
    const entries = parseTar(archive, limits.maxUncompressedBytes);
    const layout = entries.get('oci-layout');
    const indexEntry = entries.get('index.json');
    if (!layout || !indexEntry) {
      fail('OCI_LAYOUT_INVALID');
    }
    const layoutJson = parseJson(layout, 'OCI_LAYOUT_INVALID');
    if (layoutJson.imageLayoutVersion !== '1.0.0') {
      fail('OCI_LAYOUT_INVALID');
    }
    const index = parseJson(indexEntry, 'OCI_INDEX_INVALID');
    if (index.schemaVersion !== 2 || !Array.isArray(index.manifests) || index.manifests.length !== 1) {
      fail('OCI_MULTI_PLATFORM');
    }
    const manifestDescriptor = descriptor(index.manifests[0], 'OCI_INDEX_INVALID');
    if (manifestDescriptor.mediaType !== OCI_MANIFEST) {
      fail('OCI_MANIFEST_INVALID');
    }
    const resolvedPlatform = platform(isRecord(index.manifests[0]) ? index.manifests[0].platform : undefined);
    const manifest = parseJson(blob(entries, manifestDescriptor, 'OCI_MANIFEST_INVALID'), 'OCI_MANIFEST_INVALID');
    if (manifest.schemaVersion !== 2 || manifest.mediaType !== OCI_MANIFEST || !Array.isArray(manifest.layers)) {
      fail('OCI_MANIFEST_INVALID');
    }
    const configDescriptor = descriptor(manifest.config, 'OCI_CONFIG_INVALID');
    if (configDescriptor.mediaType !== OCI_CONFIG) {
      fail('OCI_CONFIG_INVALID');
    }
    for (const layerValue of manifest.layers) {
      const layer = descriptor(layerValue, 'OCI_MANIFEST_INVALID');
      if (layer.urls !== undefined || !layer.mediaType.startsWith(OCI_LAYER_PREFIX)) {
        fail('OCI_FOREIGN_LAYER');
      }
      blob(entries, layer, 'OCI_MANIFEST_INVALID');
    }
    const config = parseJson(blob(entries, configDescriptor, 'OCI_CONFIG_INVALID'), 'OCI_CONFIG_INVALID');
    if (config.architecture !== 'amd64' || config.os !== 'linux') {
      fail('OCI_PLATFORM_UNSUPPORTED');
    }
    const resolvedEntrypoint = entrypoint(config);
    const uncompressedBytes = [...entries.values()].reduce((total, item) => total + item.body.byteLength, 0);
    return {
      ok: true,
      value: {
        artifactKind: 'OCI_IMAGE_LAYOUT_V1',
        archiveSha256: sha256(archive),
        archiveBytes: archive.byteLength,
        uncompressedBytes,
        ociManifestDigest: manifestDescriptor.digest,
        ociConfigDigest: configDescriptor.digest,
        platform: resolvedPlatform,
        entrypoint: resolvedEntrypoint,
      },
    };
  } catch (error) {
    if (error instanceof ValidationFailure) {
      return { ok: false, code: error.code };
    }
    return { ok: false, code: 'ARCHIVE_TAR_INVALID' };
  }
}
