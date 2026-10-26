import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const action = process.argv[2];
const root = process.argv[3];
if (!['export', 'import'].includes(action ?? '') || !root) {
  process.stderr.write('demo-snapshot-objects: expected export|import and a directory\n');
  process.exit(2);
}

const bucket = process.env.S3_BUCKET;
if (!bucket || !process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
  process.stderr.write('demo-snapshot-objects: S3 configuration is incomplete\n');
  process.exit(1);
}

const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fileForKey = (key) => `${createHash('sha256').update(key).digest('hex')}.blob`;

function validateKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.startsWith('/') || key.includes('\\')
    || key.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error('invalid object key');
  }
}

async function databaseReferences() {
  if (!process.env.DATABASE_URL) throw new Error('database configuration is incomplete');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const result = await db.query(
      `SELECT event_log_key AS key, event_log_sha256 AS digest FROM replay_publications
       UNION ALL SELECT object_key AS key, archive_sha256 AS digest FROM submissions
       UNION ALL SELECT storage_key AS key, digest FROM oci_layers`,
    );
    return result.rows;
  } finally {
    await db.end();
  }
}

async function listBucketObjects() {
  const entries = [];
  let continuationToken;
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    for (const object of page.Contents ?? []) {
      if (object.Key === undefined) throw new Error('bucket returned an object without a key');
      validateKey(object.Key);
      entries.push({ key: object.Key, file: fileForKey(object.Key) });
    }
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return entries;
}

async function verifyReferences(entries, rootDirectory) {
  const objects = new Map(entries.map((entry) => [entry.key, entry]));
  const references = await databaseReferences();
  for (const reference of references) {
    validateKey(reference.key);
    const entry = objects.get(reference.key);
    if (entry === undefined) throw new Error('database references a missing storage object');
    const bytes = await readFile(path.join(rootDirectory, 'objects', entry.file));
    if (digest(bytes) !== reference.digest) throw new Error('database object digest does not match storage bytes');
  }
  return references.length;
}

async function exportObjects() {
  await mkdir(path.join(root, 'objects'), { recursive: true, mode: 0o700 });
  const entries = await listBucketObjects();
  for (const entry of entries) {
    const response = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: entry.key }));
    if (response.Body === undefined) throw new Error('object body is missing');
    const bytes = Buffer.from(await response.Body.transformToByteArray());
    await writeFile(path.join(root, 'objects', entry.file), bytes, { mode: 0o600, flag: 'wx' });
    entry.size = bytes.byteLength;
    entry.sha256 = digest(bytes);
  }
  const referenceCount = await verifyReferences(entries, root);
  const manifest = { format: 'ott-demo-s3-objects-v1', sourceBucket: bucket, objectCount: entries.length, referenceCount, objects: entries };
  await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(JSON.stringify({ objectCount: entries.length, referenceCount }));
}

async function importObjects() {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  // Buckets are deployment configuration. Preserve the source bucket as
  // provenance, but import object keys into the target stack's configured bucket.
  if (manifest.format !== 'ott-demo-s3-objects-v1'
    || typeof (manifest.sourceBucket ?? manifest.bucket) !== 'string'
    || !Array.isArray(manifest.objects)) {
    throw new Error('object archive manifest is invalid');
  }
  if (manifest.objectCount !== manifest.objects.length) throw new Error('object archive count is invalid');
  const seen = new Set();
  for (const entry of manifest.objects) {
    validateKey(entry.key);
    if (entry.file !== fileForKey(entry.key) || seen.has(entry.key)) throw new Error('object archive entry is invalid');
    seen.add(entry.key);
    const source = path.join(root, 'objects', entry.file);
    const info = await stat(source);
    if (!info.isFile() || info.size !== entry.size) throw new Error('object archive payload size is invalid');
    const bytes = await readFile(source);
    if (digest(bytes) !== entry.sha256) throw new Error('object archive payload checksum is invalid');
    await storage.send(new PutObjectCommand({ Bucket: bucket, Key: entry.key, Body: bytes }));
    const restored = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: entry.key }));
    if (restored.Body === undefined || digest(await restored.Body.transformToByteArray()) !== entry.sha256) {
      throw new Error('restored object checksum verification failed');
    }
  }
  const referenceCount = await verifyReferences(manifest.objects, root);
  if (manifest.referenceCount !== referenceCount) throw new Error('object archive reference count is invalid');
  process.stdout.write(JSON.stringify({ objectCount: manifest.objects.length, referenceCount }));
}

try {
  await (action === 'export' ? exportObjects() : importObjects());
} catch {
  process.stderr.write('demo-snapshot-objects: object export/import integrity check failed\n');
  process.exitCode = 1;
} finally {
  storage.destroy();
}
