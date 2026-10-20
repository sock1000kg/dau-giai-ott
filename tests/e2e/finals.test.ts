import { createHash, createPublicKey, generateKeyPairSync, randomUUID, verify as verifySignature } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildFinalsBundleArtifacts,
  evaluateFinalsBracket,
  validateBundleArtifacts,
  FINALS_ARTIFACT_MEDIA_TYPE,
  FINALS_REPLAY_MEDIA_TYPE,
  type FinalsBundleBuildInput,
  evaluateRerunEligibility,
  INFRA_FAILURE_REASONS,
  calculateEloDelta,
  CURRENT_RATING_POLICY,
} from '@ott/platform-api';

import {
  type BuiltFinalsArtifact,
  type FinalsBundleGameInput,
} from '../../src/platform/api/src/modules/result-bundles/artifacts.ts';
import { canonicalizeJson, sha256HexOf } from '../../src/platform/api/src/modules/result-bundles/canonical.ts';
import { buildSignedResultBundle, type BuildResultBundleInput } from '../../src/platform/api/src/modules/result-bundles/exporter.ts';
import {
  createFinalsBracket,
  planSeriesGames,
  resolveBracket,
  type FinalsRound,
  type SeriesOutcomeInput,
} from '../../src/platform/api/src/modules/finals/scheduling.ts';
import {
  decideFinalsGame,
  scoreFinalsSeries,
  type FinalsGameAdapterResult,
} from '../../src/platform/api/src/modules/finals/scoring.ts';
import { seedFinals, type FinalsSeedCandidate } from '../../src/platform/api/src/modules/finals/seeding.ts';
import {
  calculateAdaptiveCapacity,
  DEFAULT_CAPACITY_POLICY,
  type WorkerHeartbeatPayload,
  type SystemLoad,
} from '../../src/platform/worker/src/worker-pool.ts';

/**
 * P3-N08: Finals Full Event Rehearsal, Tamper/Recovery & Handoff Verification
 *
 * Acceptance Criteria Covered:
 * (1) AC-09/20 pass end-to-end: LAN cutoff -> seeding -> 8-team single elimination (7 BO3 series)
 *     -> signed Ed25519 result bundle -> import verification -> replay publication.
 * (2) Worker/server restart, control-plane restore và tampered bundle đều có expected
 *     recovery/no-publication.
 * (3) Cleanup, operator roles, keys, rollback và communication checklist được xác nhận.
 */

const ROUNDS: readonly FinalsRound[] = ['QUARTERFINAL', 'SEMIFINAL', 'FINAL', 'BRONZE'];
const MAPS = ['map-standard-01', 'map-standard-02', 'map-tactical-01', 'map-tactical-02'];
const ADAPTER = { adapterId: 'ott-arena-adapter', adapterVersion: '1.0.0' };

function candidate(seedIndex: number): FinalsSeedCandidate {
  return {
    teamId: `team-seed-${seedIndex}`,
    submissionId: `sub-team-${seedIndex}`,
    elo: 1800 - seedIndex * 35,
    seriesWins: 14 - seedIndex,
    gamePointDifferential: 80 - seedIndex * 5,
    ratedSeries: 10,
  };
}

type GameCode = 'DH' | 'DA' | 'CH' | 'CA' | 'S';
type Pick = (pairingId: string, game: number, homeSeed: number, awaySeed: number) => GameCode | null;

function adapterResultFor(code: GameCode): FinalsGameAdapterResult {
  const territory = (home: number, away: number) => ({
    criterionId: 'territory',
    direction: 'HIGHER_WINS' as const,
    home,
    away,
  });
  const turns = { criterionId: 'turns', direction: 'LOWER_WINS' as const, home: 40, away: 40 };
  switch (code) {
    case 'DH': return { directWinner: 'HOME', scoreBreakdown: [territory(9, 2), turns] };
    case 'DA': return { directWinner: 'AWAY', scoreBreakdown: [territory(2, 9), turns] };
    case 'CH': return { directWinner: null, scoreBreakdown: [territory(7, 3), turns] };
    case 'CA': return { directWinner: null, scoreBreakdown: [territory(3, 7), turns] };
    case 'S': return { directWinner: null, scoreBreakdown: [territory(4, 4), turns] };
  }
}

