#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'node:process';
import { parseAnyEventLog } from '@ott/match-runner';
import { S3Client } from '@aws-sdk/client-s3';
import { createS3Storage } from '../src/platform/api/src/storage/s3.ts';

import {
  buildFinalsBundleArtifacts,
  buildSignedResultBundle,
  computeKeyFingerprint,
  exportDemoFinalsBundle,
  publicEventLog,
  sha256HexOf,
  validateBundleArtifacts,
  validateKeyId,
  validatePublicKeyPem,
  verifyResultBundlePayload,
} from '../src/platform/api/src/index.ts';
import {
  createFinalsBracket,
} from '../src/platform/api/src/modules/finals/scheduling.ts';

/**
 * P3-N08 Finals ResultBundle CLI
 *
 * Commands:
 * - keygen: offline Ed25519 key generation
 * - fingerprint: public key fingerprint computation
 * - verify: offline bundle signature & artifact verification
 * - demo-export: generates synthetic valid finals bundle
 * - export: exports signed bundle from offline finals database
 */

export function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[key] = next;
        i++;
      } else {
        options[key] = 'true';
      }
    }
  }
  return { command, options };
}

function readPem(input) {
  if (fs.existsSync(input)) {
    return fs.readFileSync(input, 'utf8');
  }
  return input;
}

// ---------------------------------------------------------------------------------------------
// 1. keygen
// ---------------------------------------------------------------------------------------------
export function runKeygen({ outDir, keyId }) {
  if (!outDir || !keyId) {
    throw new Error('Usage: finals-bundle keygen --out-dir <dir> --key-id <id>');
  }
  validateKeyId(keyId);
  const resolvedDir = path.resolve(outDir);
  fs.mkdirSync(resolvedDir, { recursive: true, mode: 0o700 });

  const privateKeyPath = path.join(resolvedDir, `${keyId}.private.pem`);
  const publicKeyPath = path.join(resolvedDir, `${keyId}.public.pem`);

  if (fs.existsSync(privateKeyPath)) {
    throw new Error(`Refusing to overwrite existing private key: ${privateKeyPath}`);
  }
  if (fs.existsSync(publicKeyPath)) {
    throw new Error(`Refusing to overwrite existing public key: ${publicKeyPath}`);
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  // Mode 0600 for private key, mode 0644 for public key
  fs.writeFileSync(privateKeyPath, privatePem, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(publicKeyPath, publicPem, { mode: 0o644, flag: 'wx' });

  const fingerprint = computeKeyFingerprint(publicPem);
  return { keyId, fingerprint, privateKeyPath, publicKeyPath };
}

// ---------------------------------------------------------------------------------------------
// 2. fingerprint
// ---------------------------------------------------------------------------------------------
export function runFingerprint({ publicPemInput }) {
  if (!publicPemInput) {
    throw new Error('Usage: finals-bundle fingerprint --public <pem|file>');
  }
  const pem = readPem(publicPemInput);
  const { fingerprint } = validatePublicKeyPem(pem);
  return { fingerprint };
}

// ---------------------------------------------------------------------------------------------
// 3. verify
// ---------------------------------------------------------------------------------------------
export function runVerify({ bundleFile, publicPemInput }) {
  if (!bundleFile || !publicPemInput) {
    throw new Error('Usage: finals-bundle verify --bundle <file> --public <pem|file>');
  }
  const pem = readPem(publicPemInput);
  validatePublicKeyPem(pem);

  const rawJson = fs.readFileSync(bundleFile, 'utf8');
  const bundle = JSON.parse(rawJson);
  if (!Array.isArray(bundle.artifacts)) {
    throw new Error('RESULT_BUNDLE_INPUT_INVALID');
  }

  const decodedArtifacts = bundle.artifacts.map((a) => ({
    path: a.path,
    payload: Buffer.from(a.payloadBase64, 'base64'),
  }));

  const verified = verifyResultBundlePayload(
    {
      manifest: bundle.manifest,
      signature: bundle.signature,
      artifacts: decodedArtifacts,
    },
    { publicKeyPem: pem },
  );

  return {
    valid: true,
    bundleId: verified.manifest.bundleId,
    bundleVersion: verified.manifest.bundleVersion,
    keyId: verified.manifest.keyId,
    fingerprint: verified.fingerprint,
    artifactCount: verified.manifest.artifacts.length,
  };
}

// ---------------------------------------------------------------------------------------------
// 4. demo-export
// ---------------------------------------------------------------------------------------------
export async function runDemoExport({ outFile, keyDir = '.local/demo/finals' }) {
  if (!outFile) {
    throw new Error('Usage: finals-bundle demo-export --out <file> [--key-dir <dir>]');
  }
  const result = await exportDemoFinalsBundle({ outFile, keyDir });
  return {
    bundleId: result.bundleId,
    keyId: result.keyId,
    fingerprint: result.fingerprint,
    artifacts: result.artifactCount,
    outFile: result.outFile,
  };
}

// ---------------------------------------------------------------------------------------------
// Event log storage loaders
// ---------------------------------------------------------------------------------------------
export function createFilesystemEventLogLoader(storageDir) {
  const resolvedBase = path.resolve(storageDir);
  return async (key) => {
    if (!key || typeof key !== 'string' || key.includes('\0')) {
      throw new Error(`EVENT_LOG_KEY_INVALID: Invalid event_log_key: ${key}`);
    }
    if (path.isAbsolute(key)) {
      throw new Error(`EVENT_LOG_PATH_TRAVERSAL: Absolute path not allowed in event_log_key: ${key}`);
    }
    const resolvedPath = path.resolve(resolvedBase, key);
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      throw new Error(`EVENT_LOG_PATH_TRAVERSAL: Key escapes storage directory: ${key}`);
    }
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`EVENT_LOG_NOT_FOUND: Event log not found at ${resolvedPath}`);
    }
    return fs.readFileSync(resolvedPath);
  };
}

