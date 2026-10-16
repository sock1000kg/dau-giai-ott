import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MatchJobV1, OciArtifactReference } from '@ott/job-contract';
import { DEFAULT_MAP, type GameResult } from '@ott/game-core';
import type { Database, ObjectStorage } from '@ott/platform-api';
import type { BotPort, BotReply, BotStartResult } from '@ott/match-runner';
import type { InitMessage, MatchResultMessage, StateUpdateMessage, TurnResultMessage } from '@ott/bot-protocol';
import {
  SANDBOX_POLICY_V1,
  createSandboxPolicy,
  resolveSandboxPolicy,
  dockerSandboxHostConfig,
  type SandboxPolicy,
} from '../src/sandbox/policy.ts';
import { DockerOciRuntime } from '../src/sandbox/oci-runtime.ts';
import {
  WorkerMetrics,
  assertMetricsSanitized,
  defaultWorkerMetrics,
} from '../src/metrics.ts';
import { runMatchJob } from '../src/run-match-job.ts';

const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

class MockStorage implements ObjectStorage {
  private readonly objects = new Map<string, Uint8Array>();
  async put(key: string, value: Uint8Array): Promise<void> {
    this.objects.set(key, Uint8Array.from(value));
  }
  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) throw new Error('OBJECT_NOT_FOUND');
    return Uint8Array.from(value);
  }
  async copy(source: string, destination: string): Promise<void> {
    const val = await this.get(source);
    this.objects.set(destination, val);
  }
  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

class ScriptedFakeBot implements BotPort {
  private init?: InitMessage;
  private readonly actions: readonly (string | import('@ott/game-core').GameAction)[];
  private readonly peakMemory: number | null;
  private readonly faultOnTurn?: { turnId: number; code: 'RESOURCE_LIMIT_EXCEEDED' | 'BOT_TIMEOUT' | 'BOT_CRASHED' } | undefined;

  constructor(
    actions: readonly (string | import('@ott/game-core').GameAction)[],
    peakMemory: number | null = null,
    faultOnTurn?: { turnId: number; code: 'RESOURCE_LIMIT_EXCEEDED' | 'BOT_TIMEOUT' | 'BOT_CRASHED' },
  ) {
    this.actions = actions;
    this.peakMemory = peakMemory;
    this.faultOnTurn = faultOnTurn;
  }

  async start(init: InitMessage): Promise<BotStartResult> {
    this.init = init;
    return { ok: true };
  }

  async requestAction(update: StateUpdateMessage): Promise<BotReply> {
    if (this.faultOnTurn && this.faultOnTurn.turnId === update.turnId) {
      return { ok: false, code: this.faultOnTurn.code };
    }
    const rawAction = this.actions[update.turnId - 1] ?? update.legalActions[0];
    if (!rawAction || !this.init) return { ok: false, code: 'BOT_CRASHED' };
    const action = typeof rawAction === 'string'
      ? (JSON.parse(rawAction) as import('@ott/game-core').GameAction)
      : rawAction;
    return {
      ok: true,
      message: {
        type: 'ACTION',
        protocolVersion: 1,
        matchId: this.init.matchId,
        turnId: update.turnId,
        action,
      },
    };
  }

  async notifyStateUpdate(): Promise<void> {}
  async sendTurnResult(): Promise<void> {}
  async finish(): Promise<void> {}
  async stop(): Promise<void> {}

  async readMemoryPeak(): Promise<number | null> {
    return this.peakMemory;
  }
}

