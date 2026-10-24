import type { FastifyInstance, FastifyReply } from 'fastify';

import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import { validateBundleArtifacts, type FinalsBundleView } from './artifacts.ts';
import {
  getPublishedResultBundleProof,
  importResultBundle,
  verifyResultBundle,
  type ResultBundleArtifactPayload,
} from './importer.ts';
import {
  allowlistResultBundleKey,
  listResultBundleKeys,
  revokeResultBundleKey,
} from './keys.ts';

export interface ResultBundleRoutesOptions {
  readonly database: Database;
}

const MAX_BUNDLE_BODY_BYTES = 257 * 1024 * 1024;

const clientErrors: Readonly<Record<string, Readonly<{ statusCode: number; message: string }>>> = {
  RESULT_BUNDLE_MANIFEST_INVALID: { statusCode: 400, message: 'Invalid result bundle manifest' },
  RESULT_BUNDLE_CORRECTION_INVALID: { statusCode: 400, message: 'Invalid correction metadata' },
  RESULT_BUNDLE_INPUT_INVALID: { statusCode: 400, message: 'Invalid result bundle request body' },
  RESULT_BUNDLE_KEY_PRIVATE_REJECTED: { statusCode: 400, message: 'Private keys are rejected' },
  RESULT_BUNDLE_KEY_INVALID: { statusCode: 400, message: 'Invalid Ed25519 public key' },
  RESULT_BUNDLE_KEY_ID_INVALID: { statusCode: 400, message: 'Invalid keyId format' },
  INVALID_REASON: { statusCode: 400, message: 'Reason must be 1-500 characters' },
  FINGERPRINT_MISMATCH: { statusCode: 422, message: 'Fingerprint confirmation mismatch' },
  RESULT_BUNDLE_KEY_EXISTS: { statusCode: 409, message: 'A different key with this keyId already exists' },
  RESULT_BUNDLE_KEY_NOT_FOUND: { statusCode: 404, message: 'Result bundle key not found' },
  RESULT_BUNDLE_KEY_UNKNOWN: { statusCode: 422, message: 'Signing key is not allowlisted' },
  RESULT_BUNDLE_SIGNATURE_INVALID: { statusCode: 422, message: 'Signature verification failed' },
  RESULT_BUNDLE_ARTIFACT_MISSING: { statusCode: 422, message: 'A declared artifact is missing' },
  RESULT_BUNDLE_ARTIFACT_TAMPERED: { statusCode: 422, message: 'An artifact does not match its manifest entry' },
  RESULT_BUNDLE_ARTIFACT_UNLISTED: { statusCode: 422, message: 'The upload contains artifacts the manifest does not declare' },
  RESULT_BUNDLE_ARTIFACT_INVALID: { statusCode: 422, message: 'Artifact schema or structure invalid' },
  RESULT_BUNDLE_VERSION_CONFLICT: { statusCode: 409, message: 'This bundle version already exists with different content' },
};

function sendResultBundleError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof Error)) throw error;
  const code = error.message.split(':')[0]?.trim() ?? error.message;
  const clientError = clientErrors[code] ?? clientErrors[error.message];
  if (clientError === undefined) throw error;
  return reply.status(clientError.statusCode).send({ error: { code, message: clientError.message } });
}

interface ImportBody {
  readonly manifest: unknown;
  readonly signature: string;
  readonly artifacts: readonly ResultBundleArtifactPayload[];
}

/**
 * Parses the import envelope: `{ manifest, signature, artifacts: [{ path, payloadBase64 }] }`.
 * Base64 is decoded here; anything malformed is refused before the importer runs.
 */
function parseImportBody(body: unknown): ImportBody | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const signature = raw['signature'];
  const artifacts = raw['artifacts'];
  if (typeof signature !== 'string' || signature.length === 0 || raw['manifest'] === undefined) return null;
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;

  const decoded: ResultBundleArtifactPayload[] = [];
  for (const entry of artifacts) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    const path = item['path'];
    const payloadBase64 = item['payloadBase64'];
    if (typeof path !== 'string' || path.length === 0 || typeof payloadBase64 !== 'string') return null;
    const payload = Buffer.from(payloadBase64, 'base64');
    if (payload.byteLength === 0) return null;
    decoded.push({ path, payload });
  }
  return { manifest: raw['manifest'], signature, artifacts: decoded };
}

function roundDisplayName(round: string, slot: number): string {
  switch (round) {
    case 'QUARTERFINAL':
      return `Tứ kết ${slot}`;
    case 'SEMIFINAL':
      return `Bán kết ${slot}`;
    case 'BRONZE':
      return 'Tranh hạng ba';
    case 'FINAL':
      return 'Chung kết';
    default:
      return `${round} ${slot}`;
  }
}

