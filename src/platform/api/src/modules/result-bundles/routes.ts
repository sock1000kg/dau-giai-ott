import type { FastifyInstance, FastifyReply } from 'fastify';

import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import {
  getPublishedResultBundleProof,
  importResultBundle,
  type ResultBundleArtifactPayload,
} from './importer.ts';

export interface ResultBundleRoutesOptions {
  readonly database: Database;
}

/**
 * RFC 3339 date-time accepted for `manifest.createdAt`; the importer re-validates the manifest, so
 * this only guards the HTTP envelope.
 */
const clientErrors: Readonly<Record<string, Readonly<{ statusCode: number; message: string }>>> = {
  RESULT_BUNDLE_MANIFEST_INVALID: { statusCode: 400, message: 'Invalid result bundle manifest' },
  RESULT_BUNDLE_CORRECTION_INVALID: { statusCode: 400, message: 'Invalid correction metadata' },
  RESULT_BUNDLE_INPUT_INVALID: { statusCode: 400, message: 'Invalid result bundle request body' },
  RESULT_BUNDLE_KEY_UNKNOWN: { statusCode: 422, message: 'Signing key is not allowlisted' },
  RESULT_BUNDLE_SIGNATURE_INVALID: { statusCode: 422, message: 'Signature verification failed' },
  RESULT_BUNDLE_ARTIFACT_MISSING: { statusCode: 422, message: 'A declared artifact is missing' },
  RESULT_BUNDLE_ARTIFACT_TAMPERED: { statusCode: 422, message: 'An artifact does not match its manifest entry' },
  RESULT_BUNDLE_ARTIFACT_UNLISTED: { statusCode: 422, message: 'The upload contains artifacts the manifest does not declare' },
  RESULT_BUNDLE_VERSION_CONFLICT: { statusCode: 409, message: 'This bundle version already exists with different content' },
};

function sendResultBundleError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof Error)) throw error;
  const clientError = clientErrors[error.message];
  if (clientError === undefined) throw error;
  return reply.status(clientError.statusCode).send({ error: { code: error.message, message: clientError.message } });
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

export function registerResultBundleRoutes(app: FastifyInstance, options: ResultBundleRoutesOptions): void {
  app.post('/api/v1/admin/result-bundles', async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const body = parseImportBody(request.body);
    if (body === null) {
      return reply.status(400).send({ error: { code: 'RESULT_BUNDLE_INPUT_INVALID', message: 'Invalid result bundle request body' } });
    }
    try {
      const result = await importResultBundle(options.database, body, { actorAccountId: actor.accountId });
      return reply.status(result.replayed ? 200 : 201).send({ data: result });
    } catch (error) {
      return sendResultBundleError(reply, error);
    }
  });

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
}