function createMockDatabase(matchId: string): Database {
  return {
    query: async (sql: string) => {
      if (sql.includes('SELECT status FROM matches')) {
        return { rows: [{ status: 'PENDING' }] };
      }
      if (sql.includes('UPDATE matches SET status = \'RUNNING\'')) {
        return { rows: [{ id: matchId }], rowCount: 1 };
      }
      if (sql.includes('FROM matches m')) {
        return {
          rows: [
            {
              id: matchId,
              status: 'RUNNING',
              series_id: 'series-1',
              seed: 'seed-1',
              map_checksum: 'checksum-1',
              map_definition: { width: 5, height: 5, impassable: [] },
              engine_version: '1.0.0',
              max_turns: 10,
              turn_timeout_ms: 1000,
              policy_version: 'P2_BASELINE_V1',
              x_submission_id: 'sub-x',
              x_archive_sha256: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
              x_manifest_digest: 'sha256:4e388c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08123456',
              x_config_digest: 'sha256:5e388c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08123456',
              x_policy_version: 'P2_BASELINE_V1',
              x_object_key: 'objects/sub-x.tar',
              x_entrypoint: ['python', 'bot.py'],
              o_submission_id: 'sub-o',
              o_archive_sha256: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
              o_manifest_digest: 'sha256:6e388c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08123456',
              o_config_digest: 'sha256:7e388c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08123456',
              o_policy_version: 'P2_BASELINE_V1',
              o_object_key: 'objects/sub-o.tar',
              o_entrypoint: ['python', 'bot.py'],
            },
          ],
        };
      }
      if (sql.includes('SELECT count(*)::text AS count FROM match_attempts')) {
        return { rows: [{ count: '1' }] };
      }
      if (sql.includes('INSERT INTO match_attempts')) {
        return { rows: [{ id: 'attempt-1' }] };
      }
      return { rows: [], rowCount: 1 };
    },
    transaction: async <T>(work: (tx: Database) => Promise<T>) => work(createMockDatabase(matchId)),
    close: async () => undefined,
  } as unknown as Database;
}