function deriveFinalOutcomes(view: FinalsBundleView): Map<number, { rank: number; outcome: string }> {
  const outcomes = new Map<number, { rank: number; outcome: string }>();

  const f1 = view.pairings.find((p) => p.id === 'F1');
  if (f1 && f1.winnerSeed !== null && f1.loserSeed !== null) {
    outcomes.set(f1.winnerSeed, { rank: 1, outcome: 'Vô địch' });
    outcomes.set(f1.loserSeed, { rank: 2, outcome: 'Á quân' });
  }

  const b1 = view.pairings.find((p) => p.id === 'B1');
  if (b1 && b1.winnerSeed !== null && b1.loserSeed !== null) {
    outcomes.set(b1.winnerSeed, { rank: 3, outcome: 'Hạng ba' });
    outcomes.set(b1.loserSeed, { rank: 4, outcome: 'Hạng tư' });
  } else {
    const sfPairings = view.pairings.filter((p) => p.round === 'SEMIFINAL');
    for (const sf of sfPairings) {
      if (sf.loserSeed !== null && !outcomes.has(sf.loserSeed)) {
        outcomes.set(sf.loserSeed, { rank: 3, outcome: 'Đồng hạng ba' });
      }
    }
  }

  const qfPairings = view.pairings.filter((p) => p.round === 'QUARTERFINAL');
  for (const qf of qfPairings) {
    if (qf.loserSeed !== null && !outcomes.has(qf.loserSeed)) {
      outcomes.set(qf.loserSeed, { rank: 5, outcome: 'Tứ kết' });
    }
  }

  return outcomes;
}

export function projectFinalsSnapshot(
  view: FinalsBundleView,
  proof: { importedAt?: string; [key: string]: unknown } | null | undefined,
  updatedAt: string,
) {
  const seedMap = new Map(view.seeds.map((s) => [s.seed, s]));
  const teamIdOf = (seed: number | null) => (seed === null ? null : `team-seed-${seed}`);
  const outcomeMap = deriveFinalOutcomes(view);

  const standings = view.seeds.map((s) => {
    const derived = outcomeMap.get(s.seed) ?? { rank: s.seed, outcome: 'Vòng chung kết' };
    return {
      rank: derived.rank,
      teamId: `team-seed-${s.seed}`,
      teamName: s.teamName,
      seedOrdinal: s.seed,
      qualificationRating: s.rating,
      finalOutcome: derived.outcome,
    };
  });
  standings.sort((a, b) => a.rank - b.rank || a.seedOrdinal - b.seedOrdinal);

  const bracket = view.pairings.map((p) => {
    const homeTeamSeed = p.homeSeed !== null ? seedMap.get(p.homeSeed) : undefined;
    const awayTeamSeed = p.awaySeed !== null ? seedMap.get(p.awaySeed) : undefined;

    const teamA = homeTeamSeed
      ? { teamId: `team-seed-${homeTeamSeed.seed}`, teamName: homeTeamSeed.teamName, seedOrdinal: homeTeamSeed.seed }
      : null;
    const teamB = awayTeamSeed
      ? { teamId: `team-seed-${awayTeamSeed.seed}`, teamName: awayTeamSeed.teamName, seedOrdinal: awayTeamSeed.seed }
      : null;

    const games = (p.series?.games ?? []).map((g) => {
      const match = view.matches.find((m) => m.matchId === g.matchId);
      const isClinched = g.state === 'FINALIZED' && match !== undefined;
      let winnerTeamId: string | null = null;
      if (isClinched && match) {
        const winSide = match.result.winnerSide;
        if (winSide === 'X') {
          winnerTeamId = match.sides.X !== null ? `team-seed-${match.sides.X}` : null;
        } else if (winSide === 'O') {
          winnerTeamId = match.sides.O !== null ? `team-seed-${match.sides.O}` : null;
        }
      }

      return {
        gameNumber: g.game,
        sideA: g.homeSide,
        sideB: g.awaySide,
        mapName: g.mapId,
        winnerTeamId,
        replayMatchId: g.matchId,
        replayPublished: Boolean(g.matchId && view.replayMatchIds.includes(g.matchId)),
        scoreBreakdown: match?.adapter.criteria.map((c) => ({
          criterionId: c.id,
          label: c.id,
          valueA: c.x,
          valueB: c.o,
        })),
      };
    });

    return {
      pairingId: p.id as 'QF1' | 'QF2' | 'QF3' | 'QF4' | 'SF1' | 'SF2' | 'B1' | 'F1',
      roundName: roundDisplayName(p.round, p.slot),
      bestOf: p.series?.bestOf ?? 3,
      status: p.state,
      winnerTeamId: teamIdOf(p.winnerSeed),
      score: {
        winsA: p.series?.outcome.homeGameWins ?? 0,
        winsB: p.series?.outcome.awayGameWins ?? 0,
      },
      teamA,
      teamB,
      games,
    };
  });

  return {
    schemaVersion: 1,
    tournamentId: view.tournamentId,
    finalsRuleSetId: view.finalsRuleSetId,
    stage: 'FINALS' as const,
    updatedAt,
    verifiedAt: proof?.importedAt ?? updatedAt,
    proof,
    bracket,
    standings,
  };
}

