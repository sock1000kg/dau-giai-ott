import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, release, totalmem, arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, compileProtocolValidator } from '@ott/bot-protocol';
import { DEFAULT_MAP, type GameConfig } from '@ott/game-core';
import { CoreGameAdapter, runMatch } from '@ott/match-runner';
import type { OciArtifactReference } from '@ott/job-contract';
import { validatePinnedOciArtifact } from '../src/artifacts.ts';
import { SandboxOciBotPort } from '../src/sandbox/oci-bot-port.ts';
import { SANDBOX_POLICY_V1, dockerSandboxHostConfig } from '../src/sandbox/policy.ts';
import { DockerOciRuntime, type DockerHostBenchmarkInfo } from '../src/sandbox/oci-runtime.ts';

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
let dockerHost: DockerHostBenchmarkInfo;
const benchmarkEntries: Array<Record<string, unknown>> = [];
const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

beforeAll(async () => {
  const corpus = JSON.parse(await readFile(join(root, 'src/bots/sandbox-corpus/manifest.json'), 'utf8')) as { fixtures: readonly Fixture[] };
  fixtures = corpus.fixtures;
  validator = compileProtocolValidator(JSON.parse(await readFile(join(root, 'docs/contracts/bot-protocol-v1.schema.json'), 'utf8')) as unknown);
  dockerHost = await new DockerOciRuntime().benchmarkHostInfo();
  for (const fixture of fixtures) await readFile(join(root, 'src/bots/sandbox-corpus/artifacts', fixture.archive));
}, 30_000);