describe('P3-N01 Resource profile, cgroup peak and Prometheus metrics', () => {
  beforeEach(() => {
    defaultWorkerMetrics.reset();
  });

  describe('1. Pinned Resource Profile & HostConfig Enforcement', () => {
    it('creates SandboxPolicy strictly from pinned resource profile', () => {
      const customProfile = {
        memoryMiB: 128,
        milliCpu: 500,
        pids: 32,
        tmpfsMiB: 16,
        startupTimeoutMs: 2500,
        turnTimeoutMs: 1200,
      };

      const policy = createSandboxPolicy(customProfile, 'OTT_ROUND_01');
      expect(policy.version).toBe('OTT_ROUND_01');
      expect(policy.memoryBytes).toBe(128 * 1024 * 1024);
      expect(policy.memorySwapBytes).toBe(128 * 1024 * 1024); // swap limit equals memory limit -> 0 swap
      expect(policy.nanoCpus).toBe(500_000_000); // 500 milliCpu = 0.5 vCPU
      expect(policy.pidsLimit).toBe(32);
      expect(policy.tmpfsBytes).toBe(16 * 1024 * 1024);
      expect(policy.startupTimeoutMs).toBe(2500);
      expect(policy.turnTimeoutMs).toBe(1200);
      expect(policy.networkMode).toBe('none');
      expect(policy.readOnlyRootfs).toBe(true);
    });

    it('resolves pinned policy versions and rejects unsupported versions', () => {
      expect(resolveSandboxPolicy('P2_BASELINE_V1')).toEqual(SANDBOX_POLICY_V1);
      expect(resolveSandboxPolicy('OTT_SANDBOX_V1')).toEqual(SANDBOX_POLICY_V1);
      const roundPolicy = resolveSandboxPolicy('OTT_ROUND_FINALS', { memoryMiB: 512 });
      expect(roundPolicy.memoryBytes).toBe(512 * 1024 * 1024);

      expect(() => resolveSandboxPolicy('UNTRUSTED_CLIENT_POLICY')).toThrow('MATCH_POLICY_VERSION_UNSUPPORTED');
    });

    it('enforces memory, swap, cpu, and isolation in dockerSandboxHostConfig', () => {
      const policy = createSandboxPolicy({ memoryMiB: 64, milliCpu: 250, pids: 16, tmpfsMiB: 8 });
      const hostConfig = dockerSandboxHostConfig(policy);

      expect(hostConfig).toMatchObject({
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        Privileged: false,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        Memory: 64 * 1024 * 1024,
        MemorySwap: 64 * 1024 * 1024,
        NanoCpus: 250_000_000,
        PidsLimit: 16,
        Tmpfs: { '/tmp': expect.stringContaining('size=8388608') },
        Binds: [],
        Mounts: [],
        Devices: [],
      });
    });
  });

  describe('2. Cgroup v2 memory.peak Reading & OOM Classification', () => {
    it('reads memory.peak from cgroup v2 filesystem when available', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'ott-cgroup-test-'));
      try {
        const peakFile = join(tempDir, 'memory.peak');
        await writeFile(peakFile, '134217728\n'); // 128 MiB

        const runtime = new DockerOciRuntime({ cgroupRoot: tempDir });
        const peak = await runtime.readMemoryPeak('container-123');
        expect(peak).toBe(134217728);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('falls back to null when cgroup path does not exist and stats unavailable', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'ott-cgroup-empty-'));
      try {
        const runtime = new DockerOciRuntime({
          cgroupRoot: tempDir,
          socketPath: '/nonexistent/docker.sock',
        });
        const peak = await runtime.readMemoryPeak('container-404');
        expect(peak).toBeNull();
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('3. AC-16 Bot Forfeit on Memory Limit & Prometheus Metrics', () => {
    it('handles bot exceeding memory limit with FORFEIT outcome and records memory peak', async () => {
      const matchId = '11111111-1111-4111-8111-111111111111';
      const subXId = '22222222-2222-4222-8222-222222222222';
      const subOId = '33333333-3333-4333-8333-333333333333';
      const digest = 'sha256:' + 'a'.repeat(64);
      const storage = new MockStorage();
      const testArchive = Buffer.from('test');
      await storage.put('objects/sub-x.tar', testArchive);
      await storage.put('objects/sub-o.tar', testArchive);

      let matchStatus = 'PENDING';
      const database = {
        query: async (sql: string) => {
          if (sql.includes('SELECT status FROM matches')) {
            return { rows: [{ status: matchStatus }] };
          }
          if (sql.includes('UPDATE matches SET status = \'RUNNING\'')) {
            matchStatus = 'RUNNING';
            return { rows: [{ id: matchId }], rowCount: 1 };
          }
          if (sql.includes('FROM matches m')) {
            return {
              rows: [
                {
                  id: matchId,
                  status: 'RUNNING',
                  series_id: 'series-1',
                  seed: 'seed-1',
                  map_checksum: DEFAULT_MAP.checksum,
                  map_definition: DEFAULT_MAP,
                  engine_version: '1.0.0',
                  max_turns: 10,
                  turn_timeout_ms: 1000,
                  policy_version: 'P2_BASELINE_V1',
                  x_submission_id: subXId,
                  x_archive_sha256: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
                  x_manifest_digest: digest,
                  x_config_digest: digest,
                  x_policy_version: 'P2_BASELINE_V1',
                  x_object_key: 'objects/sub-x.tar',
                  x_entrypoint: ['python', 'bot.py'],
                  o_submission_id: subOId,
                  o_archive_sha256: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
                  o_manifest_digest: digest,
                  o_config_digest: digest,
                  o_policy_version: 'P2_BASELINE_V1',
                  o_object_key: 'objects/sub-o.tar',
                  o_entrypoint: ['python', 'bot.py'],
                },
              ],
            };
          }
          if (sql.includes('SELECT count(*)::text AS count FROM match_attempts')) {
            return { rows: [{ count: '1' }] };
          }
          if (sql.includes('lease_expires_at > now()') && !sql.includes('lease_token')) {
            return { rows: [] };
          }
          if (sql.includes('lease_token')) {
            return { rows: [{ id: 'attempt-1' }] };
          }
          if (sql.includes('INSERT INTO match_attempts')) {
            return { rows: [{ id: 'attempt-1' }] };
          }
          if (sql.includes('SELECT winner_side')) {
            return { rows: [] };
          }
          return { rows: [], rowCount: 1 };
        },
        transaction: async <T>(work: (tx: Database) => Promise<T>) => work(database as unknown as Database),
        close: async () => undefined,
      } as unknown as Database;
      const metrics = new WorkerMetrics();

      const job: MatchJobV1 = {
        schemaVersion: 'ott.match-job.v1',
        matchId,
        idempotencyKey: matchId,
        policyVersion: 'P2_BASELINE_V1',
        x: {
          submissionId: subXId,
          archiveSha256: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          manifestDigest: digest,
          configDigest: digest,
          policyVersion: 'P2_BASELINE_V1',
        },
        o: {
          submissionId: subOId,
          archiveSha256: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          manifestDigest: digest,
          configDigest: digest,
          policyVersion: 'P2_BASELINE_V1',
        },
      };

      // Bot X plays normal legal moves, Bot O hits memory limit on turn 2
      const botX = new ScriptedFakeBot(['{"move":{"from":{"x":0,"y":0},"to":{"x":0,"y":1}}}'], 50 * 1024 * 1024);
      const botO = new ScriptedFakeBot([], 268435456, { turnId: 2, code: 'RESOURCE_LIMIT_EXCEEDED' });

      const result = await runMatchJob({
        job,
        database,
        storage,
        metrics,
        createBotPort: (_archive, reference) => {
          if (reference.submissionId === 'sub-x') return botX;
          return botO;
        },
      });

      // Verify game result is FORFEIT with winner X
      expect(result.outcome.reason).toBe('FORFEIT');
      expect(result.outcome.winnerSide).toBe('X');
      expect(result.outcome.forfeitedSide).toBe('O');
      expect(result.memoryPeakBytes?.O).toBe(268435456);

      // Verify Prometheus scrape contains AC-16 assertions
      const scraped = metrics.scrape();
      expect(scraped).toContain('# TYPE ott_bot_memory_peak_bytes gauge');
      expect(scraped).toContain(`ott_bot_memory_peak_bytes{match_id="${matchId}",side="O",status="forfeit"} 268435456`);
      expect(scraped).toContain('ott_match_attempts_total{policy_version="P2_BASELINE_V1",reason="FORFEIT",status="forfeit"} 1');
      expect(scraped).toContain('ott_bot_forfeits_total{reason="RESOURCE_LIMIT_EXCEEDED",side="O"} 1');

      // Assert no sensitive information in metrics
      assertMetricsSanitized(scraped);
    });
  });

  describe('4. Metrics Sanitization', () => {
    it('throws error when sensitive patterns are detected in metrics output', () => {
      expect(() => assertMetricsSanitized('ott_metric 1\npassword=secret')).toThrow('METRICS_SANITIZATION_FAILED');
      expect(() => assertMetricsSanitized('ott_metric 1\ndef malicious_bot():\n  pass')).toThrow('METRICS_SANITIZATION_FAILED');
      expect(() => assertMetricsSanitized('ott_metric 1\nTraceback (most recent call last):\n  File "bot.py"')).toThrow('METRICS_SANITIZATION_FAILED');
    });
  });

  describe('5. Sandbox Security Corpus Manifest Outcomes', () => {
    it('verifies expected outcome mappings for memory, fork, and cpu canaries', async () => {
      const manifestPath = join(root, 'src/bots/sandbox-corpus/manifest.json');
      const manifestContent = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        fixtures: Array<{ id: string; expected: string }>;
      };

      const memoryFixture = manifestContent.fixtures.find((f) => f.id === 'memory');
      const forkFixture = manifestContent.fixtures.find((f) => f.id === 'fork');
      const cpuFixture = manifestContent.fixtures.find((f) => f.id === 'cpu');

      expect(memoryFixture).toBeDefined();
      expect(memoryFixture?.expected).toBe('MEMORY_LIMIT');

      expect(forkFixture).toBeDefined();
      expect(forkFixture?.expected).toBe('PID_LIMIT');

      expect(cpuFixture).toBeDefined();
      expect(cpuFixture?.expected).toBe('CPU_LIMIT');

      // Verify mapping to runtime fault codes
      const outcomeMapping: Record<string, string> = {
        MEMORY_LIMIT: 'RESOURCE_LIMIT_EXCEEDED',
        PID_LIMIT: 'BOT_CRASHED',
        CPU_LIMIT: 'BOT_TIMEOUT',
      };
      expect(outcomeMapping[memoryFixture!.expected]).toBe('RESOURCE_LIMIT_EXCEEDED');
      expect(outcomeMapping[forkFixture!.expected]).toBe('BOT_CRASHED');
      expect(outcomeMapping[cpuFixture!.expected]).toBe('BOT_TIMEOUT');
    });
  });
});
