import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { validateOciSubmission } from '../src/oci-submission.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type TarEntry = { readonly name: string; readonly body: Uint8Array; readonly type?: string };

function digest(body: Uint8Array): string {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

function bytes(...parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function writeText(target: Uint8Array, offset: number, width: number, value: string): void {
  target.set(encoder.encode(value).slice(0, width), offset);
}

function writeOctal(target: Uint8Array, offset: number, width: number, value: number): void {
  writeText(target, offset, width, value.toString(8).padStart(width - 1, '0'));
  target[offset + width - 1] = 0;
}

function tar(entries: readonly TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const header = new Uint8Array(512);
    writeText(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, entry.body.byteLength);
    writeOctal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header[156] = (entry.type ?? '0').charCodeAt(0);
    writeText(header, 257, 6, 'ustar');
    writeText(header, 263, 2, '00');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
    blocks.push(header, entry.body, new Uint8Array((512 - (entry.body.byteLength % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return bytes(...blocks);
}

async function validArchive(options: {
  readonly entrypoint?: readonly string[];
  readonly indexManifests?: number;
  readonly foreignLayer?: boolean;
  readonly extra?: TarEntry;
} = {}): Promise<Uint8Array> {
  const bot = new Uint8Array(await readFile('../../bots/python/first_legal_bot.py'));
  const layer = tar([{ name: 'app/bot.py', body: bot }]);
  const config = encoder.encode(JSON.stringify({ architecture: 'amd64', os: 'linux', config: { Entrypoint: options.entrypoint ?? ['python3', '/app/bot.py'] } }));
  const manifest = encoder.encode(JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: digest(config), size: config.byteLength },
    layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: digest(layer), size: layer.byteLength, ...(options.foreignLayer ? { urls: ['https://example.invalid/layer'] } : {}) }],
  }));
  const descriptor = { mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: digest(manifest), size: manifest.byteLength, platform: { os: 'linux', architecture: 'amd64' } };
  const index = encoder.encode(JSON.stringify({ schemaVersion: 2, manifests: Array.from({ length: options.indexManifests ?? 1 }, () => descriptor) }));
  return tar([
    { name: 'oci-layout', body: encoder.encode('{"imageLayoutVersion":"1.0.0"}') },
    { name: 'index.json', body: index },
    { name: `blobs/sha256/${digest(manifest).slice(7)}`, body: manifest },
    { name: `blobs/sha256/${digest(config).slice(7)}`, body: config },
    { name: `blobs/sha256/${digest(layer).slice(7)}`, body: layer },
    ...(options.extra ? [options.extra] : []),
  ]);
}

describe('validateOciSubmission', () => {
  it('derives immutable OCI identity from an archive using the existing Python bot fixture', async () => {
    const archive = await validArchive();

    const result = validateOciSubmission(archive, { maxArchiveBytes: 4_000_000, maxUncompressedBytes: 4_000_000 });

    expect(result).toMatchObject({ ok: true, value: { platform: 'linux/amd64', entrypoint: ['python3', '/app/bot.py'], archiveSha256: expect.stringMatching(/^sha256:/), ociManifestDigest: expect.stringMatching(/^sha256:/), ociConfigDigest: expect.stringMatching(/^sha256:/) } });
  });

  it('rejects traversal, multi-platform layouts, foreign layers and a blank entrypoint with stable codes', async () => {
    const traversal = await validArchive({ extra: { name: '../escape', body: encoder.encode('x') } });
    const multiPlatform = await validArchive({ indexManifests: 2 });
    const foreignLayer = await validArchive({ foreignLayer: true });
    const blankEntrypoint = await validArchive({ entrypoint: [''] });
    const limits = { maxArchiveBytes: 4_000_000, maxUncompressedBytes: 4_000_000 };

    expect(validateOciSubmission(traversal, limits)).toMatchObject({ ok: false, code: 'ARCHIVE_PATH_INVALID' });
    expect(validateOciSubmission(multiPlatform, limits)).toMatchObject({ ok: false, code: 'OCI_MULTI_PLATFORM' });
    expect(validateOciSubmission(foreignLayer, limits)).toMatchObject({ ok: false, code: 'OCI_FOREIGN_LAYER' });
    expect(validateOciSubmission(blankEntrypoint, limits)).toMatchObject({ ok: false, code: 'OCI_ENTRYPOINT_MISSING' });
  });

  it('rejects archives over the configured size before parsing', async () => {
    const archive = await validArchive();

    expect(validateOciSubmission(archive, { maxArchiveBytes: archive.byteLength - 1, maxUncompressedBytes: 4_000_000 })).toMatchObject({ ok: false, code: 'ARCHIVE_TOO_LARGE' });
  });

  it('rejects link and duplicate tar entries before interpreting OCI metadata', () => {
    const symlink = tar([{ name: 'bot-link', body: new Uint8Array(), type: '2' }]);
    const duplicate = tar([{ name: 'same-path', body: new Uint8Array() }, { name: 'same-path', body: new Uint8Array() }]);
    const limits = { maxArchiveBytes: 4_000_000, maxUncompressedBytes: 4_000_000 };

    expect(validateOciSubmission(symlink, limits)).toMatchObject({ ok: false, code: 'ARCHIVE_ENTRY_UNSUPPORTED' });
    expect(validateOciSubmission(duplicate, limits)).toMatchObject({ ok: false, code: 'ARCHIVE_DUPLICATE_PATH' });
  });
});
