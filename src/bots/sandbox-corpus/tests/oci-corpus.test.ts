import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

type Fixture = { id: string; expected: string; language?: string; archiveSha256?: string; ociManifestDigest?: string; ociConfigDigest?: string; entrypoint?: string[]; dockerfile?: string };
describe('OCI sandbox corpus', () => {
  it('declares deterministic good, multi-language and security canaries', async () => {
    const corpus = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8')) as { version: number; fixtures: Fixture[] };
    expect(corpus.version).toBe(1);
    expect(corpus.fixtures.map((x) => x.id)).toEqual(expect.arrayContaining(['first-legal-python', 'capture-first-python', 'node-action', 'native-action', 'timeout', 'fork', 'write', 'network', 'output', 'memory', 'cpu']));
    expect(corpus.fixtures.filter((x) => x.expected === 'ACTION').map((x) => x.language)).toEqual(expect.arrayContaining(['python', 'node', 'native']));
    for (const fixture of corpus.fixtures) {
      expect(fixture.dockerfile).toBeTruthy();
      expect(fixture.archiveSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(fixture.ociManifestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(fixture.ociConfigDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(fixture.entrypoint?.length).toBeGreaterThan(0);
    }
  });
});
