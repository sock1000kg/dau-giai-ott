import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { validateOciSubmission } from '@ott/job-contract';

type Fixture = { id: string; expected: string; language?: string; archive?: string; archiveSha256?: string; ociManifestDigest?: string; ociConfigDigest?: string; entrypoint?: string[]; imageRef?: string; imageId?: string; dockerfile: string; buildArg?: string };
const root = resolve(import.meta.dirname, '../../../..');
const manifestPath = resolve(import.meta.dirname, '../manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number; fixtures: Fixture[] };
const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

for (const fixture of manifest.fixtures) {
  const imageRef = `ott-corpus-${fixture.id}:local`;
  {
    const args = ['buildx', 'build', '--platform=linux/amd64', '--file', fixture.dockerfile, '--tag', imageRef, '--load'];
    if (fixture.buildArg !== undefined) args.push('--build-arg', fixture.buildArg);
    args.push('.');
    execFileSync('docker', args, { cwd: root, stdio: 'inherit' });
  }
  const archivePath = resolve(root, 'src/bots/sandbox-corpus/artifacts', fixture.archive ?? `oci-fixtures/${fixture.id}.oci.tar`);
  const rawArchivePath = `${archivePath}.raw`;
  const layoutPath = `${archivePath}.layout`;
  await mkdir(dirname(archivePath), { recursive: true });
  await rm(archivePath, { force: true });
  await rm(rawArchivePath, { force: true });
  await rm(layoutPath, { recursive: true, force: true });
  await mkdir(layoutPath, { recursive: true });
  execFileSync('docker', ['buildx', 'build', '--platform=linux/amd64', '--file', fixture.dockerfile, '--tag', imageRef, '--output', `type=oci,dest=${rawArchivePath}`, ...(fixture.buildArg === undefined ? [] : ['--build-arg', fixture.buildArg]), '.'], { cwd: root, stdio: 'inherit' });
  execFileSync('tar', ['-xf', rawArchivePath, '-C', layoutPath]);
  const sourceIndex = JSON.parse(await readFile(resolve(layoutPath, 'index.json'), 'utf8')) as { manifests: { annotations?: Record<string, string> }[] };
  for (const descriptor of sourceIndex.manifests) {
    if (descriptor.annotations !== undefined) delete descriptor.annotations['org.opencontainers.image.created'];
  }
  await writeFile(resolve(layoutPath, 'index.json'), `${JSON.stringify(sourceIndex)}\n`);
  const blobFiles = (await readdir(resolve(layoutPath, 'blobs/sha256'))).sort().map((file) => `blobs/sha256/${file}`);
  execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--no-recursion', '-cf', archivePath, '-C', layoutPath, 'oci-layout', 'index.json', ...blobFiles]);
  await rm(rawArchivePath, { force: true });
  await rm(layoutPath, { recursive: true, force: true });
  const archiveBytes = await readFile(archivePath);
  fixture.archiveSha256 = digest(archiveBytes);
  const validation = validateOciSubmission(archiveBytes, { maxArchiveBytes: 256 * 1024 * 1024, maxUncompressedBytes: 512 * 1024 * 1024 });
  if (!validation.ok) throw new Error(`${fixture.id}: OCI contract rejected archive with ${validation.code}`);
  const inspect = JSON.parse(execFileSync('docker', ['image', 'inspect', imageRef], { cwd: root, encoding: 'utf8' }))[0] as { Id: string };
  const index = JSON.parse(execFileSync('tar', ['-xOf', archivePath, 'index.json'], { encoding: 'utf8' })) as { manifests: { digest: string; annotations?: Record<string, string> }[] };
  const descriptor = index.manifests[0];
  const manifestDigest = descriptor?.digest;
  if (manifestDigest === undefined) throw new Error(`${fixture.id}: OCI manifest missing`);
  const manifestContent = execFileSync('tar', ['-xOf', archivePath, `blobs/sha256/${manifestDigest.slice(7)}`]);
  const ociManifest = JSON.parse(manifestContent.toString('utf8')) as { config: { digest: string } };
  const configContent = execFileSync('tar', ['-xOf', archivePath, `blobs/sha256/${ociManifest.config.digest.slice(7)}`]);
  const imageConfig = JSON.parse(configContent.toString('utf8')) as { config: { Entrypoint: string[] } };
  fixture.imageId = inspect.Id;
  fixture.ociManifestDigest = manifestDigest;
  fixture.ociConfigDigest = ociManifest.config.digest;
  fixture.entrypoint = imageConfig.config.Entrypoint;
  if (validation.value.ociManifestDigest !== manifestDigest || validation.value.ociConfigDigest !== ociManifest.config.digest) throw new Error(`${fixture.id}: validator identity does not match OCI index`);
  console.log(`${fixture.id}: archive=${fixture.archiveSha256} manifest=${manifestDigest} config=${ociManifest.config.digest} entrypoint=${JSON.stringify(imageConfig.config.Entrypoint)}`);
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
