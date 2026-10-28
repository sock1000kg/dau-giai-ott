import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { S3Client } from '@aws-sdk/client-s3';
import { createDatabase, type Database } from '../db/client.ts';
import { createS3Storage, type ObjectStorage } from '../storage/s3.ts';
import {
  isMissingReferenceBotObject,
  REFERENCE_BOT_ARCHIVE_LIMITS,
  REFERENCE_BOT_POLICY_VERSION,
  ReferenceBotArchiveError,
  validateReferenceBotArchive,
} from '../modules/reference-bots/archive.ts';
import { assertDemoEnvironment } from './seed-accounts.ts';

export const PINNED_REFERENCE_BOT_SHA256 =
  '80d1dd7d9fb46f3c2a4779f0a62cc7ee0d6a3ce4b741df026adbb7bf6109b4e6';
export const DEFAULT_REFERENCE_BOT_ID = 'btc-baseline';
export const DEFAULT_REFERENCE_BOT_DISPLAY_NAME = 'BTC baseline';
export const DEFAULT_REFERENCE_BOT_POLICY_VERSION = REFERENCE_BOT_POLICY_VERSION;
export const DEFAULT_REFERENCE_BOT_CONTAINER_PATH = '/seed/ott-demo-bot-go-v1.oci.tar';

export const OCI_SUBMISSION_LIMITS = REFERENCE_BOT_ARCHIVE_LIMITS;

export interface SeedDemoReferenceBotOptions {
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly archive?: Uint8Array;
  readonly filePath?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly expectedSha256?: string;
}

export interface SeedDemoReferenceBotResult {
  readonly id: string;
  readonly displayName: string;
  readonly objectKey: string;
  readonly archiveSha256: string;
  readonly manifestDigest: string;
  readonly configDigest: string;
  readonly uploaded: boolean;
}

export function findDefaultReferenceBotFile(): string {
  if (fs.existsSync(DEFAULT_REFERENCE_BOT_CONTAINER_PATH)) {
    return DEFAULT_REFERENCE_BOT_CONTAINER_PATH;
  }
  const localRepoPath = path.resolve(
    process.cwd(),
    'src/platform/web/public/downloads/ott-demo-bot-go-v1.oci.tar',
  );
  if (fs.existsSync(localRepoPath)) {
    return localRepoPath;
  }
  const relativeFromSource = path.resolve(
    fileURLToPath(import.meta.url),
    '../../../../web/public/downloads/ott-demo-bot-go-v1.oci.tar',
  );
  if (fs.existsSync(relativeFromSource)) {
    return relativeFromSource;
  }
  return DEFAULT_REFERENCE_BOT_CONTAINER_PATH;
}

export async function seedDemoReferenceBot(
  options: SeedDemoReferenceBotOptions,
): Promise<SeedDemoReferenceBotResult> {
  const env = options.environment ?? process.env;
  assertDemoEnvironment(env);

  let archive = options.archive;
  if (!archive) {
    const candidatePath =
      options.filePath ?? env.OTT_REFERENCE_BOT_FILE ?? findDefaultReferenceBotFile();
    const resolvedPath = path.resolve(candidatePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Reference bot archive file not found: ${resolvedPath}`);
    }
    archive = await fs.promises.readFile(resolvedPath);
  }

  const expectedSha256 = options.expectedSha256 ?? PINNED_REFERENCE_BOT_SHA256;
  let validated;
  try {
    validated = validateReferenceBotArchive(archive, expectedSha256);
  } catch (error) {
    if (error instanceof ReferenceBotArchiveError && error.code === 'ARCHIVE_SHA256_MISMATCH') {
      throw new Error(`Reference bot archive checksum mismatch: expected ${expectedSha256}`);
    }
    throw new Error(
      `Reference bot OCI archive invalid: ${error instanceof ReferenceBotArchiveError ? error.code : 'UNKNOWN'}`,
    );
  }

  const id = DEFAULT_REFERENCE_BOT_ID;
  const displayName = DEFAULT_REFERENCE_BOT_DISPLAY_NAME;
  const objectKey = validated.objectKey;
  const archiveSha256 = validated.archiveSha256;
  const manifestDigest = validated.manifestDigest;
  const configDigest = validated.configDigest;
  const entrypoint = JSON.stringify(validated.entrypoint);
  const policyVersion = DEFAULT_REFERENCE_BOT_POLICY_VERSION;

  let objectExists = false;
  try {
    const stored = await options.storage.get(objectKey);
    if (`sha256:${createHash('sha256').update(stored).digest('hex')}` !== archiveSha256) {
      throw new Error('Reference bot content-addressed object checksum mismatch');
    }
    objectExists = true;
  } catch (error) {
    if (!isMissingReferenceBotObject(error)) throw error;
    objectExists = false;
  }

  if (!objectExists) {
    await options.storage.put(objectKey, archive);
  }

  await options.database.query(
    `INSERT INTO test_run_reference_bots (
       id, display_name, object_key, archive_sha256, manifest_digest,
       config_digest, entrypoint, policy_version, enabled, enabled_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, TRUE, now())
     ON CONFLICT (id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       object_key = EXCLUDED.object_key,
       archive_sha256 = EXCLUDED.archive_sha256,
       manifest_digest = EXCLUDED.manifest_digest,
       config_digest = EXCLUDED.config_digest,
       entrypoint = EXCLUDED.entrypoint,
       policy_version = EXCLUDED.policy_version`,
    [
      id,
      displayName,
      objectKey,
      archiveSha256,
      manifestDigest,
      configDigest,
      entrypoint,
      policyVersion,
    ],
  );

  return {
    id,
    displayName,
    objectKey,
    archiveSha256,
    manifestDigest,
    configDigest,
    uploaded: !objectExists,
  };
}

export async function runCli(): Promise<void> {
  const env = process.env;
  assertDemoEnvironment(env);

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed reference bot');
  }

  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error('S3 configuration is required to seed the BTC reference bot');
  }

  const database = createDatabase({ connectionString: databaseUrl });
  const s3Client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  });
  const storage = createS3Storage({ client: s3Client, bucket: S3_BUCKET });

  try {
    const result = await seedDemoReferenceBot({ database, storage, environment: env });
    process.stdout.write(
      `Seeded BTC reference bot ${result.id} (${result.archiveSha256}) [uploaded=${result.uploaded}]\n`,
    );
  } finally {
    s3Client.destroy();
    await database.close();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    process.argv[1] === fileURLToPath(import.meta.url));

if (isMain) {
  runCli().catch((err: unknown) => {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
