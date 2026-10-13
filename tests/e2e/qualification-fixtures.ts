import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { bootstrapBtcAdmin, createDatabase, createPasswordHasher, createS3Storage } from '@ott/platform-api';
import { SANDBOX_POLICY_V1 } from '../../src/platform/worker/src/sandbox/policy.ts';

interface CorpusFixture {
  readonly id: string;
  readonly expected: string;
  readonly language?: string;
  readonly archive: string;
  readonly archiveSha256: string;
  readonly ociManifestDigest: string;
  readonly ociConfigDigest: string;
  readonly entrypoint: readonly string[];
}
interface CorpusManifest { readonly version: number; readonly fixtures: readonly CorpusFixture[]; }
interface QualificationPrerequisites {
  readonly profileVersion: string;
  readonly sandboxPolicyVersion: string;
  readonly fixtures: readonly CorpusFixture[];
}

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const namespacePattern = /^[a-f0-9]{32}$/;
const requiredFixtureIds = ['first-legal-python', 'capture-first-python'] as const;
type QualificationSandboxProfile = Omit<Pick<typeof SANDBOX_POLICY_V1, 'version' | 'memoryBytes' | 'turnTimeoutMs' | 'networkMode' | 'readOnlyRootfs'>, 'version'> & { readonly version: string };

function fail(code: string): never { throw new Error(code); }

export async function assertQualificationPrerequisites(
  rootDir: string,
  options: { readonly policy?: QualificationSandboxProfile } = {},
): Promise<QualificationPrerequisites> {
  const policy = options.policy ?? SANDBOX_POLICY_V1;
  if (policy.version !== 'OTT_SANDBOX_V1' || policy.memoryBytes <= 0 || policy.turnTimeoutMs <= 0
    || policy.networkMode !== 'none' || policy.readOnlyRootfs !== true) fail('QUALIFICATION_PROFILE_MISSING_OR_UNSUPPORTED');

  let manifest: CorpusManifest;
  try {
    manifest = JSON.parse(await readFile(join(rootDir, 'src/bots/sandbox-corpus/manifest.json'), 'utf8')) as CorpusManifest;
  } catch {
    return fail('QUALIFICATION_CORPUS_MANIFEST_MISSING_OR_INVALID');
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    fail('QUALIFICATION_CORPUS_MANIFEST_MISSING_OR_INVALID');
  }
  const byId = new Map(manifest.fixtures.map((fixture) => [fixture.id, fixture]));
  for (const fixtureId of requiredFixtureIds) {
    const fixture = byId.get(fixtureId);
    if (fixture === undefined || fixture.expected !== 'ACTION' || fixture.language !== 'python'
      || !digestPattern.test(fixture.archiveSha256) || !digestPattern.test(fixture.ociManifestDigest)
      || !digestPattern.test(fixture.ociConfigDigest) || fixture.entrypoint.length === 0) {
      fail(`QUALIFICATION_CANARY_FIXTURE_INVALID:${fixtureId}`);
    }
  }

  for (const fixture of manifest.fixtures) {
    if (!digestPattern.test(fixture.archiveSha256)) fail(`QUALIFICATION_CORPUS_DIGEST_MISSING:${fixture.id}`);
    let archive: Uint8Array;
    try {
      archive = await readFile(join(rootDir, 'src/bots/sandbox-corpus/artifacts', fixture.archive));
    } catch {
      return fail(`QUALIFICATION_CORPUS_ARCHIVE_MISSING:${fixture.id}`);
    }
    const actual = `sha256:${createHash('sha256').update(archive).digest('hex')}`;
    if (actual !== fixture.archiveSha256) fail(`QUALIFICATION_CORPUS_ARCHIVE_DIGEST_MISMATCH:${fixture.id}`);
  }

  let workerSource: string;
  try {
    workerSource = await readFile(join(rootDir, 'src/platform/worker/src/run-match-job.ts'), 'utf8');
  } catch {
    return fail('QUALIFICATION_PLATFORM_PROFILE_MISSING');
  }
  const profileMatch = /const PLATFORM_POLICY_VERSION = '([A-Z0-9_]+)'/.exec(workerSource);
  if (profileMatch?.[1] !== 'P2_BASELINE_V1') fail('QUALIFICATION_PLATFORM_PROFILE_MISSING_OR_UNSUPPORTED');

  return {
    profileVersion: profileMatch[1],
    sandboxPolicyVersion: policy.version,
    fixtures: manifest.fixtures,
  };
}

function required(environment: NodeJS.ProcessEnv, key: string): string {
  const value = environment[key];
  if (value === undefined || value.length === 0) fail(`QUALIFICATION_ENV_MISSING:${key}`);
  return value;
}

