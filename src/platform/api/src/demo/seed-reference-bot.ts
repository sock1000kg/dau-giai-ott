import { createHash } from 'node:crypto';
import type { Database } from '../db/client.ts';
import type { ObjectStorage } from '../storage/s3.ts';

const digestPattern = /^sha256:[0-9a-f]{64}$/;

export async function seedDemoReferenceBot(options: {
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly archive: Uint8Array;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): Promise<{ readonly id: string; readonly objectKey: string; readonly checksum: string }> {
  const env = options.environment;
  if (env.OTT_DEMO_MODE !== 'true' || !['dev', 'test'].includes(env.OTT_DEPLOYMENT_MODE ?? '')) {
    throw new Error('Reference bot seeder requires OTT_DEMO_MODE=true and OTT_DEPLOYMENT_MODE=dev|test');
  }
  const id = env.OTT_DEMO_REFERENCE_BOT_ID ?? 'btc-reference-demo-v1';
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)) throw new Error('OTT_DEMO_REFERENCE_BOT_ID has an invalid format');
  if (options.archive.byteLength === 0) throw new Error('Configured reference bot archive is empty');
  const checksum = `sha256:${createHash('sha256').update(options.archive).digest('hex')}`;
  const expectedChecksum = env.OTT_DEMO_REFERENCE_BOT_SHA256;
  if (!expectedChecksum || !digestPattern.test(expectedChecksum) || checksum !== expectedChecksum) {
    throw new Error('Configured reference bot archive checksum does not match OTT_DEMO_REFERENCE_BOT_SHA256');
  }
  const manifestDigest = env.OTT_DEMO_REFERENCE_BOT_MANIFEST_DIGEST;
  const configDigest = env.OTT_DEMO_REFERENCE_BOT_CONFIG_DIGEST;
  if (!manifestDigest || !digestPattern.test(manifestDigest) || !configDigest || !digestPattern.test(configDigest)) {
    throw new Error('Reference bot manifest/config SHA-256 digests are required');
  }
  const displayName = env.OTT_DEMO_REFERENCE_BOT_DISPLAY_NAME ?? 'BTC demo reference';
  if (displayName.trim().length === 0 || displayName.length > 120) throw new Error('Reference bot display name must be 1..120 characters');
  const policyVersion = env.OTT_DEMO_REFERENCE_BOT_POLICY_VERSION ?? 'P2_BASELINE_V1';
  let entrypoint: unknown;
  try {
    entrypoint = JSON.parse(env.OTT_DEMO_REFERENCE_BOT_ENTRYPOINT ?? '["/bot"]');
  } catch {
    throw new Error('OTT_DEMO_REFERENCE_BOT_ENTRYPOINT must be a JSON string array');
  }
  if (!Array.isArray(entrypoint) || entrypoint.length === 0 || !entrypoint.every((part) => typeof part === 'string' && part.length > 0)) {
    throw new Error('OTT_DEMO_REFERENCE_BOT_ENTRYPOINT must be a non-empty JSON string array');
  }
  const objectKey = `test-run-reference-bots/${id}/${checksum}.tar`;
  await options.storage.put(objectKey, options.archive);
  await options.database.query(
    `INSERT INTO test_run_reference_bots
       (id, display_name, object_key, archive_sha256, manifest_digest, config_digest, entrypoint, policy_version, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,TRUE)
     ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, object_key=EXCLUDED.object_key,
       archive_sha256=EXCLUDED.archive_sha256, manifest_digest=EXCLUDED.manifest_digest,
       config_digest=EXCLUDED.config_digest, entrypoint=EXCLUDED.entrypoint,
       policy_version=EXCLUDED.policy_version, enabled=TRUE`,
    [id, displayName, objectKey, checksum, manifestDigest, configDigest, JSON.stringify(entrypoint), policyVersion],
  );
  return { id, objectKey, checksum };
}
