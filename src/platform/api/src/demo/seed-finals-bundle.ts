import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';

import { createDatabase, type Database } from '../db/client.ts';
import {
  exportDemoFinalsBundle,
  DEMO_KEY_ID,
} from '../modules/result-bundles/demo-bundle.ts';
import {
  importResultBundle,
  type ResultBundleArtifactPayload,
} from '../modules/result-bundles/importer.ts';
import {
  allowlistResultBundleKey,
  computeKeyFingerprint,
} from '../modules/result-bundles/keys.ts';
import { assertDemoEnvironment } from './seed-accounts.ts';

export interface SeedDemoFinalsBundleOptions {
  readonly database: Database;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly bundleDir?: string;
}

export interface SeedDemoFinalsBundleResult {
  readonly bundleId: string;
  readonly keyId: string;
  readonly replayed: boolean;
  readonly importedAt: Date;
}

export function findDefaultFinalsDir(env: Readonly<Record<string, string | undefined>>): string {
  if (env.OTT_DEMO_FINALS_DIR) {
    return path.resolve(env.OTT_DEMO_FINALS_DIR);
  }
  // If running inside container where /demo is mounted
  if (fs.existsSync('/demo')) {
    return '/demo/finals';
  }
  // Running locally from repo root
  return path.resolve(process.cwd(), '.local/demo/finals');
}

export async function seedDemoFinalsBundle(
  options: SeedDemoFinalsBundleOptions,
): Promise<SeedDemoFinalsBundleResult> {
  const env = options.environment ?? process.env;
  assertDemoEnvironment(env);

  // Look up BTC admin account for audit attribution
  const btcRow = await options.database.query<{ id: string }>(
    'SELECT id FROM accounts WHERE username = $1 LIMIT 1',
    ['btc'],
  );
  const actorAccountId = btcRow.rows[0]?.id;
  if (!actorAccountId) {
    throw new Error('BTC admin account not found in accounts table; seedDemoAccounts must run first');
  }

  const finalsDir = options.bundleDir ?? findDefaultFinalsDir(env);
  fs.mkdirSync(finalsDir, { recursive: true, mode: 0o700 });

  const bundleFilePath = path.join(finalsDir, 'demo-finals-bundle.json');

  // Generate demo finals bundle deterministically using pure module logic
  const exportResult = await exportDemoFinalsBundle({ outFile: bundleFilePath, keyDir: finalsDir });

  // Register public key via allowlistResultBundleKey (append-only, never overwrites)
  await allowlistResultBundleKey(options.database, {
    keyId: DEMO_KEY_ID,
    publicKeyPem: exportResult.publicKeyPem,
    fingerprintConfirmation: exportResult.fingerprint,
    reason: 'Demo finals public key registration',
    actorAccountId,
  });

  // Read generated bundle
  const rawBundle = JSON.parse(await fs.promises.readFile(bundleFilePath, 'utf8'));
  const decodedArtifacts: ResultBundleArtifactPayload[] = rawBundle.artifacts.map(
    (a: { path: string; payloadBase64: string }) => ({
      path: a.path,
      payload: Buffer.from(a.payloadBase64, 'base64'),
    }),
  );

  // Import and publish ResultBundle
  const imported = await importResultBundle(
    options.database,
    {
      manifest: rawBundle.manifest,
      signature: rawBundle.signature,
      artifacts: decodedArtifacts,
    },
    { actorAccountId },
  );

  return {
    bundleId: imported.bundleId,
    keyId: imported.keyId,
    replayed: imported.replayed,
    importedAt: imported.importedAt,
  };
}

export async function main(): Promise<void> {
  const env = process.env;
  assertDemoEnvironment(env);

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed demo finals bundle');
  }

  const database = createDatabase({ connectionString: databaseUrl });
  try {
    const result = await seedDemoFinalsBundle({ database, environment: env });
    process.stdout.write(
      `Seeded demo finals bundle ${result.bundleId} (key ${result.keyId}, replayed=${result.replayed})\n`,
    );
  } finally {
    await database.close();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(process.cwd(), 'src/demo/seed-finals-bundle.ts');

if (isMain) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