afterAll(async () => {
  const reportPath = process.env.OTT_SANDBOX_BENCHMARK_REPORT;
  if (!reportPath) return;
  await mkdir(dirname(resolve(reportPath)), { recursive: true });
  await writeFile(resolve(reportPath), `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policyVersion: SANDBOX_POLICY_V1.version,
    host: {
      ...dockerHost,
      nodeVersion: process.version,
      hostPlatform: platform(),
      hostArchitecture: arch(),
      hostKernel: release(),
      cpuModel: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      hostMemoryBytes: totalmem(),
    },
    measurementNotes: [
      'One local run per canary; startup and first-action latency are wall-clock measurements.',
      'Docker stats are one-shot samples while the container is alive; memoryMaxUsageBytes may be null on cgroup v2.',
      'A single developer host and internal canary corpus cannot establish cross-team fairness; registration remains gated by a representative repeated benchmark.',
    ],
    fixtures: benchmarkEntries,
  }, null, 2)}\n`);
});

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

  it('records startup, first ACTION latency and live Docker quota samples for allowed canaries', async () => {
    for (const id of ['first-legal-python', 'capture-first-python', 'node-action', 'native-action']) {
      const bot = await portFor(id);
      const gamePort = new CoreGameAdapter();
      const state = gamePort.create(game);
      const startAt = performance.now();
      const started = await bot.start({ type: 'INIT', protocolVersion: 1, matchId: `benchmark-${id}`, engineVersion: '1.0.0', side: 'X', seed: 'benchmark', map: DEFAULT_MAP, limits: { ...DEFAULT_LIMITS } });
      const startupMs = performance.now() - startAt;
      expect(started.ok).toBe(true);
      if (!started.ok) { await bot.stop(); continue; }
      const actionStart = performance.now();
      const actionPromise = bot.requestAction({ type: 'STATE_UPDATE', protocolVersion: 1, matchId: `benchmark-${id}`, turnId: 1, state: {
        schemaVersion: 1, engineVersion: '1.0.0', map: DEFAULT_MAP, status: 'PLAYING', turn: 'X', turnNumber: 1,
        turnCount: 0, revision: 0, maxTurns: 2, pieces: state.pieces, outcome: null,
      }, legalActions: gamePort.listLegalActions(state, 'X') }, 3000);
      const statsPromise = bot.benchmarkStats().catch(() => null);
      const action = await actionPromise;
      const actionMs = performance.now() - actionStart;
      const stats = await statsPromise;
      expect(action.ok).toBe(true);
      benchmarkEntries.push({ fixtureId: id, expected: fixture(id).expected, category: 'allowed', startupMs: rounded(startupMs), firstActionMs: rounded(actionMs), outcome: action.ok ? 'ACTION' : action.code, samples: validStats(stats) ? [stats] : [] });
      await bot.stop();
    }
  }, 60_000);

  for (const id of ['timeout', 'fork', 'write', 'network', 'output', 'memory', 'cpu']) {
    it(`enforces limits for ${id} corpus bot`, async () => {
      const bot = await portFor(id);
      const gamePort = new CoreGameAdapter();
      const initial = gamePort.create(game);
      const startAt = performance.now();
      const start = await bot.start({ type: 'INIT', protocolVersion: 1, matchId: `sandbox-${id}`, engineVersion: '1.0.0', side: 'X', seed: 'fixture', map: DEFAULT_MAP, limits: { ...DEFAULT_LIMITS } });
      const startupMs = performance.now() - startAt;
      if (!start.ok) {
        expect(['BOT_SPAWN_FAILED', 'BOT_CRASHED', 'BOT_EOF', 'RESOURCE_LIMIT_EXCEEDED', 'STDERR_LIMIT_EXCEEDED']).toContain(start.code);
        if (id === 'memory' || id === 'output') expect(start.code).toBe('RESOURCE_LIMIT_EXCEEDED');
        benchmarkEntries.push({ fixtureId: id, expected: fixture(id).expected, category: 'fault', startupMs: rounded(startupMs), outcome: start.code, samples: [] });
        await bot.stop();
        return;
      }
      const actions = gamePort.listLegalActions(initial, 'X');
      const actionStart = performance.now();
      const actionPromise = bot.requestAction({ type: 'STATE_UPDATE', protocolVersion: 1, matchId: `sandbox-${id}`, turnId: 1, state: {
        schemaVersion: 1, engineVersion: '1.0.0', map: DEFAULT_MAP, status: 'PLAYING', turn: 'X', turnNumber: 1,
        turnCount: 0, revision: 0, maxTurns: 2, pieces: initial.pieces, outcome: null,
      }, legalActions: actions }, 3500);
      const statsPromise = bot.benchmarkStats().catch(() => null);
      let result = await actionPromise;
      let actionMs = performance.now() - actionStart;
      let stats = await statsPromise;
      if ((id === 'memory' || id === 'output') && !result.ok && (result.code === 'BOT_TIMEOUT' || result.code === 'MESSAGE_TOO_LARGE')) {
        const followupAt = performance.now();
        const followup = await bot.requestAction({ type: 'STATE_UPDATE', protocolVersion: 1, matchId: `sandbox-${id}`, turnId: 2, state: {
          schemaVersion: 1, engineVersion: '1.0.0', map: DEFAULT_MAP, status: 'PLAYING', turn: 'X', turnNumber: 2,
          turnCount: 1, revision: 1, maxTurns: 2, pieces: initial.pieces, outcome: null,
        }, legalActions: actions }, 3500);
        actionMs += performance.now() - followupAt;
        result = followup;
        stats = await bot.benchmarkStats().catch(() => stats);
      }
      expect(result.ok).toBe(false);
      if (!result.ok) expect(['BOT_TIMEOUT', 'BOT_CRASHED', 'BOT_EOF', 'RESOURCE_LIMIT_EXCEEDED', 'STDERR_LIMIT_EXCEEDED', 'MESSAGE_TOO_LARGE']).toContain(result.code);
      if (id === 'timeout') {
        expect(result).toEqual({ ok: false, code: 'BOT_TIMEOUT' });
        expect(await bot.inspectSandbox()).toMatchObject({ networkMode: 'none', pidsLimit: 64 });
      }
      if (id === 'network') expect(await bot.inspectSandbox()).toMatchObject({ networkMode: 'none' });
      if (id === 'fork' || id === 'write') expect(result).toEqual({ ok: false, code: 'BOT_CRASHED' });
      if (id === 'network' || id === 'cpu') expect(result).toEqual({ ok: false, code: 'BOT_TIMEOUT' });
      if (id === 'memory' || id === 'output') expect(result).toEqual({ ok: false, code: 'RESOURCE_LIMIT_EXCEEDED' });
      benchmarkEntries.push({ fixtureId: id, expected: fixture(id).expected, category: 'fault', startupMs: rounded(startupMs), firstActionMs: rounded(actionMs), outcome: result.ok ? 'ACTION' : result.code, samples: validStats(stats) ? [stats] : [] });
      await bot.stop();
      await bot.stop();
    }, 15_000);
  }
});

function rounded(value: number): number { return Math.round(value * 100) / 100; }
function validStats(stats: Awaited<ReturnType<SandboxOciBotPort['benchmarkStats']>> | null): stats is Awaited<ReturnType<SandboxOciBotPort['benchmarkStats']>> {
  return stats !== null && (stats.memoryLimitBytes > 0 || stats.cpuUsageNs > 0 || stats.pidsCurrent !== null);
}