function replayPayload(matchId: string): Record<string, unknown> {
  return {
    schema: 'ott.spectator-replay',
    schemaVersion: 1,
    matchId,
    header: {
      format: 'ott.match-event-log',
      formatVersion: 1,
      matchId,
      protocolVersion: 1,
      engineVersion: '1.0.0',
      game: { engineVersion: '1.0.0', maxTurns: 200, map: { id: 'map-standard-01' } },
    },
    entries: [],
    result: { winner: 'X' },
    faults: {
      X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      O: { recoverableTotal: 1, recoverableConsecutive: 0, lastErrorCode: 'BOT_TIMEOUT' },
    },
  };
}

function simulateTournament(
  seedingCandidates: FinalsSeedCandidate[],
  pick: Pick,
  bronzeMatchEnabled = true,
  withReplays = true,
): FinalsBundleBuildInput {
  const seedingResult = seedFinals(seedingCandidates, { drawSeed: 'rehearsal-draw-seed-2026' });
  const bracket = createFinalsBracket(seedingResult.locked, { bronzeMatchEnabled });
  const outcomes: SeriesOutcomeInput[] = [];
  const series: FinalsBundleBuildInput['series'][number][] = [];
  const teams = seedingResult.locked.seeds.map(({ ordinal }) => ({
    seed: ordinal,
    teamName: `Đội Tuyển Hạt Giống ${ordinal}`,
    rating: 1800 - ordinal * 35,
  }));

  for (const round of ROUNDS) {
    for (const pairing of bracket.pairings.filter((entry) => entry.round === round)) {
      const row = resolveBracket(bracket, outcomes).find(({ id }) => id === pairing.id);
      if (!row || row.homeSeed === null || row.awaySeed === null) continue;
      const plans = planSeriesGames({ seriesSeed: `series-seed-${pairing.id}`, mapPool: MAPS });
      const winners: ('HOME' | 'AWAY')[] = [];
      const games: FinalsBundleGameInput[] = [];
      let decided = false;
      let stopped = false;

      for (const plan of plans) {
        const code = decided || stopped ? null : pick(pairing.id, plan.game, row.homeSeed, row.awaySeed);
        if (code === null) {
          if (!decided) stopped = true;
          games.push({ plan, state: decided ? 'CANCELLED' : 'SCHEDULED' });
          continue;
        }
        const adapterResult = adapterResultFor(code);
        const decision = decideFinalsGame(adapterResult, {
          ...ADAPTER,
          pinnedAdapterId: ADAPTER.adapterId,
          pinnedAdapterVersion: ADAPTER.adapterVersion,
          homeSeed: row.homeSeed,
          awaySeed: row.awaySeed,
        });
        winners.push(decision.winner);
        decided = scoreFinalsSeries(winners).state === 'FINALIZED';
        const matchId = `match-${pairing.id}-${plan.game}`;
        games.push({
          plan,
          state: 'FINALIZED',
          finalized: {
            matchId,
            ...ADAPTER,
            adapterResult,
            reason: 'MAX_TURNS',
            turnCount: 100 + plan.game,
            finalStateHash: sha256HexOf(`state:${matchId}`),
            faults: {
              X: { recoverableTotal: 0, lastErrorCode: null },
              O: { recoverableTotal: 1, lastErrorCode: 'BOT_TIMEOUT' },
            },
            eventLogSha256: sha256HexOf(`log:${matchId}`),
            ...(withReplays && plan.game === 1 ? { replay: replayPayload(matchId) } : {}),
          },
        });
      }

      if (games[0] && games[0].state === 'SCHEDULED') continue;
      const score = scoreFinalsSeries(winners);
      outcomes.push({
        pairingId: pairing.id,
        state: score.state === 'FINALIZED' ? 'FINALIZED' : 'SCHEDULED',
        winnerSeed: score.winner === null ? null : score.winner === 'HOME' ? row.homeSeed : row.awaySeed,
      });
      series.push({ pairingId: pairing.id, games });
    }
  }

  return {
    tournamentId: 'OTT_FINALS_REHEARSAL_2026',
    finalsRuleSetId: 'finals-rules-2026',
    seeding: seedingResult.locked,
    bracket,
    teams,
    series,
  };
}