export function createS3EventLogLoader(s3Storage) {
  return async (key) => {
    if (!key || typeof key !== 'string' || key.includes('\0')) {
      throw new Error(`EVENT_LOG_KEY_INVALID: Invalid event_log_key: ${key}`);
    }
    try {
      const bytes = await s3Storage.get(key);
      return bytes;
    } catch (err) {
      throw new Error(`EVENT_LOG_NOT_FOUND: Event log key not found in S3: ${key} (${err instanceof Error ? err.message : String(err)})`);
    }
  };
}

// ---------------------------------------------------------------------------------------------
// 5. export (with abstract DB reader)
// ---------------------------------------------------------------------------------------------
export async function runExportWithReader(reader, options) {
  const {
    competitionId,
    round,
    privateKeyPem,
    keyId,
    bundleId,
    bundleVersion = 1,
    correctionOf,
    reason,
    outFile,
  } = options;

  if (!competitionId || !round || !privateKeyPem || !keyId || !bundleId || !outFile) {
    throw new Error(
      'Usage: finals-bundle export --db-url <url> --competition <id> --round <QUARTERFINAL|SEMIFINAL|FINAL|BRONZE|ALL> --private-key <pem> --key-id <id> --bundle-id <id> [--version N] [--correction-of <id>:<version> --reason <text>] --out <file>',
    );
  }

  const tournamentInput = await reader.loadFinalsExportData({ competitionId, round });

  const builtArtifacts = buildFinalsBundleArtifacts(tournamentInput);

  const validation = validateBundleArtifacts(
    builtArtifacts.map((a) => ({ path: a.path, mediaType: a.mediaType, bytes: a.payload })),
  );
  if (!validation.ok) {
    throw new Error(`Export bundle artifacts validation failed: ${JSON.stringify(validation.errors)}`);
  }

  let correction;
  if (correctionOf) {
    const parts = correctionOf.split(':');
    if (parts.length !== 2 || !reason) {
      throw new Error('Correction requires --correction-of <id>:<version> and --reason <text>');
    }
    correction = {
      bundleId: parts[0],
      bundleVersion: parseInt(parts[1], 10),
      reason,
    };
  }

  const buildInput = {
    bundleId,
    bundleVersion: Number(bundleVersion),
    tournamentId: tournamentInput.tournamentId,
    finalsRuleSetId: tournamentInput.finalsRuleSetId,
    keyId,
    createdAt: new Date().toISOString(),
    ...(correction ? { correctionOf: correction } : {}),
    artifacts: builtArtifacts.map((a) => ({
      path: a.path,
      mediaType: a.mediaType,
      payload: a.payload,
    })),
  };

  const signed = buildSignedResultBundle(buildInput, privateKeyPem);
  const bundlePayload = {
    manifest: signed.manifest,
    signature: signed.signature,
    artifacts: signed.artifacts.map((a) => ({
      path: a.path,
      payloadBase64: Buffer.from(a.payload).toString('base64'),
    })),
  };

  const resolvedOutFile = path.resolve(outFile);
  fs.mkdirSync(path.dirname(resolvedOutFile), { recursive: true });
  fs.writeFileSync(resolvedOutFile, JSON.stringify(bundlePayload, null, 2), 'utf8');

  return {
    bundleId: signed.manifest.bundleId,
    bundleVersion: signed.manifest.bundleVersion,
    keyId,
    artifacts: signed.artifacts.length,
    outFile: resolvedOutFile,
  };
}

