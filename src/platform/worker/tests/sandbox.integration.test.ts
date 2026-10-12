import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, compileProtocolValidator } from '@ott/bot-protocol';
import { DEFAULT_MAP, type GameConfig } from '@ott/game-core';
import { CoreGameAdapter, runMatch } from '@ott/match-runner';
import type { OciArtifactReference } from '@ott/job-contract';
import { validatePinnedOciArtifact } from '../src/artifacts.ts';
import { SandboxOciBotPort } from '../src/sandbox/oci-bot-port.ts';
import { SANDBOX_POLICY_V1, dockerSandboxHostConfig } from '../src/sandbox/policy.ts';

type Fixture = {
  readonly id: string;
  readonly expected: string;
  readonly archive: string;
  readonly archiveSha256: string;
  readonly ociManifestDigest: string;
  readonly ociConfigDigest: string;
  readonly entrypoint: readonly string[];
};
let fixtures: readonly Fixture[] = [];
let validator: ReturnType<typeof compileProtocolValidator>;
const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

beforeAll(async () => {
  const corpus = JSON.parse(await readFile(join(root, 'src/bots/sandbox-corpus/manifest.json'), 'utf8')) as { fixtures: readonly Fixture[] };
  fixtures = corpus.fixtures;
  validator = compileProtocolValidator(JSON.parse(await readFile(join(root, 'docs/contracts/bot-protocol-v1.schema.json'), 'utf8')) as unknown);
  for (const fixture of fixtures) await readFile(join(root, 'src/bots/sandbox-corpus/artifacts', fixture.archive));
}, 30_000);

function fixture(id: string): Fixture {
  const value = fixtures.find((item) => item.id === id);
  if (!value) throw new Error(`Fixture missing: ${id}`);
  return value;
}
async function portFor(id: string, withValidator = true): Promise<SandboxOciBotPort> {
  const item = fixture(id);
  const archive = await readFile(join(root, 'src/bots/sandbox-corpus/artifacts', item.archive));
  const reference: OciArtifactReference = {
    submissionId: '92e48aec-98c6-4ad6-8c0d-33a5f2b82a09',
    archiveSha256: item.archiveSha256,
    manifestDigest: item.ociManifestDigest,
    configDigest: item.ociConfigDigest,
    policyVersion: SANDBOX_POLICY_V1.version,
  };
  return new SandboxOciBotPort({ archive, reference, expectedEntrypoint: item.entrypoint, ...(withValidator ? { validator } : {}) });
}
const game: GameConfig = { gameId: 'sandbox-match', engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 2 };

describe('P2-T10 Docker OCI sandbox', () => {
  it('pins validated bytes, manifest/config and entrypoint before runtime import', async () => {
    const item = fixture('first-legal-python');
    const archive = await readFile(join(root, 'src/bots/sandbox-corpus/artifacts', item.archive));
    const reference: OciArtifactReference = {
      submissionId: '92e48aec-98c6-4ad6-8c0d-33a5f2b82a09', archiveSha256: item.archiveSha256,
      manifestDigest: item.ociManifestDigest, configDigest: item.ociConfigDigest, policyVersion: SANDBOX_POLICY_V1.version,
    };
    expect(validatePinnedOciArtifact(archive, reference, item.entrypoint, SANDBOX_POLICY_V1).ociManifestDigest).toBe(item.ociManifestDigest);
    expect(() => validatePinnedOciArtifact(Buffer.concat([archive, Buffer.from('tamper')]), reference, item.entrypoint, SANDBOX_POLICY_V1)).toThrow('ARTIFACT_ARCHIVE_CHECKSUM_MISMATCH');
    expect(dockerSandboxHostConfig()).toMatchObject({ NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], PidsLimit: 64, Binds: [], Mounts: [], Devices: [] });
  });

  it('applies and exposes the hard sandbox policy on a real container', async () => {
    const bot = await portFor('native-action', false);
    const start = await bot.start({ type: 'INIT', protocolVersion: 1, matchId: 'sandbox-policy-inspection', engineVersion: '1.0.0', side: 'X', seed: 'fixture', map: DEFAULT_MAP, limits: { ...DEFAULT_LIMITS } });
    expect(start.ok).toBe(true);
    if (start.ok) {
      expect(await bot.inspectSandbox()).toMatchObject({
        user: '65532:65532', networkMode: 'none', readOnlyRootfs: true, privileged: false,
        capDrop: ['ALL'], securityOptions: ['no-new-privileges:true'], memoryBytes: 268435456,
        memorySwapBytes: 268435456, nanoCpus: 1_000_000_000, pidsLimit: 64,
        mounts: [], binds: [], devices: [], tmpfs: { '/tmp': expect.stringContaining('size=67108864') },
      });
    }
    await bot.stop();
  }, 15_000);

  for (const id of ['first-legal-python', 'capture-first-python', 'node-action', 'native-action']) {
    it(`runs ${id} through BotPort and unchanged MatchRunner protocol`, async () => {
      const x = await portFor(id);
      const o = await portFor(id);
      const report = await runMatch({ matchId: `sandbox-${id}`, seed: 'fixture', game: { ...game, gameId: `sandbox-${id}` }, limits: { ...DEFAULT_LIMITS, maxTurns: 2 } }, {
        game: new CoreGameAdapter(), bots: { X: x, O: o },
      });
      expect(report.result.turnCount).toBe(2);
      expect(report.events.map((event) => event.type)).toContain('ACTION_APPLIED');
    }, 30_000);
  }

  for (const id of ['timeout', 'fork', 'write', 'network', 'output', 'memory', 'cpu']) {
    it(`enforces limits for ${id} corpus bot`, async () => {
      const bot = await portFor(id);
      const gamePort = new CoreGameAdapter();
      const initial = gamePort.create(game);
      const start = await bot.start({ type: 'INIT', protocolVersion: 1, matchId: `sandbox-${id}`, engineVersion: '1.0.0', side: 'X', seed: 'fixture', map: DEFAULT_MAP, limits: { ...DEFAULT_LIMITS } });
      if (!start.ok) {
        expect(['BOT_SPAWN_FAILED', 'BOT_CRASHED', 'BOT_EOF', 'RESOURCE_LIMIT_EXCEEDED', 'STDERR_LIMIT_EXCEEDED']).toContain(start.code);
        await bot.stop();
        return;
      }
      const actions = gamePort.listLegalActions(initial, 'X');
      const result = await bot.requestAction({ type: 'STATE_UPDATE', protocolVersion: 1, matchId: `sandbox-${id}`, turnId: 1, state: {
        schemaVersion: 1, engineVersion: '1.0.0', map: DEFAULT_MAP, status: 'PLAYING', turn: 'X', turnNumber: 1,
        turnCount: 0, revision: 0, maxTurns: 2, pieces: initial.pieces, outcome: null,
      }, legalActions: actions }, 3500);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(['BOT_TIMEOUT', 'BOT_CRASHED', 'BOT_EOF', 'RESOURCE_LIMIT_EXCEEDED', 'STDERR_LIMIT_EXCEEDED', 'MESSAGE_TOO_LARGE']).toContain(result.code);
      if (id === 'timeout') {
        expect(result).toEqual({ ok: false, code: 'BOT_TIMEOUT' });
        expect(await bot.inspectSandbox()).toMatchObject({ networkMode: 'none', pidsLimit: 64 });
      }
      await bot.stop();
      await bot.stop();
    }, 15_000);
  }
});
