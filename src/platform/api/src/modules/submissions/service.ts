import { createHash } from 'node:crypto';

import type { Database } from '../../db/client.ts';
import type { ObjectStorage } from '../../storage/s3.ts';

type StoredSubmission = Readonly<{ object_key: string; archive_sha256: string }>;

/** Trusted worker-only download boundary: DB key is server-generated and bytes are rechecked. */
export async function readSubmissionArchive(database: Database, storage: ObjectStorage, submissionId: string): Promise<Uint8Array> {
  const result = await database.query<StoredSubmission>('SELECT object_key, archive_sha256 FROM submissions WHERE id = $1', [submissionId]);
  const submission = result.rows[0];
  if (submission === undefined) throw new Error('SUBMISSION_NOT_FOUND');
  const archive = await storage.get(submission.object_key);
  const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
  if (digest !== submission.archive_sha256) throw new Error('SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH');
  return archive;
}