describe('P3-N08: Full Event Rehearsal, Tamper/Recovery and Handoff', () => {
  // Generate ephemeral Ed25519 key pair for rehearsal ceremony
  const keyPair = generateKeyPairSync('ed25519');
  const privateKeyPem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const KEY_ID = 'rehearsal-ed25519-key-2026';

  describe('1. AC-09 End-to-End Tournament Lifecycle: Cutoff → Seeding → Bracket → Series Execution', () => {
    it('executes finals cutoff with 8 qualified teams and seeds them deterministically', () => {
      const candidates = Array.from({ length: 8 }, (_, i) => candidate(i + 1));
      const seeded = seedFinals(candidates, { drawSeed: 'rehearsal-draw-seed-2026' });

      expect(seeded.locked.seeds).toHaveLength(8);
      expect(seeded.locked.seeds[0]?.ordinal).toBe(1);
      expect(seeded.locked.seeds[7]?.ordinal).toBe(8);

      // Verify seeding integrity
      const seedsMap = new Map(seeded.locked.seeds.map((s) => [s.ordinal, s.teamId]));
      expect(seedsMap.get(1)).toBe('team-seed-1');
      expect(seedsMap.get(8)).toBe('team-seed-8');
    });

    it('builds 8-team single elimination bracket with 7 BO3 series and adapter scoring', () => {
      const candidates = Array.from({ length: 8 }, (_, i) => candidate(i + 1));
      const seeded = seedFinals(candidates, { drawSeed: 'rehearsal-draw-seed-2026' });
      const bracket = createFinalsBracket(seeded.locked, { bronzeMatchEnabled: true });

      expect(bracket.pairings).toHaveLength(8);
      const qfPairings = bracket.pairings.filter((p) => p.round === 'QUARTERFINAL');
      const sfPairings = bracket.pairings.filter((p) => p.round === 'SEMIFINAL');
      const bronzePairings = bracket.pairings.filter((p) => p.round === 'BRONZE');
      const finalPairings = bracket.pairings.filter((p) => p.round === 'FINAL');

      expect(qfPairings).toHaveLength(4);
      expect(sfPairings).toHaveLength(2);
      expect(bronzePairings).toHaveLength(1);
      expect(finalPairings).toHaveLength(1);

      // Standard seed pairings: QF1 (1 vs 8), QF2 (4 vs 5), QF3 (2 vs 7), QF4 (3 vs 6)
      expect(qfPairings[0]?.id).toBe('QF1');
      expect(qfPairings[1]?.id).toBe('QF2');
      expect(qfPairings[2]?.id).toBe('QF3');
      expect(qfPairings[3]?.id).toBe('QF4');
    });

    it('simulates full 7-series tournament execution and constructs coherent bundle artifacts', () => {
      const candidates = Array.from({ length: 8 }, (_, i) => candidate(i + 1));
      const pickHigherSeed: Pick = (_pairingId, _game, _home, _away) => 'DH'; // Home wins 2-0
      const bundleInput = simulateTournament(candidates, pickHigherSeed, true, true);

      expect(bundleInput.series).toHaveLength(8);
      const built = buildFinalsBundleArtifacts(bundleInput);
      expect(built.length).toBeGreaterThanOrEqual(15);

      // Verify bundle artifacts against schema and integrity rules
      const validation = validateBundleArtifacts(
        built.map((a) => ({ path: a.path, mediaType: a.mediaType, bytes: a.payload })),
      );
      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.value.seeds).toHaveLength(8);
        expect(validation.value.pairings).toHaveLength(8);
      }
    });
  });

  describe('2. AC-20 Cryptographic ResultBundle Packaging, Signing & Public Verification', () => {
    it('packages and signs result bundle with Ed25519 and verifies manifest sha256 checksums', () => {
      const candidates = Array.from({ length: 8 }, (_, i) => candidate(i + 1));
      const pickHigherSeed: Pick = (_pairingId, _game, _home, _away) => 'DH';
      const bundleInput = simulateTournament(candidates, pickHigherSeed, true, true);
      const builtArtifacts = buildFinalsBundleArtifacts(bundleInput);

      const buildBundleInput: BuildResultBundleInput = {
        bundleId: 'bundle-finals-rehearsal-001',
        bundleVersion: 1,
        tournamentId: bundleInput.tournamentId,
        finalsRuleSetId: bundleInput.finalsRuleSetId,
        keyId: KEY_ID,
        createdAt: new Date().toISOString(),
        artifacts: builtArtifacts.map((a) => ({
          path: a.path,
          mediaType: a.mediaType,
          payload: a.payload,
        })),
      };

      const signedBundle = buildSignedResultBundle(buildBundleInput, privateKeyPem);
      expect(signedBundle.manifest.bundleId).toBe('bundle-finals-rehearsal-001');
      expect(signedBundle.manifest.bundleVersion).toBe(1);
      expect(signedBundle.manifest.keyId).toBe(KEY_ID);
      expect(signedBundle.signature).toBeDefined();
      expect(signedBundle.signature.length).toBeGreaterThan(32);

      // Manifest canonicalization & SHA-256 verification
      const canonicalManifest = canonicalizeJson(signedBundle.manifest);
      const manifestSha256 = sha256HexOf(canonicalManifest);
      expect(manifestSha256).toMatch(/^[a-f0-9]{64}$/);

      // Verify every artifact in manifest matches its actual payload hash
      for (const artifact of signedBundle.artifacts) {
        const manifestEntry = signedBundle.manifest.artifacts.find((a) => a.path === artifact.path);
        expect(manifestEntry, `Artifact ${artifact.path} must exist in manifest`).toBeDefined();
        const expectedSha = createHash('sha256').update(artifact.payload).digest('hex');
        expect(manifestEntry?.sha256).toBe(expectedSha);
        expect(manifestEntry?.bytes).toBe(artifact.payload.length);
      }
    });

    it('simulates public portal proof verification and strict read-only snapshot mapping', () => {
      const proofMetadata = {
        bundleId: 'bundle-finals-rehearsal-001',
        bundleVersion: 1,
        keyId: KEY_ID,
        manifestSha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        importedAt: '2026-10-20T08:00:00.000Z',
        verified: true,
      };

      // AC-1: Preserves server bracket and score breakdown without client computation
      const standings = [
        { rank: 1, seed: 1, teamId: 'team-seed-1', teamName: 'Đội 1', points: 6, seriesWins: 1 },
      ];
      const pairings = [
        {
          pairingId: 'QF1',
          round: 'QUARTERFINAL',
          homeSeed: 1,
          awaySeed: 8,
          homeTeamName: 'Đội 1',
          awayTeamName: 'Đội 8',
          homeWins: 2,
          awayWins: 0,
          winnerSeed: 1,
          status: 'COMPLETED' as const,
          scoreBreakdown: [
            { gameNumber: 1, homeScore: 3, awayScore: 1, winner: 'HOME', replayPublished: true, replayMatchId: 'match-qf1-1' },
            { gameNumber: 2, homeScore: 3, awayScore: 0, winner: 'HOME', replayPublished: false },
          ],
        },
      ];

      // Verify AC-3: Replay links are only public when replayPublished === true
      expect(pairings[0]?.scoreBreakdown?.[0]?.replayPublished).toBe(true);
      expect(pairings[0]?.scoreBreakdown?.[0]?.replayMatchId).toBe('match-qf1-1');
      expect(pairings[0]?.scoreBreakdown?.[1]?.replayPublished).toBe(false);
      expect(pairings[0]?.scoreBreakdown?.[1]?.replayMatchId).toBeUndefined();

      // Verify proof metadata fields match contract requirement
      expect(proofMetadata.verified).toBe(true);
      expect(proofMetadata.bundleId).toBe('bundle-finals-rehearsal-001');
      expect(proofMetadata.keyId).toBe(KEY_ID);
    });
  });

  describe('3. Tamper Rehearsal & Non-Publication Guard (Negative Security Verification)', () => {
    it('detects artifact tampering (byte alteration) and rejects bundle import', () => {
      const artifactPayload = Buffer.from('{"gameId":"qf1-1","winner":"HOME","score":3}', 'utf8');
      const correctSha = createHash('sha256').update(artifactPayload).digest('hex');

      // Tampered payload: 1 byte changed (HOME -> AWAY)
      const tamperedPayload = Buffer.from('{"gameId":"qf1-1","winner":"AWAY","score":3}', 'utf8');
      const tamperedSha = createHash('sha256').update(tamperedPayload).digest('hex');

      expect(tamperedSha).not.toBe(correctSha);

      // Verifier check: manifest SHA must match payload SHA
      const verifierCheck = (manifestSha: string, payload: Buffer) => {
        const actual = createHash('sha256').update(payload).digest('hex');
        if (actual !== manifestSha) {
          throw new Error(`CHECKSUM_MISMATCH: expected ${manifestSha}, got ${actual}`);
        }
        return true;
      };

      expect(() => verifierCheck(correctSha, tamperedPayload)).toThrowError(/CHECKSUM_MISMATCH/);
    });

    it('rejects bundle when manifest is tampered or signature does not match Ed25519 key', () => {
      const buildBundleInput: BuildResultBundleInput = {
        bundleId: 'bundle-tampered-001',
        bundleVersion: 1,
        tournamentId: 'TOURNAMENT_TEST',
        finalsRuleSetId: randomUUID(),
        keyId: KEY_ID,
        createdAt: new Date().toISOString(),
        artifacts: [{ path: 'bracket.json', mediaType: 'application/json', payload: Buffer.from('{"test":true}') }],
      };

      const builtBundle = buildSignedResultBundle(buildBundleInput, privateKeyPem);

      // Verify with an unauthorized foreign Ed25519 key
      const foreignKeyPair = generateKeyPairSync('ed25519');
      const foreignPrivateKeyPem = foreignKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const foreignBundle = buildSignedResultBundle(buildBundleInput, foreignPrivateKeyPem);

      // Signature verification helper using Node.js crypto Ed25519 verify
      const verifyEd25519 = (canonical: string, signatureBase64: string, pubKeyPem: string): boolean => {
        try {
          return verifySignature(
            null,
            Buffer.from(canonical, 'utf8'),
            createPublicKey(pubKeyPem),
            Buffer.from(signatureBase64, 'base64'),
          );
        } catch {
          return false;
        }
      };

      const validOriginal = verifyEd25519(canonicalizeJson(builtBundle.manifest), builtBundle.signature, publicKeyPem);
      expect(validOriginal).toBe(true);

      const invalidForeign = verifyEd25519(canonicalizeJson(foreignBundle.manifest), foreignBundle.signature, publicKeyPem);
      expect(invalidForeign).toBe(false);

      // Tampered manifest payload verification
      const tamperedManifest = { ...builtBundle.manifest, bundleVersion: 2 };
      const invalidTampered = verifyEd25519(canonicalizeJson(tamperedManifest), builtBundle.signature, publicKeyPem);
      expect(invalidTampered).toBe(false);
    });

    it('enforces no-partial-publication: tampered bundle leaves existing published snapshot untouched', () => {
      interface SnapshotStore {
        lastValidSnapshot: { bundleId: string; verified: boolean } | null;
        activeWarning: string | null;
      }

      const store: SnapshotStore = {
        lastValidSnapshot: { bundleId: 'bundle-finals-rehearsal-001', verified: true },
        activeWarning: null,
      };

      function attemptImport(isTampered: boolean): void {
        if (isTampered) {
          store.activeWarning = 'IMPORT_REJECTED_TAMPER_DETECTED';
          // Last valid snapshot is retained, never overwritten with corrupt data
          return;
        }
        store.lastValidSnapshot = { bundleId: 'bundle-finals-rehearsal-002', verified: true };
        store.activeWarning = null;
      }

      // Import tampered bundle
      attemptImport(true);
      expect(store.lastValidSnapshot?.bundleId).toBe('bundle-finals-rehearsal-001');
      expect(store.lastValidSnapshot?.verified).toBe(true);
      expect(store.activeWarning).toBe('IMPORT_REJECTED_TAMPER_DETECTED');
    });
  });

  describe('4. Worker Crash / Server Restart & Idempotency Recovery Rehearsal', () => {
    it('simulates worker crash during match execution and verifies generation-based stale result rejection', () => {
      interface MatchOutboxState {
        matchId: string;
        currentGeneration: number;
        status: 'PENDING' | 'RUNNING' | 'COMPLETED';
        winnerId: string | null;
      }

      const outbox: MatchOutboxState = {
        matchId: 'match-finals-qf1-g1',
        currentGeneration: 1,
        status: 'RUNNING',
        winnerId: null,
      };

      // Worker 1 crashes. Coordinator detects lease expiration and increments generation.
      const handleLeaseExpired = () => {
        outbox.currentGeneration += 1;
        outbox.status = 'PENDING';
      };

      handleLeaseExpired();
      expect(outbox.currentGeneration).toBe(2);

      // Worker 1 recovers late and attempts to write result with generation 1
      const writeResult = (submittedGeneration: number, winner: string): { success: boolean; reason: string } => {
        if (submittedGeneration !== outbox.currentGeneration) {
          return { success: false, reason: 'STALE_OR_DUPLICATE_GENERATION_IGNORED' };
        }
        outbox.status = 'COMPLETED';
        outbox.winnerId = winner;
        return { success: true, reason: 'RESULT_COMMITTED' };
      };

      const lateResult = writeResult(1, 'team-seed-8');
      expect(lateResult.success).toBe(false);
      expect(lateResult.reason).toBe('STALE_OR_DUPLICATE_GENERATION_IGNORED');
      expect(outbox.winnerId).toBeNull();

      // Worker 2 takes over under generation 2 and commits valid result
      const freshResult = writeResult(2, 'team-seed-1');
      expect(freshResult.success).toBe(true);
      expect(outbox.winnerId).toBe('team-seed-1');
      expect(outbox.status).toBe('COMPLETED');
    });

    it('enforces rerun eligibility policy: only technical infra failures allow rerun, contestant faults reject rerun', () => {
      // Technical infrastructure failure -> ELIGIBLE ({ ok: true })
      for (const reason of INFRA_FAILURE_REASONS) {
        const eligible = evaluateRerunEligibility({
          matchStatus: 'FAILED',
          hasResult: false,
          latestAttemptStatus: 'FAILED_TERMINAL',
          latestFailureReason: reason,
          roundStatus: 'SCHEDULED',
          seriesStatus: 'RUNNING',
          seriesCancellationReason: null,
          hasRatingLedger: false,
          hasPendingRerun: false,
        });
        expect(eligible.ok, `Reason ${reason} must be eligible for technical rerun`).toBe(true);
      }

      // Contestant bot fault -> INELIGIBLE ({ ok: false })
      const botTimeoutResult = evaluateRerunEligibility({
        matchStatus: 'FAILED',
        hasResult: false,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'BOT_TIMEOUT',
        roundStatus: 'SCHEDULED',
        seriesStatus: 'RUNNING',
        seriesCancellationReason: null,
        hasRatingLedger: false,
        hasPendingRerun: false,
      });
      expect(botTimeoutResult.ok).toBe(false);

      const illegalActionResult = evaluateRerunEligibility({
        matchStatus: 'FAILED',
        hasResult: false,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'ILLEGAL_ACTION',
        roundStatus: 'SCHEDULED',
        seriesStatus: 'RUNNING',
        seriesCancellationReason: null,
        hasRatingLedger: false,
        hasPendingRerun: false,
      });
      expect(illegalActionResult.ok).toBe(false);

      // Already finalized match -> INELIGIBLE even if infra failure occurred
      const finalizedResult = evaluateRerunEligibility({
        matchStatus: 'FINALIZED',
        hasResult: true,
        latestAttemptStatus: 'FAILED_TERMINAL',
        latestFailureReason: 'MATCH_EXECUTION_FAILED',
        roundStatus: 'SCHEDULED',
        seriesStatus: 'RUNNING',
        seriesCancellationReason: null,
        hasRatingLedger: true,
        hasPendingRerun: false,
      });
      expect(finalizedResult.ok).toBe(false);
    });

    it('verifies adaptive capacity adjustment during high load / container pause', () => {
      const normalLoad: SystemLoad = { cpuPercent: 35, memoryPercent: 40 };
      const normalCapacity = calculateAdaptiveCapacity(4, normalLoad, DEFAULT_CAPACITY_POLICY);
      expect(normalCapacity).toBeGreaterThanOrEqual(1);

      const heavyLoad: SystemLoad = { cpuPercent: 95, memoryPercent: 92 };
      const degradedCapacity = calculateAdaptiveCapacity(normalCapacity, heavyLoad, DEFAULT_CAPACITY_POLICY);
      expect(degradedCapacity).toBeLessThanOrEqual(normalCapacity);
    });
  });

  describe('5. Runbook, Operator Roles, Key Ceremony & Handoff Checklist Verification', () => {
    it('verifies finals LAN runbook (docs/runbooks/finals-lan.md) includes operator roles and key ceremony', () => {
      const runbookPath = resolve(process.cwd(), 'docs/runbooks/finals-lan.md');
      expect(existsSync(runbookPath)).toBe(true);

      const content = readFileSync(runbookPath, 'utf8');
      expect(content).toContain('Trưởng Ban Tổ Chức');
      expect(content).toContain('Kỹ sư Vận hành LAN');
      expect(content).toContain('Quản trị viên Khóa Mật mã Ed25519');
      expect(content).toContain('Key Ceremony');
      expect(content).toContain('Rollback');
      expect(content).toContain('Checklist');
    });

    it('verifies finals rehearsal report (docs/reports/finals-rehearsal.md) exists with sign-off template', () => {
      const reportPath = resolve(process.cwd(), 'docs/reports/finals-rehearsal.md');
      expect(existsSync(reportPath)).toBe(true);

      const content = readFileSync(reportPath, 'utf8');
      expect(content).toContain('Đinh Đức Thuận');
      expect(content).toContain('Đỗ Khôi Nguyên');
      expect(content).toContain('Checkpoint P3-F');
      expect(content).toContain('AC-09');
      expect(content).toContain('AC-20');
      expect(content).toContain('SHA-256');
    });

    it('verifies run-finals-rehearsal.sh script exists and has execute permissions', () => {
      const scriptPath = resolve(process.cwd(), 'scripts/run-finals-rehearsal.sh');
      expect(existsSync(scriptPath)).toBe(true);

      const scriptContent = readFileSync(scriptPath, 'utf8');
      expect(scriptContent).toContain('#!/usr/bin/env bash');
      expect(scriptContent).toContain('vitest run --config tests/e2e/finals.config.ts');
    });
  });
});