export async function createPgFinalsReader(dbUrlOrClient, readerOptions = {}) {
  let client;
  let closeClient = false;
  if (typeof dbUrlOrClient === 'string') {
    const { Client } = await import('pg');
    client = new Client({ connectionString: dbUrlOrClient });
    await client.connect();
    closeClient = true;
  } else {
    client = dbUrlOrClient;
  }

  return {
    async loadFinalsExportData({ competitionId, round }) {
      try {
        const compRes = await client.query(
          'SELECT id, tournament_stage, status, rule_set_id, bronze_match_enabled, draw_seed, seeding_hash FROM finals_competitions WHERE id = $1',
          [competitionId],
        );
        const comp = compRes.rows[0];
        if (!comp) throw new Error(`Competition ${competitionId} not found`);

        const ruleSetRes = await client.query(
          'SELECT rules FROM finals_rule_sets WHERE id = $1',
          [comp.rule_set_id],
        );
        const ruleSet = ruleSetRes.rows[0];
        if (!ruleSet) {
          throw new Error(`Rule set ${comp.rule_set_id} not found for competition ${competitionId}`);
        }
        const rulesObj = typeof ruleSet.rules === 'string' ? JSON.parse(ruleSet.rules) : ruleSet.rules;
        const adapter = rulesObj?.gameAdapter;
        if (!adapter?.adapterId || !adapter?.adapterVersion) {
          throw new Error(`FINALS_RULE_SET_INVALID: Rule set ${comp.rule_set_id} missing gameAdapter in rules`);
        }
        const adapterId = adapter.adapterId;
        const adapterVersion = adapter.adapterVersion;

        const seedsRes = await client.query(
          `SELECT s.ordinal, s.team_id, s.submission_id, s.elo, t.name AS team_name
           FROM finals_seeds s JOIN teams t ON t.id = s.team_id
           WHERE s.competition_id = $1 ORDER BY s.ordinal`,
          [competitionId],
        );
        if (seedsRes.rows.length !== 8) {
          throw new Error(`Competition ${competitionId} does not have exactly 8 seeds`);
        }

        const seriesRes = await client.query(
          'SELECT id, pairing_id, round, slot, status, series_seed FROM finals_series WHERE competition_id = $1 ORDER BY round, slot',
          [competitionId],
        );

        // Required rounds check
        const requiredRounds = new Set();
        if (round === 'QUARTERFINAL') {
          requiredRounds.add('QUARTERFINAL');
        } else if (round === 'SEMIFINAL') {
          requiredRounds.add('QUARTERFINAL');
          requiredRounds.add('SEMIFINAL');
        } else if (round === 'BRONZE') {
          requiredRounds.add('QUARTERFINAL');
          requiredRounds.add('SEMIFINAL');
          requiredRounds.add('BRONZE');
        } else {
          requiredRounds.add('QUARTERFINAL');
          requiredRounds.add('SEMIFINAL');
          requiredRounds.add('FINAL');
          if (comp.bronze_match_enabled) requiredRounds.add('BRONZE');
        }

        const requiredSeries = seriesRes.rows.filter((s) => requiredRounds.has(s.round));
        for (const s of requiredSeries) {
          if (s.status !== 'FINALIZED') {
            throw new Error(`ROUND_NOT_FINALIZED: Series ${s.pairing_id} (${s.round}) is ${s.status}`);
          }
        }

        const seriesData = [];
        for (const s of requiredSeries) {
          const gamesRes = await client.query(
            'SELECT id, game, home_side, away_side, map_id, status, match_id, decided_by, decided_criterion_id, score_breakdown, winner_side FROM finals_series_games WHERE series_id = $1 ORDER BY game',
            [s.id],
          );

          const games = [];
          for (const g of gamesRes.rows) {
            const plan = { game: g.game, homeSide: g.home_side, awaySide: g.away_side, mapId: g.map_id };
            if (g.status === 'FINALIZED') {
              const matchRes = await client.query(
                'SELECT match_id, winner_side, reason, turn_count, final_state_hash, event_log_sha256, event_log_key, faults FROM match_results WHERE match_id = $1',
                [g.match_id],
              );
              const m = matchRes.rows[0];
              if (!m) {
                throw new Error(`MATCH_RESULT_MISSING: Match result not found for match ${g.match_id}`);
              }
              if (!m.event_log_sha256) {
                throw new Error(`MATCH_EVENT_LOG_SHA256_MISSING: Match ${g.match_id} missing event_log_sha256 in match_results`);
              }
              if (!m.faults) {
                throw new Error(`MATCH_FAULTS_MISSING: Match ${g.match_id} missing faults in match_results`);
              }
              if (!m.final_state_hash) {
                throw new Error(`MATCH_FINAL_STATE_HASH_MISSING: Match ${g.match_id} missing final_state_hash in match_results`);
              }
              if (m.turn_count === null || m.turn_count === undefined) {
                throw new Error(`MATCH_TURN_COUNT_MISSING: Match ${g.match_id} missing turn_count in match_results`);
              }
              if (!m.reason) {
                throw new Error(`MATCH_REASON_MISSING: Match ${g.match_id} missing reason in match_results`);
              }

              // Map winner side to HOME/AWAY semantics
              const directWinner = g.decided_by === 'DIRECT'
                ? (g.winner_side === g.home_side ? 'HOME' : 'AWAY')
                : null;

              if (!readerOptions?.eventLogLoader) {
                throw new Error(`EVENT_LOG_LOADER_REQUIRED: Event log loader is required to export replays for match ${g.match_id}`);
              }
              const rawLog = await readerOptions.eventLogLoader(m.event_log_key);
              if (!rawLog) {
                throw new Error(`EVENT_LOG_NOT_FOUND: Event log not found for match ${g.match_id} (key: ${m.event_log_key})`);
              }

              const rawLogBytes = typeof rawLog === 'string'
                ? Buffer.from(rawLog, 'utf8')
                : Buffer.isBuffer(rawLog)
                ? rawLog
                : Buffer.from(rawLog);

              const loadedLogSha256 = sha256HexOf(rawLogBytes);
              const expectedLogSha256 = m.event_log_sha256.replace(/^sha256:/, '');
              if (loadedLogSha256 !== expectedLogSha256) {
                throw new Error(`MATCH_EVENT_LOG_SHA256_MISMATCH: Match ${g.match_id} event log hash mismatch (expected ${expectedLogSha256}, got ${loadedLogSha256})`);
              }

              const parsed = typeof rawLog === 'string'
                ? parseAnyEventLog(rawLog)
                : parseAnyEventLog(new TextDecoder().decode(rawLogBytes));
              const replay = publicEventLog(parsed, g.match_id, m.final_state_hash);

              games.push({
                plan,
                state: 'FINALIZED',
                finalized: {
                  matchId: g.match_id,
                  adapterId,
                  adapterVersion,
                  adapterResult: {
                    directWinner,
                    scoreBreakdown: g.score_breakdown ?? [],
                  },
                  reason: m.reason,
                  turnCount: m.turn_count,
                  finalStateHash: m.final_state_hash,
                  eventLogSha256: expectedLogSha256,
                  faults: m.faults,
                  replay,
                },
              });
            } else {
              games.push({ plan, state: g.status });
            }
          }
          seriesData.push({ pairingId: s.pairing_id, games });
        }

        const lockedSeeding = {
          seeds: seedsRes.rows.map((r) => ({ ordinal: r.ordinal, teamId: r.team_id })),
          drawSeed: comp.draw_seed,
          seedingHash: comp.seeding_hash,
        };

        const bracket = createFinalsBracket(lockedSeeding, { bronzeMatchEnabled: comp.bronze_match_enabled });

        return {
          tournamentId: comp.tournament_stage,
          finalsRuleSetId: comp.rule_set_id,
          seeding: lockedSeeding,
          bracket,
          teams: seedsRes.rows.map((r) => ({ seed: r.ordinal, teamName: r.team_name, rating: r.elo })),
          series: seriesData,
        };
      } finally {
        if (closeClient && typeof client?.end === 'function') {
          await client.end();
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Main CLI Entrypoint
// ---------------------------------------------------------------------------------------------
export async function main(argv = process.argv) {
  const { command, options } = parseArgs(argv);

  switch (command) {
    case 'keygen': {
      const res = runKeygen({ outDir: options['out-dir'], keyId: options['key-id'] });
      process.stdout.write(`Key ID: ${res.keyId}\nFingerprint: ${res.fingerprint}\n`);
      break;
    }
    case 'fingerprint': {
      const res = runFingerprint({ publicPemInput: options['public'] });
      process.stdout.write(`${res.fingerprint}\n`);
      break;
    }
    case 'verify': {
      const res = runVerify({ bundleFile: options['bundle'], publicPemInput: options['public'] });
      process.stdout.write(
        `Bundle ${res.bundleId} v${res.bundleVersion} VERIFIED with key ${res.keyId} (${res.fingerprint}) — ${res.artifactCount} artifacts\n`,
      );
      break;
    }
    case 'demo-export': {
      const res = await runDemoExport({ outFile: options['out'], keyDir: options['key-dir'] });
      process.stdout.write(
        `Demo bundle generated at ${res.outFile} (Key: ${res.keyId}, Fingerprint: ${res.fingerprint}, Artifacts: ${res.artifacts})\n`,
      );
      break;
    }
    case 'export': {
      const pem = readPem(options['private-key']);
      const storageDir = options['storage-dir'] || process.env.OFFLINE_STORAGE_DIR || process.env.STORAGE_DIR;
      const s3Endpoint = options['s3-endpoint'] || process.env.S3_ENDPOINT;
      const s3Bucket = options['s3-bucket'] || process.env.S3_BUCKET;
      const s3AccessKeyId = options['s3-access-key-id'] || process.env.S3_ACCESS_KEY_ID;
      const s3SecretAccessKey = options['s3-secret-access-key'] || process.env.S3_SECRET_ACCESS_KEY;
      const s3Region = options['s3-region'] || process.env.S3_REGION || 'us-east-1';

      let eventLogLoader = undefined;
      if (storageDir) {
        eventLogLoader = createFilesystemEventLogLoader(storageDir);
      } else if (s3Endpoint && s3Bucket && s3AccessKeyId && s3SecretAccessKey) {
        const client = new S3Client({
          endpoint: s3Endpoint,
          region: s3Region,
          forcePathStyle: true,
          credentials: {
            accessKeyId: s3AccessKeyId,
            secretAccessKey: s3SecretAccessKey,
          },
        });
        const storage = createS3Storage({ client, bucket: s3Bucket });
        eventLogLoader = createS3EventLogLoader(storage);
      } else {
        throw new Error(
          'EVENT_LOG_STORAGE_REQUIRED: Either --storage-dir or S3 configuration (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) is required to load match replays.',
        );
      }

      const reader = await createPgFinalsReader(options['db-url'], { eventLogLoader });
      const res = await runExportWithReader(reader, {
        competitionId: options['competition'],
        round: options['round'],
        privateKeyPem: pem,
        keyId: options['key-id'],
        bundleId: options['bundle-id'],
        bundleVersion: options['version'] ? parseInt(options['version'], 10) : 1,
        correctionOf: options['correction-of'],
        reason: options['reason'],
        outFile: options['out'],
      });
      process.stdout.write(
        `Bundle ${res.bundleId} v${res.bundleVersion} exported and signed to ${res.outFile} (${res.artifacts} artifacts)\n`,
      );
      break;
    }
    default:
      process.stderr.write(
        'Usage: finals-bundle <keygen|fingerprint|verify|demo-export|export> [options]\n',
      );
      process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