async function ensureTeamAccount(
  database: ReturnType<typeof createDatabase>,
  hasher: ReturnType<typeof createPasswordHasher>,
  name: string,
  username: string,
  password: string,
): Promise<string> {
  const teamInsert = await database.query<{ readonly id: string }>(
    'INSERT INTO teams (id, name) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING RETURNING id',
    [randomUUID(), name],
  );
  const team = teamInsert.rows[0] ?? (await database.query<{ readonly id: string }>('SELECT id FROM teams WHERE name = $1', [name])).rows[0];
  if (team === undefined) fail('QUALIFICATION_TEAM_SEED_FAILED');
  await database.query(
    "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4) ON CONFLICT (username) DO NOTHING",
    [randomUUID(), username, await hasher.hash(password), team.id],
  );
  const account = await database.query<{ readonly team_id: string; readonly role: string }>(
    'SELECT team_id, role FROM accounts WHERE username = $1', [username],
  );
  if (account.rows[0]?.role !== 'TEAM_ACCOUNT' || account.rows[0].team_id !== team.id) fail('QUALIFICATION_ACCOUNT_SEED_CONFLICT');
  return team.id;
}

export async function seedQualificationFixtures(environment: NodeJS.ProcessEnv, rootDir: string): Promise<void> {
  const namespace = required(environment, 'OTT_E2E_NAMESPACE');
  if (!namespacePattern.test(namespace)) fail('QUALIFICATION_NAMESPACE_INVALID');
  const prerequisites = await assertQualificationPrerequisites(rootDir);
  const databaseUrl = required(environment, 'DATABASE_URL');
  const endpoint = required(environment, 'S3_ENDPOINT');
  const bucket = required(environment, 'S3_BUCKET');
  const accessKeyId = required(environment, 'S3_ACCESS_KEY_ID');
  const secretAccessKey = required(environment, 'S3_SECRET_ACCESS_KEY');
  const btcUsername = required(environment, 'OTT_E2E_BTC_USERNAME');
  const btcPassword = required(environment, 'OTT_E2E_BTC_PASSWORD');
  const xUsername = required(environment, 'OTT_E2E_TEAM_X_USERNAME');
  const xPassword = required(environment, 'OTT_E2E_TEAM_X_PASSWORD');
  const oUsername = required(environment, 'OTT_E2E_TEAM_O_USERNAME');
  const oPassword = required(environment, 'OTT_E2E_TEAM_O_PASSWORD');

  const database = createDatabase({ connectionString: databaseUrl });
  const client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } });
  const storage = createS3Storage({ client, bucket });
  const hasher = createPasswordHasher({ memoryCost: 4096, timeCost: 1 });
  try {
    await bootstrapBtcAdmin({ database, passwordHasher: hasher, environment: { OTT_BOOTSTRAP_BTC_USERNAME: btcUsername, OTT_BOOTSTRAP_BTC_PASSWORD: btcPassword } });
    const teamXId = await ensureTeamAccount(database, hasher, `qualification-${namespace}-x`, xUsername, xPassword);
    const teamOId = await ensureTeamAccount(database, hasher, `qualification-${namespace}-o`, oUsername, oPassword);
    const canaries = requiredFixtureIds.map((id, index) => {
      const fixture = prerequisites.fixtures.find((entry) => entry.id === id);
      if (fixture === undefined) fail(`QUALIFICATION_CANARY_FIXTURE_INVALID:${id}`);
      return { fixture, teamId: index === 0 ? teamXId : teamOId };
    });

    for (const { fixture, teamId } of canaries) {
      const key = `qualification/${namespace}/canary/${fixture.id}.oci.tar`;
      const archive = await readFile(join(rootDir, 'src/bots/sandbox-corpus/artifacts', fixture.archive));
      await storage.put(key, archive);
      await database.query(
        `INSERT INTO submissions (id, team_id, tournament_stage, archive_sha256, oci_manifest_digest, oci_config_digest, entrypoint, platform, object_key, policy_version, status)
         VALUES ($1, $2, 'QUALIFICATION', $3, $4, $5, $6::jsonb, 'linux/amd64', $7, $8, 'ACTIVE')
         ON CONFLICT (object_key) DO NOTHING`,
        [randomUUID(), teamId, fixture.archiveSha256, fixture.ociManifestDigest, fixture.ociConfigDigest, JSON.stringify(fixture.entrypoint), key, prerequisites.profileVersion],
      );
      const stored = await database.query<{ readonly team_id: string; readonly archive_sha256: string; readonly policy_version: string }>(
        'SELECT team_id, archive_sha256, policy_version FROM submissions WHERE object_key = $1', [key],
      );
      if (stored.rows[0]?.team_id !== teamId || stored.rows[0].archive_sha256 !== fixture.archiveSha256
        || stored.rows[0].policy_version !== prerequisites.profileVersion) fail(`QUALIFICATION_SUBMISSION_SEED_CONFLICT:${fixture.id}`);
    }
  } finally {
    client.destroy();
    await database.close();
  }
}