export function registerResultBundleRoutes(app: FastifyInstance, options: ResultBundleRoutesOptions): void {
  // -------------------------------------------------------------------------------------------
  // Admin Key Registration & Revocation
  // -------------------------------------------------------------------------------------------
  app.get('/api/v1/admin/result-bundles/keys', async (request, reply) => {
    requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    try {
      const items = await listResultBundleKeys(options.database);
      return { data: items };
    } catch (error) {
      return sendResultBundleError(reply, error);
    }
  });

  app.post('/api/v1/admin/result-bundles/keys', async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const body = (request.body ?? {}) as Record<string, unknown>;
    const keyId = body['keyId'];
    const publicKeyPem = body['publicKeyPem'];
    const fingerprintConfirmation = body['fingerprintConfirmation'];
    const reason = body['reason'];

    if (
      typeof keyId !== 'string' ||
      typeof publicKeyPem !== 'string' ||
      typeof fingerprintConfirmation !== 'string' ||
      typeof reason !== 'string'
    ) {
      return reply.status(400).send({
        error: { code: 'RESULT_BUNDLE_INPUT_INVALID', message: 'Missing required key registration fields' },
      });
    }

    try {
      const result = await allowlistResultBundleKey(options.database, {
        keyId,
        publicKeyPem,
        fingerprintConfirmation,
        reason,
        actorAccountId: actor.accountId,
      });
      return reply.status(result.replayed ? 200 : 201).send({ data: result });
    } catch (error) {
      return sendResultBundleError(reply, error);
    }
  });

  app.post<{ Params: { keyId: string } }>(
    '/api/v1/admin/result-bundles/keys/:keyId/revoke',
    async (request, reply) => {
      const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      const keyId = request.params.keyId;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const reason = body['reason'];

      if (typeof reason !== 'string') {
        return reply.status(400).send({
          error: { code: 'INVALID_REASON', message: 'Reason must be 1-500 characters' },
        });
      }

      try {
        const result = await revokeResultBundleKey(options.database, {
          keyId,
          reason,
          actorAccountId: actor.accountId,
        });
        return { data: result };
      } catch (error) {
        return sendResultBundleError(reply, error);
      }
    },
  );

  // -------------------------------------------------------------------------------------------
  // Admin Import & Dry-Run Verification
  // -------------------------------------------------------------------------------------------
  app.post<{ Querystring: { dryRun?: string } }>(
    '/api/v1/admin/result-bundles',
    { bodyLimit: MAX_BUNDLE_BODY_BYTES },
    async (request, reply) => {
      const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      const body = parseImportBody(request.body);
      if (body === null) {
        return reply.status(400).send({
          error: { code: 'RESULT_BUNDLE_INPUT_INVALID', message: 'Invalid result bundle request body' },
        });
      }

      const isDryRun = request.query?.dryRun === 'true';

      try {
        if (isDryRun) {
          const verified = await verifyResultBundle(options.database, body);
          return reply.status(200).send({ data: verified });
        }
        const result = await importResultBundle(options.database, body, { actorAccountId: actor.accountId });
        return reply.status(result.replayed ? 200 : 201).send({ data: result });
      } catch (error) {
        return sendResultBundleError(reply, error);
      }
    },
  );

  app.post(
    '/api/v1/admin/result-bundles/verify',
    { bodyLimit: MAX_BUNDLE_BODY_BYTES },
    async (request, reply) => {
      requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      const body = parseImportBody(request.body);
      if (body === null) {
        return reply.status(400).send({
          error: { code: 'RESULT_BUNDLE_INPUT_INVALID', message: 'Invalid result bundle request body' },
        });
      }
      try {
        const verified = await verifyResultBundle(options.database, body);
        return reply.status(200).send({ data: verified });
      } catch (error) {
        return sendResultBundleError(reply, error);
      }
    },
  );

  // -------------------------------------------------------------------------------------------
  // Public Endpoints: Proof Metadata & Finals Snapshot
  // -------------------------------------------------------------------------------------------
  app.get<{ Params: { bundleId: string } }>(
    '/api/v1/public/result-bundles/:bundleId',
    async (request, reply) => {
      const bundleId = request.params.bundleId;
      if (bundleId.length === 0 || bundleId.length > 128) {
        return reply.status(404).send({ error: { code: 'RESULT_BUNDLE_NOT_FOUND', message: 'Result bundle not found' } });
      }
      const items = await getPublishedResultBundleProof(options.database, bundleId);
      if (items.length === 0) {
        return reply.status(404).send({ error: { code: 'RESULT_BUNDLE_NOT_FOUND', message: 'Result bundle not found' } });
      }
      return { data: { items } };
    },
  );

  app.get('/api/v1/public/finals/snapshot', async (_request, reply) => {
    const latest = await options.database.query<{
      readonly bundle_id: string;
      readonly bundle_version: number;
      readonly key_id: string;
      readonly manifest_sha256: string;
      readonly verified_at: Date;
    }>(
      `SELECT bundle_id, bundle_version, key_id, manifest_sha256, verified_at
       FROM result_bundles WHERE status = 'VERIFIED'
       ORDER BY verified_at DESC, created_at DESC LIMIT 1`,
    );
    const row = latest.rows[0];
    if (row === undefined) {
      return reply.status(404).send({
        error: { code: 'FINALS_SNAPSHOT_NOT_FOUND', message: 'Finals snapshot unavailable' },
      });
    }

    const artifactsRows = await options.database.query<{
      readonly path: string;
      readonly media_type: string;
      readonly content: Buffer;
    }>(
      'SELECT path, media_type, content FROM result_bundle_artifacts WHERE bundle_id = $1 AND bundle_version = $2',
      [row.bundle_id, row.bundle_version],
    );

    const validation = validateBundleArtifacts(
      artifactsRows.rows.map((r) => ({
        path: r.path,
        mediaType: r.media_type,
        bytes: new Uint8Array(r.content),
      })),
    );

    if (!validation.ok) {
      return reply.status(500).send({
        error: { code: 'FINALS_ARTIFACTS_INVALID', message: 'Finals artifacts validation failed' },
      });
    }

    const proof = {
      bundleId: row.bundle_id,
      bundleVersion: row.bundle_version,
      keyId: row.key_id,
      manifestSha256: row.manifest_sha256,
      importedAt: row.verified_at.toISOString(),
      status: 'VERIFIED' as const,
    };

    // Set updatedAt to request time so published finals snapshots do not trigger false stale warnings in spectator/finals UI
    const snapshot = projectFinalsSnapshot(validation.value, proof, new Date().toISOString());
    return { data: snapshot };
  });

  // -------------------------------------------------------------------------------------------
  // Public Bundle Replay Route (D2)
  // -------------------------------------------------------------------------------------------
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  app.get<{ Params: { bundleId: string; matchId: string } }>(
    '/api/v1/public/result-bundles/:bundleId/replays/:matchId',
    async (request, reply) => {
      const { bundleId, matchId } = request.params;
      if (!uuidPattern.test(matchId)) {
        return reply.status(404).send({
          error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' },
        });
      }

      const bundleArtifactRes = await options.database.query<{ payload: Buffer | string; sha256: string }>(
        `SELECT rba.content AS payload, rba.sha256
         FROM result_bundle_artifacts rba
         JOIN result_bundles rb ON rb.bundle_id = rba.bundle_id AND rb.bundle_version = rba.bundle_version
         WHERE rb.bundle_id = $1 AND rba.path = $2 AND rb.status = 'VERIFIED'
         ORDER BY rb.bundle_version DESC
         LIMIT 1`,
        [bundleId, `replays/${matchId}.json`],
      );

      const row = bundleArtifactRes.rows[0];
      if (row === undefined) {
        return reply.status(404).send({
          error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' },
        });
      }

      const payloadBuffer = Buffer.isBuffer(row.payload)
        ? row.payload
        : Buffer.from(row.payload, 'utf8');
      const checksum = row.sha256.startsWith('sha256:') ? row.sha256 : `sha256:${row.sha256}`;
      const parsed = JSON.parse(payloadBuffer.toString('utf8'));
      const version = parsed.schemaVersion === 2 ? 2 : 1;

      return reply
        .header('content-type', `application/vnd.ott.spectator-replay+json;version=${version}`)
        .header('x-replay-sha256', checksum)
        .header('cache-control', 'public, max-age=3600, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(payloadBuffer.toString('utf8'));
    },
  );
}
