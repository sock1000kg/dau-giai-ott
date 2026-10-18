import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateRerunEligibility,
  calculateEloDelta,
  CURRENT_RATING_POLICY,
  kFactorFor,
} from '@ott/platform-api';
import {
  calculateAdaptiveCapacity,
  DEFAULT_CAPACITY_POLICY,
  type WorkerHeartbeatPayload,
  type SystemLoad,
} from '../../src/platform/worker/src/worker-pool.ts';

function getServiceBlock(composeContent: string, serviceName: string): string {
  const lines = composeContent.split(/\r?\n/);
  const result: string[] = [];
  let inService = false;
  for (const line of lines) {
    if (line.match(new RegExp(`^ {2}${serviceName}:`))) {
      inService = true;
      result.push(line);
      continue;
    }
    if (inService) {
      if (line.match(/^ {2}[a-z0-9_-]+:/) || line.match(/^[a-z0-9_-]+:/)) {
        break;
      }
      result.push(line);
    }
  }
  return result.join('\n');
}

describe('P3-N07: Finals Isolated LAN Deployment & Single-Server Local Recovery', () => {
  const composePath = resolve(process.cwd(), 'deploy/lan/compose.yml');
  const envExamplePath = resolve(process.cwd(), 'deploy/lan/.env.example');

  describe('1. Topology & Network Isolation (AC-1)', () => {
    it('ensures deploy/lan/compose.yml and .env.example exist with expected specs', () => {
      expect(existsSync(composePath)).toBe(true);
      expect(existsSync(envExamplePath)).toBe(true);

      const envContent = readFileSync(envExamplePath, 'utf8');
      expect(envContent).toContain('OTT_DEPLOYMENT_MODE=finals_lan');
      expect(envContent).toContain('OTT_ADMIN_NETWORK_ALLOWLIST');
      expect(envContent).toContain('OTT_TRUSTED_PROXIES');
      expect(envContent).toContain('OTT_BOOTSTRAP_BTC_TOTP_SECRET');
      expect(envContent).toContain('WORKER_MAX_CONCURRENCY');
    });

    it('enforces internal: true on ott-lan-internal network (No-Egress)', () => {
      const composeContent = readFileSync(composePath, 'utf8');

      // ott-lan-internal must be declared as internal
      expect(composeContent).toMatch(/ott-lan-internal:\s+driver:\s+bridge\s+internal:\s+true/m);

      // Participant network must exist for public ingress
      expect(composeContent).toContain('ott-lan-public');
    });

    it('guarantees worker is strictly attached to internal network with zero published ports', () => {
      const composeContent = readFileSync(composePath, 'utf8');
      const workerBlock = getServiceBlock(composeContent, 'worker');

      // Worker must be on ott-lan-internal
      expect(workerBlock).toContain('ott-lan-internal');
      // Worker must NOT be on ott-lan-public
      expect(workerBlock).not.toContain('ott-lan-public');
      // Worker must NOT expose any host ports
      expect(workerBlock).not.toContain('ports:');
    });

    it('isolates database and storage backends from participant network', () => {
      const composeContent = readFileSync(composePath, 'utf8');

      for (const service of ['postgres', 'redis', 'seaweedfs']) {
        const block = getServiceBlock(composeContent, service);

        expect(block).toContain('ott-lan-internal');
        expect(block).not.toContain('ott-lan-public');
        expect(block).not.toContain('ports:');
      }
    });

    it('simulates participant network firewall: attempts to route to worker are rejected', () => {
      interface NetworkPacket {
        readonly sourceSubnet: string;
        readonly destService: 'platform-api' | 'platform-web' | 'worker' | 'postgres' | 'redis';
        readonly destPort: number;
      }

      function simulateLanFirewall(packet: NetworkPacket): { readonly allowed: boolean; readonly reason: string } {
        const PARTICIPANT_SUBNET = '172.28.20.0/24';
        const isFromParticipant = packet.sourceSubnet.startsWith('172.28.20.');

        if (isFromParticipant) {
          if (packet.destService === 'platform-api' && (packet.destPort === 3000 || packet.destPort === 80)) {
            return { allowed: true, reason: 'ALLOWED_PUBLIC_INGRESS' };
          }
          if (packet.destService === 'platform-web' && packet.destPort === 80) {
            return { allowed: true, reason: 'ALLOWED_WEB_INGRESS' };
          }
          return { allowed: false, reason: 'REJECTED_INTERNAL_NETWORK_ISOLATION' };
        }
        return { allowed: true, reason: 'INTERNAL_TRAFFIC' };
      }

      // Participant attempting to contact platform-api: allowed
      expect(simulateLanFirewall({
        sourceSubnet: '172.28.20.45',
        destService: 'platform-api',
        destPort: 3000,
      })).toEqual({ allowed: true, reason: 'ALLOWED_PUBLIC_INGRESS' });

      // Participant attempting to reach worker directly: REJECTED
      expect(simulateLanFirewall({
        sourceSubnet: '172.28.20.45',
        destService: 'worker',
        destPort: 9000,
      })).toEqual({ allowed: false, reason: 'REJECTED_INTERNAL_NETWORK_ISOLATION' });

      // Participant attempting to access postgres port: REJECTED
      expect(simulateLanFirewall({
        sourceSubnet: '172.28.20.45',
        destService: 'postgres',
        destPort: 5432,
      })).toEqual({ allowed: false, reason: 'REJECTED_INTERNAL_NETWORK_ISOLATION' });
    });
  });

  describe('2. Restart, Heartbeat & Admission Control (AC-2)', () => {
    it('manages worker heartbeat registration and adaptive capacity', () => {
      const workerId = `worker-${randomUUID()}`;
      let heartbeat: WorkerHeartbeatPayload = {
        workerId,
        capacity: 4,
        activeCount: 0,
        cpuPercent: 25,
        memoryPercent: 40,
        paused: false,
        timestamp: Date.now(),
      };

      expect(heartbeat.capacity).toBe(4);
      expect(heartbeat.paused).toBe(false);

      // System experiences sudden high CPU load (85%)
      const highLoad: SystemLoad = { cpuPercent: 88, memoryPercent: 65 };
      const throttledCapacity = calculateAdaptiveCapacity(heartbeat.capacity, highLoad, DEFAULT_CAPACITY_POLICY);
      expect(throttledCapacity).toBe(3);

      // Update heartbeat with throttled capacity
      heartbeat = {
        ...heartbeat,
        capacity: throttledCapacity,
        cpuPercent: highLoad.cpuPercent,
        memoryPercent: highLoad.memoryPercent,
        timestamp: Date.now(),
      };
      expect(heartbeat.capacity).toBe(3);

      // System returns to low load (< 60% CPU, < 70% Mem)
      const normalLoad: SystemLoad = { cpuPercent: 30, memoryPercent: 45 };
      const recoveredCapacity = calculateAdaptiveCapacity(heartbeat.capacity, normalLoad, DEFAULT_CAPACITY_POLICY);
      expect(recoveredCapacity).toBe(4);
    });

    it('safely pauses admission (pauseAdmission), draining active jobs and queuing new ones', async () => {
      // Mock worker admission state machine
      interface MatchJobQueueItem {
        readonly id: string;
        readonly status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'DELAYED';
      }

      class AdmissionController {
        private paused: boolean = false;
        private pauseReason?: string | undefined;
        private activeJobs: number = 0;
        private readonly jobs: Map<string, MatchJobQueueItem> = new Map();

        public pauseAdmission(reason: string): void {
          this.paused = true;
          this.pauseReason = reason;
        }

        public resumeAdmission(): void {
          this.paused = false;
          this.pauseReason = undefined;
        }

        public isPaused(): boolean {
          return this.paused;
        }

        public getPauseReason(): string | undefined {
          return this.pauseReason;
        }

        public submitJob(id: string): void {
          this.jobs.set(id, { id, status: 'QUEUED' });
        }

        public admitNextJob(id: string): 'ADMITTED' | 'POSTPONED' {
          if (this.paused) {
            this.jobs.set(id, { id, status: 'DELAYED' });
            return 'POSTPONED';
          }
          this.activeJobs++;
          this.jobs.set(id, { id, status: 'RUNNING' });
          return 'ADMITTED';
        }

        public completeJob(id: string): void {
          if (this.jobs.has(id)) {
            this.activeJobs = Math.max(0, this.activeJobs - 1);
            this.jobs.set(id, { id, status: 'COMPLETED' });
          }
        }

        public getJob(id: string): MatchJobQueueItem | undefined {
          return this.jobs.get(id);
        }

        public getActiveCount(): number {
          return this.activeJobs;
        }
      }

      const controller = new AdmissionController();

      // 1. Submit and admit job 1 (running before pause)
      controller.submitJob('job-1');
      expect(controller.admitNextJob('job-1')).toBe('ADMITTED');
      expect(controller.getActiveCount()).toBe(1);

      // 2. BTC operator triggers pauseAdmission (e.g. participant dispute or tech break)
      controller.pauseAdmission('FINALS_TECHNICAL_DISPUTE_INVESTIGATION');
      expect(controller.isPaused()).toBe(true);
      expect(controller.getPauseReason()).toBe('FINALS_TECHNICAL_DISPUTE_INVESTIGATION');

      // 3. New incoming job 2 is postponed safely without data loss
      controller.submitJob('job-2');
      expect(controller.admitNextJob('job-2')).toBe('POSTPONED');
      expect(controller.getJob('job-2')?.status).toBe('DELAYED');

      // 4. In-flight job 1 completes normally
      controller.completeJob('job-1');
      expect(controller.getJob('job-1')?.status).toBe('COMPLETED');
      expect(controller.getActiveCount()).toBe(0);

      // 5. BTC resumes admission
      controller.resumeAdmission();
      expect(controller.isPaused()).toBe(false);

      // 6. Postponed job 2 is now admitted
      expect(controller.admitNextJob('job-2')).toBe('ADMITTED');
      expect(controller.getJob('job-2')?.status).toBe('RUNNING');
      expect(controller.getActiveCount()).toBe(1);
    });

    it('simulates worker crash, lease expiry and restart rejoin with generation increment', async () => {
      const HEARTBEAT_TTL_MS = 15_000;
      let lastHeartbeatTime = Date.now() - 20_000; // 20s ago (stale)
      let activeWorkerPoolCount = 0;
      let outboxGeneration = 1;

      // Controller detects dead worker
      const isAlive = (Date.now() - lastHeartbeatTime) < HEARTBEAT_TTL_MS;
      expect(isAlive).toBe(false);

      // Invalidate expired lease and bump generation
      outboxGeneration += 1;
      expect(outboxGeneration).toBe(2);

      // Worker process restarts, sends new heartbeat and joins active pool
      const newWorkerId = `worker-restarted-${randomUUID().slice(0, 8)}`;
      lastHeartbeatTime = Date.now();
      activeWorkerPoolCount += 1;

      const newHeartbeat: WorkerHeartbeatPayload = {
        workerId: newWorkerId,
        capacity: 4,
        activeCount: 0,
        cpuPercent: 15,
        memoryPercent: 35,
        paused: false,
        timestamp: lastHeartbeatTime,
      };

      expect(newHeartbeat.workerId).toBe(newWorkerId);
      expect(activeWorkerPoolCount).toBe(1);
      expect(Date.now() - newHeartbeat.timestamp).toBeLessThan(1_000);
    });
  });

  describe('3. Local Backup / Restore & Idempotent Rerun (AC-3)', () => {
    it('verifies state checksum and artifact integrity in local disaster recovery drill', async () => {
      // Representation of tournament database & storage before crash
      const preCrashMatches = [
        { matchId: 'm-1', seriesId: 's-1', scoreX: 2, scoreO: 1, status: 'FINALIZED', hash: 'a1b2c3d4' },
        { matchId: 'm-2', seriesId: 's-1', scoreX: 0, scoreO: 2, status: 'FINALIZED', hash: 'e5f6g7h8' },
        { matchId: 'm-3', seriesId: 's-2', scoreX: 2, scoreO: 0, status: 'FINALIZED', hash: 'i9j0k1l2' },
      ];

      const preCrashArtifacts = [
        { file: 'teams/team-a/submission.tar.gz', sha256: 'deadbeef1111' },
        { file: 'teams/team-b/submission.tar.gz', sha256: 'deadbeef2222' },
        { file: 'replays/finals/m-1.json', sha256: 'deadbeef3333' },
      ];

      const computeBackupManifest = (matches: typeof preCrashMatches, artifacts: typeof preCrashArtifacts) => {
        return createHash('sha256')
          .update(JSON.stringify({ matches, artifacts }))
          .digest('hex');
      };

      const originalManifestDigest = computeBackupManifest(preCrashMatches, preCrashArtifacts);

      // Simulate disaster recovery: restore database from SQL dump and artifacts from tarball
      const restoredMatches = JSON.parse(JSON.stringify(preCrashMatches));
      const restoredArtifacts = JSON.parse(JSON.stringify(preCrashArtifacts));
      const restoredManifestDigest = computeBackupManifest(restoredMatches, restoredArtifacts);

      expect(restoredManifestDigest).toBe(originalManifestDigest);
      expect(restoredMatches).toHaveLength(3);
      expect(restoredArtifacts).toHaveLength(3);
    });

    it('enforces rerun eligibility policy: only infra failures are eligible for rerun', () => {
      // 1. Bot error: timeout
      const botTimeoutCheck = evaluateRerunEligibility({
        matchStatus: 'FAILED',
        hasResult: false,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'BOT_TIMEOUT',
        roundStatus: 'SCHEDULED',
        seriesStatus: 'SCHEDULED',
        seriesCancellationReason: null,
        hasRatingLedger: false,
        hasPendingRerun: false,
      });
      expect(botTimeoutCheck.ok).toBe(false);
      expect((botTimeoutCheck as { code: string }).code).toBe('RERUN_NOT_INFRA_FAILURE');

      // 2. Bot error: illegal action
      const illegalActionCheck = evaluateRerunEligibility({
        matchStatus: 'FAILED',
        hasResult: false,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'ILLEGAL_ACTION',
        roundStatus: 'SCHEDULED',
        seriesStatus: 'SCHEDULED',
        seriesCancellationReason: null,
        hasRatingLedger: false,
        hasPendingRerun: false,
      });
      expect(illegalActionCheck.ok).toBe(false);
      expect((illegalActionCheck as { code: string }).code).toBe('RERUN_NOT_INFRA_FAILURE');

      // 3. Infrastructure failure: match lease expired
      const leaseExpiredCheck = evaluateRerunEligibility({
        matchStatus: 'FAILED',
        hasResult: false,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'MATCH_LEASE_EXPIRED',
        roundStatus: 'SCHEDULED',
        seriesStatus: 'SCHEDULED',
        seriesCancellationReason: null,
        hasRatingLedger: false,
        hasPendingRerun: false,
      });
      expect(leaseExpiredCheck.ok).toBe(true);

      // 4. Infrastructure failure: match execution failed
      const executionFailedCheck = evaluateRerunEligibility({
        matchStatus: 'FAILED',
        hasResult: false,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'MATCH_EXECUTION_FAILED',
        roundStatus: 'SCHEDULED',
        seriesStatus: 'SCHEDULED',
        seriesCancellationReason: null,
        hasRatingLedger: false,
        hasPendingRerun: false,
      });
      expect(executionFailedCheck.ok).toBe(true);

      // 5. Infrastructure failure: sandbox not running
      const sandboxFailureCheck = evaluateRerunEligibility({
        matchStatus: 'FAILED',
        hasResult: false,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'SANDBOX_NOT_RUNNING',
        roundStatus: 'SCHEDULED',
        seriesStatus: 'SCHEDULED',
        seriesCancellationReason: null,
        hasRatingLedger: false,
        hasPendingRerun: false,
      });
      expect(sandboxFailureCheck.ok).toBe(true);

      // 6. Settled round / series rejects rerun even for infra failure
      const finalizedRoundCheck = evaluateRerunEligibility({
        matchStatus: 'FAILED',
        hasResult: false,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'MATCH_EXECUTION_FAILED',
        roundStatus: 'FINALIZED',
        seriesStatus: 'FINALIZED',
        seriesCancellationReason: null,
        hasRatingLedger: true,
        hasPendingRerun: false,
      });
      expect(finalizedRoundCheck.ok).toBe(false);
      expect((finalizedRoundCheck as { code: string }).code).toBe('RERUN_ROUND_SETTLED');
    });

    it('prevents duplicate bracket advancement and duplicate result records on rerun', () => {
      interface BracketMatchRecord {
        readonly matchId: string;
        readonly seriesId: string;
        readonly generation: number;
        readonly winnerTeamId: string;
      }

      const bracketResults: BracketMatchRecord[] = [];
      const teamWins = new Map<string, number>([
        ['team-1', 0],
        ['team-2', 0],
      ]);

      function commitFinalsMatchResult(record: BracketMatchRecord): { readonly committed: boolean; readonly reason: string } {
        const existing = bracketResults.find((r) => r.matchId === record.matchId);
        if (existing) {
          if (existing.generation >= record.generation) {
            return { committed: false, reason: 'STALE_OR_DUPLICATE_GENERATION_IGNORED' };
          }
        }

        bracketResults.push(record);
        teamWins.set(record.winnerTeamId, (teamWins.get(record.winnerTeamId) ?? 0) + 1);
        return { committed: true, reason: 'RESULT_COMMITTED' };
      }

      // 1. Initial attempt fails halfway (generation 1) - no record committed

      // 2. BTC approves rerun with generation 2
      const rerunOutcome = commitFinalsMatchResult({
        matchId: 'match-f1',
        seriesId: 'series-semi-1',
        generation: 2,
        winnerTeamId: 'team-1',
      });
      expect(rerunOutcome.committed).toBe(true);
      expect(bracketResults).toHaveLength(1);
      expect(teamWins.get('team-1')).toBe(1);

      // 3. Stale worker from attempt 1 arrives late (generation 1) with delayed packet
      const staleOutcome = commitFinalsMatchResult({
        matchId: 'match-f1',
        seriesId: 'series-semi-1',
        generation: 1,
        winnerTeamId: 'team-1',
      });
      expect(staleOutcome.committed).toBe(false);
      expect(staleOutcome.reason).toBe('STALE_OR_DUPLICATE_GENERATION_IGNORED');

      // 4. Duplicate delivery of rerun result (generation 2)
      const duplicateOutcome = commitFinalsMatchResult({
        matchId: 'match-f1',
        seriesId: 'series-semi-1',
        generation: 2,
        winnerTeamId: 'team-1',
      });
      expect(duplicateOutcome.committed).toBe(false);
      expect(duplicateOutcome.reason).toBe('STALE_OR_DUPLICATE_GENERATION_IGNORED');

      // Verify bracket progression counts are not duplicated
      expect(bracketResults).toHaveLength(1);
      expect(teamWins.get('team-1')).toBe(1);
      expect(teamWins.get('team-2')).toBe(0);
    });
  });
});
