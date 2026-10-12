import { randomUUID } from 'node:crypto';

import { S3Client } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';

import { createS3Storage } from '../src/index.ts';

const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const integration = endpoint && bucket && accessKeyId && secretAccessKey ? describe : describe.skip;

integration('P2-T07 SeaweedFS S3 storage', () => {
  const client = new S3Client({ endpoint: endpoint!, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false', credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } });
  const storage = createS3Storage({ client, bucket: bucket! });
  const suffix = randomUUID();
  const source = `tests/${suffix}/source`;
  const copied = `tests/${suffix}/copy`;

  afterAll(async () => { await storage.remove(source).catch(() => undefined); await storage.remove(copied).catch(() => undefined); client.destroy(); });

  it('writes, reads, promotes and deletes private binary objects', async () => {
    const value = new Uint8Array([0, 1, 2, 255]);
    await storage.put(source, value);
    await expect(storage.get(source)).resolves.toEqual(value);
    await storage.copy(source, copied);
    await expect(storage.get(copied)).resolves.toEqual(value);
    await storage.remove(source);
  });
});
