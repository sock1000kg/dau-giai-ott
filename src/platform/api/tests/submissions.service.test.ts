import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readSubmissionArchive, type Database, type ObjectStorage } from '../src/index.ts';

const archive = new TextEncoder().encode('trusted OCI archive');
const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`;

function database(row: unknown): Database {
  return { query: async () => ({ rows: row === undefined ? [] : [row] }) as never, transaction: async () => { throw new Error('not used'); }, close: async () => undefined };
}

function storage(value: Uint8Array): ObjectStorage {
  return { get: async () => value, put: async () => undefined, copy: async () => undefined, remove: async () => undefined };
}

describe('P2-T07 trusted submission download', () => {
  it('returns bytes only when the immutable database digest matches', async () => {
    await expect(readSubmissionArchive(database({ object_key: 'submissions/a.oci.tar', archive_sha256: digest }), storage(archive), 'submission-id')).resolves.toEqual(archive);
  });

  it('rejects a missing submission and any storage mutation', async () => {
    await expect(readSubmissionArchive(database(undefined), storage(archive), 'missing')).rejects.toThrow('SUBMISSION_NOT_FOUND');
    await expect(readSubmissionArchive(database({ object_key: 'submissions/a.oci.tar', archive_sha256: `sha256:${'0'.repeat(64)}` }), storage(archive), 'submission-id')).rejects.toThrow('SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH');
  });
});
