import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  runKeygen,
  runFingerprint,
  runVerify,
  runDemoExport,
  runExportWithReader,
  createPgFinalsReader,
  createFilesystemEventLogLoader,
  createS3EventLogLoader,
} from '../finals-bundle.mjs';
import { createSyntheticDemoTournament } from '../../src/platform/api/src/modules/result-bundles/demo-bundle.ts';
import { sha256HexOf } from '../../src/platform/api/src/modules/result-bundles/canonical.ts';
import { parseSpectatorReplay } from '../../src/platform/web/src/features/spectator/replay-schema.ts';
import { DEFAULT_LIMITS } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import { CoreGameAdapter, ScriptedBot, runMatch, serializeEventLog } from '@ott/match-runner';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'finals-bundle-test-'));
}

describe('finals-bundle CLI unit tests', () => {
  describe('keygen', () => {
    it('creates private and public key files with correct permissions and returns fingerprint', () => {
      const tmpDir = makeTempDir();
      try {
        const keyId = 'test-key-1';
        const result = runKeygen({ outDir: tmpDir, keyId });

        expect(result.keyId).toBe(keyId);
        expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(fs.existsSync(result.privateKeyPath)).toBe(true);
        expect(fs.existsSync(result.publicKeyPath)).toBe(true);

        // Check file modes (0600 = 33152, 0644 = 33188 in octal mask 0777)
        const privateStat = fs.statSync(result.privateKeyPath);
        const publicStat = fs.statSync(result.publicKeyPath);
        expect(privateStat.mode & 0o777).toBe(0o600);
        expect(publicStat.mode & 0o777).toBe(0o644);

        // Verify private key is not printed or stored in public key
        const publicContent = fs.readFileSync(result.publicKeyPath, 'utf8');
        expect(publicContent).toContain('-----BEGIN PUBLIC KEY-----');
        expect(publicContent).not.toContain('PRIVATE');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('refuses to overwrite existing key files', () => {
      const tmpDir = makeTempDir();
      try {
        const keyId = 'test-key-overwrite';
        runKeygen({ outDir: tmpDir, keyId });

        expect(() => runKeygen({ outDir: tmpDir, keyId })).toThrow(/Refusing to overwrite/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('validates keyId characters', () => {
      const tmpDir = makeTempDir();
      try {
        expect(() => runKeygen({ outDir: tmpDir, keyId: 'invalid key ID!' })).toThrow(
          'RESULT_BUNDLE_KEY_ID_INVALID',
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('fingerprint', () => {
    it('computes identical fingerprint for PEM string and file path', () => {
      const tmpDir = makeTempDir();
      try {
        const keyId = 'test-fingerprint-key';
        const keygenResult = runKeygen({ outDir: tmpDir, keyId });

        // From file
        const fpFromFile = runFingerprint({ publicPemInput: keygenResult.publicKeyPath });
        expect(fpFromFile.fingerprint).toBe(keygenResult.fingerprint);

        // From raw PEM string
        const pemContent = fs.readFileSync(keygenResult.publicKeyPath, 'utf8');
        const fpFromString = runFingerprint({ publicPemInput: pemContent });
        expect(fpFromString.fingerprint).toBe(keygenResult.fingerprint);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('demo-export and verify', () => {
    it('generates a synthetic demo bundle and successfully verifies it', async () => {
      const tmpDir = makeTempDir();
      try {
        const bundleOut = path.join(tmpDir, 'demo-bundle.json');
        const keyDir = path.join(tmpDir, 'keys');

        const exportResult = await runDemoExport({ outFile: bundleOut, keyDir });
        expect(exportResult.bundleId).toBe('demo-finals-bundle-2026');
        expect(exportResult.artifacts).toBeGreaterThanOrEqual(15);
        expect(fs.existsSync(bundleOut)).toBe(true);

        const publicKeyFile = path.join(keyDir, 'demo-finals-key.public.pem');
        expect(fs.existsSync(publicKeyFile)).toBe(true);

        // Verify using offline verify command
        const verifyResult = runVerify({ bundleFile: bundleOut, publicPemInput: publicKeyFile });
        expect(verifyResult.valid).toBe(true);
        expect(verifyResult.bundleId).toBe('demo-finals-bundle-2026');
        expect(verifyResult.fingerprint).toBe(exportResult.fingerprint);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('produces byte-identical bundle JSON across two runs with the same key', async () => {
      const tmpDir = makeTempDir();
      try {
        const bundle1 = path.join(tmpDir, 'bundle1.json');
        const bundle2 = path.join(tmpDir, 'bundle2.json');
        const keyDir = path.join(tmpDir, 'keys');

        await runDemoExport({ outFile: bundle1, keyDir });
        await runDemoExport({ outFile: bundle2, keyDir });

        const content1 = fs.readFileSync(bundle1, 'utf8');
        const content2 = fs.readFileSync(bundle2, 'utf8');
        expect(content1).toBe(content2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('detects tampering in bundle artifacts during verify', async () => {
      const tmpDir = makeTempDir();
      try {
        const bundleOut = path.join(tmpDir, 'tamper-bundle.json');
        const keyDir = path.join(tmpDir, 'keys');
        await runDemoExport({ outFile: bundleOut, keyDir });

        const raw = JSON.parse(fs.readFileSync(bundleOut, 'utf8'));
        // Tamper bracket.json payload
        raw.artifacts[0].payloadBase64 = Buffer.from('{"tampered":true}').toString('base64');
        fs.writeFileSync(bundleOut, JSON.stringify(raw), 'utf8');

        const publicKeyFile = path.join(keyDir, 'demo-finals-key.public.pem');
        expect(() => runVerify({ bundleFile: bundleOut, publicPemInput: publicKeyFile })).toThrow(
          'RESULT_BUNDLE_ARTIFACT_TAMPERED',
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('detects signature mismatch when verified with wrong public key', async () => {
      const tmpDir = makeTempDir();
      try {
        const bundleOut = path.join(tmpDir, 'bundle.json');
        await runDemoExport({ outFile: bundleOut, keyDir: path.join(tmpDir, 'keys1') });

        // Generate another key pair
        const otherKeyDir = path.join(tmpDir, 'keys2');
        const otherKey = runKeygen({ outDir: otherKeyDir, keyId: 'other-key' });

        expect(() => runVerify({ bundleFile: bundleOut, publicPemInput: otherKey.publicKeyPath })).toThrow(
          'RESULT_BUNDLE_SIGNATURE_INVALID',
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('produces demo match artifacts consistent with their embedded replays and source logs', async () => {
      const tmpDir = makeTempDir();
      try {
        const bundleOut = path.join(tmpDir, 'demo-consistency.json');
        await runDemoExport({ outFile: bundleOut, keyDir: path.join(tmpDir, 'keys') });

        const bundle = JSON.parse(fs.readFileSync(bundleOut, 'utf8'));
        const artifactsMap = new Map();
        for (const a of bundle.artifacts) {
          const json = JSON.parse(Buffer.from(a.payloadBase64, 'base64').toString('utf8'));
          artifactsMap.set(a.path, json);
        }

        const matchPaths = Array.from(artifactsMap.keys()).filter((p) => p.startsWith('matches/'));
        expect(matchPaths.length).toBeGreaterThanOrEqual(16);

        // Deterministic re-run exposing the un-projected source logs.
        const sourceLogs = new Map();
        await createSyntheticDemoTournament({ sourceLogs });
        expect(sourceLogs.size).toBe(matchPaths.length);

        const hashes = new Set();
        let nonDraws = 0;
        for (const matchPath of matchPaths) {
          const match = artifactsMap.get(matchPath);
          expect(match.result.reason).not.toBe('FORFEIT');
          expect(match.result.turnCount).toBeGreaterThan(1);

          const replay = artifactsMap.get(`replays/${match.matchId}.json`);
          expect(replay).toBeDefined();
          expect(replay.result.finalStateHash).toBe(match.result.finalStateHash);
          expect(replay.result.reason).toBe(match.result.reason);
          expect(replay.result.turnCount).toBe(match.result.turnCount);
          expect(replay.header.protocolVersion).toBe(2);
          expect(replay.header.formatVersion).toBe(2);
          expect(Array.isArray(replay.timing)).toBe(true);
          expect(replay.timing.length).toBeGreaterThan(0);
          const parsed = parseSpectatorReplay(replay);
          expect(parsed.schemaVersion).toBe(2);

          // Direct winner in the match artifact equals the replay's real winner (null = draw).
          expect(match.adapter.directWinnerSide).toBe(replay.result.winnerSide);
          if (replay.result.winnerSide !== null) nonDraws += 1;
          if (match.result.reason === 'REACHED_GOAL') expect(replay.result.winnerSide).not.toBeNull();

          // Digest is of the serialized source log, not just well-formed hex.
          const sourceLog = sourceLogs.get(match.matchId);
          expect(sourceLog).toBeDefined();
          expect(match.eventLogSha256).toBe(sha256HexOf(Buffer.from(serializeEventLog(sourceLog), 'utf8')));
          expect(sourceLog.footer.result.finalStateHash).toBe(match.result.finalStateHash);

          // Criteria come from the real final state: no invented constants.
          const ids = match.adapter.criteria.map((c) => c.id);
          expect(ids).toEqual(['pieces-left', 'goal-distance']);
          const pieces = match.adapter.criteria[0];
          expect(pieces.x).toBeGreaterThanOrEqual(1);
          expect(pieces.o).toBeGreaterThanOrEqual(1);
          hashes.add(match.result.finalStateHash);
        }
        expect(hashes.size).toBeGreaterThan(1);
        expect(nonDraws).toBeGreaterThanOrEqual(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('export with fake database reader', () => {
    it('successfully exports and signs bundle including replays and correct HOME/AWAY directWinner', async () => {
      const tmpDir = makeTempDir();
      try {
        const keygenResult = runKeygen({ outDir: tmpDir, keyId: 'export-key' });
        const fakeTournament = await createSyntheticDemoTournament();

        const fakeReader = {
          async loadFinalsExportData({ competitionId, round }) {
            expect(competitionId).toBe('comp-001');
            expect(round).toBe('ALL');
            return fakeTournament;
          },
        };

        const bundleOut = path.join(tmpDir, 'exported-bundle.json');
        const result = await runExportWithReader(fakeReader, {
          competitionId: 'comp-001',
          round: 'ALL',
          privateKeyPem: fs.readFileSync(keygenResult.privateKeyPath, 'utf8'),
          keyId: 'export-key',
          bundleId: 'bundle-finals-real-001',
          bundleVersion: 1,
          outFile: bundleOut,
        });

        expect(result.bundleId).toBe('bundle-finals-real-001');
        expect(result.artifacts).toBeGreaterThanOrEqual(15);
        expect(fs.existsSync(bundleOut)).toBe(true);

        const bundle = JSON.parse(fs.readFileSync(bundleOut, 'utf8'));
        // Verify replays are present in artifacts
        const replayPaths = bundle.artifacts
          .map((a) => a.path)
          .filter((p) => p.startsWith('replays/'));
        expect(replayPaths.length).toBeGreaterThan(0);

        // Verify with runVerify
        const verifyResult = runVerify({
          bundleFile: bundleOut,
          publicPemInput: keygenResult.publicKeyPath,
        });
        expect(verifyResult.valid).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('refuses export when data reader reports round not finalized', async () => {
      const tmpDir = makeTempDir();
      try {
        const keygenResult = runKeygen({ outDir: tmpDir, keyId: 'export-key' });
        const fakeReader = {
          async loadFinalsExportData() {
            throw new Error('ROUND_NOT_FINALIZED: Series QF2 is RUNNING');
          },
        };

        await expect(
          runExportWithReader(fakeReader, {
            competitionId: 'comp-002',
            round: 'QUARTERFINAL',
            privateKeyPem: fs.readFileSync(keygenResult.privateKeyPath, 'utf8'),
            keyId: 'export-key',
            bundleId: 'bundle-finals-002',
            outFile: path.join(tmpDir, 'out.json'),
          }),
        ).rejects.toThrow('ROUND_NOT_FINALIZED');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('refuses export if any forbidden field (seed, secret, credentials) is detected in tournament data', async () => {
      const tmpDir = makeTempDir();
      try {
        const keygenResult = runKeygen({ outDir: tmpDir, keyId: 'export-key' });
        const fakeTournament = await createSyntheticDemoTournament();
        // Inject forbidden key into match replay artifact
        fakeTournament.series[0].games[0].finalized.replay.secretPassword = 'leaked-password';

        const fakeReader = {
          async loadFinalsExportData() {
            return fakeTournament;
          },
        };

        await expect(
          runExportWithReader(fakeReader, {
            competitionId: 'comp-003',
            round: 'ALL',
            privateKeyPem: fs.readFileSync(keygenResult.privateKeyPath, 'utf8'),
            keyId: 'export-key',
            bundleId: 'bundle-finals-003',
            outFile: path.join(tmpDir, 'out.json'),
          }),
        ).rejects.toThrow('FORBIDDEN_FIELD');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('createPgFinalsReader (database reader and mapper)', () => {
    async function createValidMatchEventLog(matchId) {
      const game = new CoreGameAdapter();
      const gameConfig = { gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 10 };
      const firstState = game.create(gameConfig);
      const firstAction = game.listLegalActions(firstState, 'X')[0];
      const report = await runMatch(
        { matchId, seed: `test-${matchId}`, game: gameConfig, limits: { ...DEFAULT_LIMITS, maxTurns: 10 } },
        { game, bots: { X: new ScriptedBot({ replies: [{ kind: 'action', action: firstAction }] }), O: new ScriptedBot({ replies: [] }) } },
      );
      return {
        rawLog: JSON.stringify(report.log),
        finalStateHash: report.log.footer.result.finalStateHash,
      };
    }

    it('maps directWinner HOME/AWAY both ways (home_side X and O), includes replays, and strips secrets from artifacts', async () => {
      const tmpDir = makeTempDir();
      try {
        const keygenResult = runKeygen({ outDir: tmpDir, keyId: 'export-key' });
        const secretDrawSeed = 'ultra-secret-draw-seed-1234';
        const privateStorageKey = 's3://offline-bucket/replays/private-key-01.json';

        const synthetic = await createSyntheticDemoTournament();
        const logs = new Map();
        const logHashes = new Map();
        const logSha256s = new Map();

        // Populate logs for all synthetic matches
        for (const s of synthetic.series) {
          for (const g of s.games) {
            if (g.state === 'FINALIZED') {
              const mLog = await createValidMatchEventLog(g.finalized.matchId);
              logs.set(`key-${g.finalized.matchId}`, mLog.rawLog);
              logHashes.set(g.finalized.matchId, mLog.finalStateHash);
              logSha256s.set(g.finalized.matchId, sha256HexOf(Buffer.from(mLog.rawLog, 'utf8')));
            }
          }
        }

        const mockClient = {
          async query(sql, params) {
            const text = sql.trim();
            if (text.startsWith('SELECT id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash FROM finals_competitions')) {
              return {
                rows: [
                  {
                    id: 'comp-100',
                    tournament_stage: 'STAGE_2026',
                    status: 'IN_PROGRESS',
                    rule_set_id: 'rule-test-1',
                    bronze_match_enabled: true,
                    draw_seed: secretDrawSeed,
                    seeding_hash: 'a'.repeat(64),
                  },
                ],
              };
            }

            if (text.startsWith('SELECT rules FROM finals_rule_sets')) {
              return {
                rows: [
                  {
                    rules: {
                      gameAdapter: {
                        adapterId: 'custom-arena-adapter',
                        adapterVersion: '2.3.4',
                      },
                    },
                  },
                ],
              };
            }

            if (text.includes('FROM finals_seeds s JOIN teams t')) {
              return {
                rows: synthetic.teams.map((t) => ({
                  ordinal: t.seed,
                  team_id: `team-0${t.seed}`,
                  submission_id: `sub-0${t.seed}`,
                  elo: t.rating,
                  team_name: t.teamName,
                })),
              };
            }

            if (text.startsWith('SELECT id, pairing_id, round, slot, status, series_seed FROM finals_series')) {
              return {
                rows: synthetic.bracket.pairings.map((p, idx) => ({
                  id: `series-${idx + 1}`,
                  pairing_id: p.id,
                  round: p.round,
                  slot: p.slot,
                  status: 'FINALIZED',
                  series_seed: `seed-${p.id}`,
                })),
              };
            }

            if (text.startsWith('SELECT id, game, home_side, away_side, map_id, status, match_id, decided_by, decided_criterion_id, score_breakdown, winner_side FROM finals_series_games')) {
              const seriesId = params?.[0];
              const idx = parseInt(seriesId.replace('series-', ''), 10) - 1;
              const seriesItem = synthetic.series[idx];
              if (!seriesItem) return { rows: [] };

              const rows = seriesItem.games.map((g) => {
                const direct = g.finalized?.adapterResult?.directWinner ?? null;
                // A drawn game is decided by criteria/seed, so DB `decided_by` is not DIRECT.
                const winner_side = direct === 'AWAY' ? g.plan.awaySide : g.plan.homeSide;

                return {
                  id: `game-${seriesId}-${g.plan.game}`,
                  game: g.plan.game,
                  home_side: g.plan.homeSide,
                  away_side: g.plan.awaySide,
                  map_id: g.plan.mapId,
                  status: g.state,
                  match_id: g.state === 'FINALIZED' ? g.finalized.matchId : null,
                  decided_by: direct === null ? 'CRITERION' : 'DIRECT',
                  winner_side,
                  score_breakdown: g.state === 'FINALIZED' ? g.finalized.adapterResult.scoreBreakdown : [],
                };
              });

              return { rows };
            }

            if (text.startsWith('SELECT match_id, winner_side, reason, turn_count, final_state_hash, event_log_sha256, event_log_key, faults FROM match_results')) {
              const matchId = params?.[0];
              let matchGame;
              let matchHomeSide;
              let matchAwaySide;
              for (const s of synthetic.series) {
                for (const g of s.games) {
                  if (g.state === 'FINALIZED' && g.finalized.matchId === matchId) {
                    matchGame = g.finalized;
                    matchHomeSide = g.plan.homeSide;
                    matchAwaySide = g.plan.awaySide;
                    break;
                  }
                }
              }

              const storageKey = matchId === synthetic.series[0].games[0].finalized.matchId
                ? privateStorageKey
                : `key-${matchId}`;

              if (storageKey === privateStorageKey) {
                logs.set(privateStorageKey, logs.get(`key-${matchId}`));
              }

              const direct = matchGame?.adapterResult?.directWinner ?? null;
              const winnerSide = direct === null ? null : direct === 'HOME' ? matchHomeSide : matchAwaySide;

              return {
                rows: [
                  {
                    match_id: matchId,
                    winner_side: winnerSide,
                    reason: matchGame?.reason ?? 'FORFEIT',
                    turn_count: matchGame?.turnCount ?? 1,
                    final_state_hash: logHashes.get(matchId) ?? matchGame?.finalStateHash ?? '0'.repeat(64),
                    event_log_sha256: `sha256:${logSha256s.get(matchId) ?? matchGame?.eventLogSha256 ?? '0'.repeat(64)}`,
                    event_log_key: storageKey,
                    faults: matchGame?.faults ?? { X: { recoverableTotal: 0, lastErrorCode: null }, O: { recoverableTotal: 0, lastErrorCode: null } },
                  },
                ],
              };
            }

            return { rows: [] };
          },
        };

        const reader = await createPgFinalsReader(mockClient, {
          eventLogLoader: async (key) => logs.get(key),
        });

        const data = await reader.loadFinalsExportData({ competitionId: 'comp-100', round: 'ALL' });

        // Assert HOME/AWAY mapping for every finalized game equals the source tournament's, and that the
        // fixture covers HOME and AWAY winners with both home_side X and O, plus drawn games (null).
        const seen = new Set();
        for (const sourceSeries of synthetic.series) {
          const readGames = data.series.find((s) => s.pairingId === sourceSeries.pairingId).games;
          sourceSeries.games.forEach((g, i) => {
            if (g.state !== 'FINALIZED') return;
            const read = readGames[i];
            expect(read.plan.homeSide).toBe(g.plan.homeSide);
            expect(read.finalized.adapterResult.directWinner ?? null).toBe(g.finalized.adapterResult.directWinner ?? null);
            seen.add(`${g.plan.homeSide}:${g.finalized.adapterResult.directWinner ?? 'DRAW'}`);
          });
        }
        for (const combo of ['X:HOME', 'X:AWAY', 'O:HOME', 'O:AWAY', 'X:DRAW', 'O:DRAW']) {
          expect(seen, combo).toContain(combo);
        }
        const qf1Games = data.series.find((s) => s.pairingId === 'QF1').games;

        // Assert rule set adapter is taken from finals_rule_sets
        expect(qf1Games[0].finalized.adapterId).toBe('custom-arena-adapter');
        expect(qf1Games[0].finalized.adapterVersion).toBe('2.3.4');

        // Assert replays are included
        expect(qf1Games[0].finalized.replay).toBeDefined();

        // Run full export with reader to verify artifacts are built and free of seeds/storage keys
        const bundleOut = path.join(tmpDir, 'exported-pg.json');
        const exportResult = await runExportWithReader(reader, {
          competitionId: 'comp-100',
          round: 'ALL',
          privateKeyPem: fs.readFileSync(keygenResult.privateKeyPath, 'utf8'),
          keyId: 'export-key',
          bundleId: 'bundle-finals-pg-001',
          outFile: bundleOut,
        });

        expect(exportResult.bundleId).toBe('bundle-finals-pg-001');
        const bundleJson = fs.readFileSync(bundleOut, 'utf8');

        // Assert no draw_seed or secret storage keys leaked into bundle
        expect(bundleJson).not.toContain(secretDrawSeed);
        expect(bundleJson).not.toContain(privateStorageKey);

        // Assert replays are included in bundle artifacts
        const parsedBundle = JSON.parse(bundleJson);
        const replayPaths = parsedBundle.artifacts.map((a) => a.path).filter((p) => p.startsWith('replays/'));
        expect(replayPaths.length).toBeGreaterThanOrEqual(10);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('refuses export when a required series is not finalized', async () => {
      const mockClient = {
        async query(sql) {
          const text = sql.trim();
          if (text.startsWith('SELECT id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash FROM finals_competitions')) {
            return { rows: [{ id: 'comp-100', tournament_stage: 'STAGE_2026', status: 'IN_PROGRESS', rule_set_id: 'rule-1', bronze_match_enabled: false }] };
          }
          if (text.startsWith('SELECT rules FROM finals_rule_sets')) {
            return { rows: [{ rules: { gameAdapter: { adapterId: 'a', adapterVersion: '1' } } }] };
          }
          if (text.includes('FROM finals_seeds s JOIN teams t')) {
            return { rows: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ ordinal: i, team_id: `t${i}`, team_name: `T${i}`, elo: 1500 })) };
          }
          if (text.startsWith('SELECT id, pairing_id, round, slot, status, series_seed FROM finals_series')) {
            return {
              rows: [
                { id: 's1', pairing_id: 'QF1', round: 'QUARTERFINAL', slot: 1, status: 'FINALIZED' },
                { id: 's2', pairing_id: 'QF2', round: 'QUARTERFINAL', slot: 2, status: 'IN_PROGRESS' },
              ],
            };
          }
          return { rows: [] };
        },
      };

      const reader = await createPgFinalsReader(mockClient, { eventLogLoader: async () => '{}' });
      await expect(reader.loadFinalsExportData({ competitionId: 'comp-100', round: 'QUARTERFINAL' })).rejects.toThrow('ROUND_NOT_FINALIZED');
    });

    it('refuses export when missing rule set, match result, or eventLogLoader', async () => {
      const mockClientWithoutRuleSet = {
        async query(sql) {
          if (sql.includes('finals_competitions')) return { rows: [{ id: 'c1', rule_set_id: 'missing-rule' }] };
          if (sql.includes('finals_rule_sets')) return { rows: [] };
          return { rows: [] };
        },
      };
      const reader1 = await createPgFinalsReader(mockClientWithoutRuleSet);
      await expect(reader1.loadFinalsExportData({ competitionId: 'c1', round: 'ALL' })).rejects.toThrow(/Rule set missing-rule not found/);

      const mockClientWithoutLoader = {
        async query(sql) {
          if (sql.includes('finals_competitions')) return { rows: [{ id: 'c1', rule_set_id: 'rule-1', bronze_match_enabled: false }] };
          if (sql.includes('finals_rule_sets')) return { rows: [{ rules: { gameAdapter: { adapterId: 'a', adapterVersion: '1' } } }] };
          if (sql.includes('finals_seeds')) return { rows: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ ordinal: i, team_id: `t${i}`, team_name: `T${i}`, elo: 1500 })) };
          if (sql.includes('finals_series_games')) return { rows: [{ id: 'g1', game: 1, home_side: 'X', away_side: 'O', status: 'FINALIZED', match_id: 'm1' }] };
          if (sql.includes('finals_series')) return { rows: [{ id: 's1', pairing_id: 'QF1', round: 'QUARTERFINAL', status: 'FINALIZED' }] };
          if (sql.includes('match_results')) {
            return {
              rows: [
                {
                  match_id: 'm1',
                  event_log_key: 'key1',
                  event_log_sha256: 'sha256:' + 'a'.repeat(64),
                  faults: { X: { recoverableTotal: 0, lastErrorCode: null }, O: { recoverableTotal: 0, lastErrorCode: null } },
                  final_state_hash: 'b'.repeat(64),
                  turn_count: 40,
                  reason: 'TURN_LIMIT',
                  winner_side: 'X',
                },
              ],
            };
          }
          return { rows: [] };
        },
      };
      const reader2 = await createPgFinalsReader(mockClientWithoutLoader); // no eventLogLoader provided
      await expect(reader2.loadFinalsExportData({ competitionId: 'c1', round: 'QUARTERFINAL' })).rejects.toThrow(/Event log loader is required/);
    });

    it('refuses export when match result has null event_log_sha256 or null faults, or on sha mismatch', async () => {
      const buildMockClient = (matchResultOverrides) => ({
        async query(sql) {
          if (sql.includes('finals_competitions')) return { rows: [{ id: 'c1', rule_set_id: 'r1', bronze_match_enabled: false }] };
          if (sql.includes('finals_rule_sets')) return { rows: [{ rules: { gameAdapter: { adapterId: 'a', adapterVersion: '1' } } }] };
          if (sql.includes('finals_seeds')) return { rows: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ ordinal: i, team_id: `t${i}`, team_name: `T${i}`, elo: 1500 })) };
          if (sql.includes('finals_series_games')) return { rows: [{ id: 'g1', game: 1, home_side: 'X', away_side: 'O', status: 'FINALIZED', match_id: 'm1' }] };
          if (sql.includes('finals_series')) return { rows: [{ id: 's1', pairing_id: 'QF1', round: 'QUARTERFINAL', status: 'FINALIZED' }] };
          if (sql.includes('match_results')) {
            return {
              rows: [
                {
                  match_id: 'm1',
                  winner_side: 'X',
                  reason: 'TURN_LIMIT',
                  turn_count: 40,
                  final_state_hash: 'a'.repeat(64),
                  event_log_sha256: 'sha256:' + 'b'.repeat(64),
                  event_log_key: 'key-m1',
                  faults: { X: { recoverableTotal: 0, lastErrorCode: null }, O: { recoverableTotal: 0, lastErrorCode: null } },
                  ...matchResultOverrides,
                },
              ],
            };
          }
          return { rows: [] };
        },
      });

      // 1. Missing event_log_sha256
      const readerNullSha = await createPgFinalsReader(buildMockClient({ event_log_sha256: null }), {
        eventLogLoader: async () => '{"entries":[]}',
      });
      await expect(readerNullSha.loadFinalsExportData({ competitionId: 'c1', round: 'QUARTERFINAL' })).rejects.toThrow(
        'MATCH_EVENT_LOG_SHA256_MISSING',
      );

      // 2. Missing faults
      const readerNullFaults = await createPgFinalsReader(buildMockClient({ faults: null }), {
        eventLogLoader: async () => '{"entries":[]}',
      });
      await expect(readerNullFaults.loadFinalsExportData({ competitionId: 'c1', round: 'QUARTERFINAL' })).rejects.toThrow(
        'MATCH_FAULTS_MISSING',
      );

      // 3. Sha mismatch
      const readerShaMismatch = await createPgFinalsReader(buildMockClient({ event_log_sha256: 'sha256:' + '1'.repeat(64) }), {
        eventLogLoader: async () => '{"entries":[]}', // sha256 will not be 1111...
      });
      await expect(readerShaMismatch.loadFinalsExportData({ competitionId: 'c1', round: 'QUARTERFINAL' })).rejects.toThrow(
        'MATCH_EVENT_LOG_SHA256_MISMATCH',
      );
    });

    it('createFilesystemEventLogLoader rejects path traversal, absolute paths and null bytes', async () => {
      const tmpDir = makeTempDir();
      try {
        const secretFile = path.join(tmpDir, 'secret.json');
        fs.writeFileSync(secretFile, '{"secret":true}', 'utf8');

        const nestedDir = path.join(tmpDir, 'logs');
        fs.mkdirSync(nestedDir);
        const validFile = path.join(nestedDir, 'game.json');
        fs.writeFileSync(validFile, '{"valid":true}', 'utf8');

        const loader = createFilesystemEventLogLoader(nestedDir);

        // Valid relative key inside storage directory
        const validBytes = await loader('game.json');
        expect(validBytes.toString('utf8')).toBe('{"valid":true}');

        // Path traversal with ../
        await expect(loader('../secret.json')).rejects.toThrow('EVENT_LOG_PATH_TRAVERSAL');

        // Absolute path
        await expect(loader(secretFile)).rejects.toThrow('EVENT_LOG_PATH_TRAVERSAL');

        // Null byte in key
        await expect(loader('game\0.json')).rejects.toThrow('EVENT_LOG_KEY_INVALID');

        // Missing file
        await expect(loader('not-found.json')).rejects.toThrow('EVENT_LOG_NOT_FOUND');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('createS3EventLogLoader retrieves objects and reports missing keys', async () => {
      const fakeS3Storage = {
        async get(key) {
          if (key === 'replays/m1.json') {
            return Buffer.from('{"events":[]}');
          }
          throw new Error('NoSuchKey');
        },
      };

      const loader = createS3EventLogLoader(fakeS3Storage);

      const data = await loader('replays/m1.json');
      expect(data.toString('utf8')).toBe('{"events":[]}');

      await expect(loader('replays/missing.json')).rejects.toThrow('EVENT_LOG_NOT_FOUND');
      await expect(loader('replays/null\0.json')).rejects.toThrow('EVENT_LOG_KEY_INVALID');
    });
  });
});
