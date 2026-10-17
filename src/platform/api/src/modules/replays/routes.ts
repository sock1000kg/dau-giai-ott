import type { FastifyInstance, FastifyReply } from 'fastify';

import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import type { ObjectStorage } from '../../storage/s3.ts';
import { getPrivateReplay, getPublicReplay, getReplayCatalog, publishReplayPublication, ReplayApiError, stageReplayPublication, type PrivateReplayPrincipal } from './service.ts';

export interface ReplayRoutesOptions {
  readonly database: Database;
  readonly storage: ObjectStorage;
}

interface CatalogQuery {
  readonly page?: unknown;
  readonly pageSize?: unknown;
}

interface TransitionBody {
  readonly reason?: unknown;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pageValue(value: unknown, fallback: number, maximum: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function transitionInput(
  matchId: unknown,
  body: unknown,
  idempotencyHeader: string | string[] | undefined,
): { readonly matchId: string; readonly reason: string; readonly idempotencyKey: string } | null {
  if (typeof matchId !== 'string' || !uuidPattern.test(matchId)) return null;
  if (typeof idempotencyHeader !== 'string' || idempotencyHeader.length < 1 || idempotencyHeader.length > 200) return null;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const value = body as TransitionBody;
  if (Object.keys(body).some((key) => key !== 'reason') || typeof value.reason !== 'string') return null;
  const reason = value.reason.trim();
  if (reason.length < 1 || reason.length > 500) return null;
  return { matchId, reason, idempotencyKey: idempotencyHeader };
}

function sendReplayError(reply: FastifyReply, error: unknown) {
  if (error instanceof ReplayApiError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
  }
  if (!(error instanceof Error)) throw error;
  if (error.message.includes('replay publication requires FINALS stage')) {
    return reply.status(409).send({ error: { code: 'REPLAY_NOT_PUBLIC_STAGE', message: 'Replay publication is only allowed for FINALS stage matches' } });
  }
  const clientErrors: Readonly<Record<string, Readonly<{ statusCode: number; code: string; message: string }>>> = {
    BTC_ADMIN_REQUIRED: { statusCode: 403, code: 'FORBIDDEN', message: 'You are not allowed to access this resource' },
    INVALID_IDEMPOTENCY_KEY: { statusCode: 400, code: 'INVALID_TRANSITION', message: 'Invalid replay transition request' },
    INVALID_REPLAY_REASON: { statusCode: 400, code: 'INVALID_TRANSITION', message: 'Invalid replay transition request' },
    INVALID_REPLAY_CATALOG_PAGE: { statusCode: 400, code: 'INVALID_PAGINATION', message: 'Invalid page or pageSize' },
    REPLAY_CHECKSUM_MISMATCH: { statusCode: 409, code: 'REPLAY_INTEGRITY_FAILED', message: 'Replay integrity verification failed' },
    REPLAY_NOT_ELIGIBLE: { statusCode: 409, code: 'REPLAY_NOT_ELIGIBLE', message: 'Match does not have a verified terminal replay' },
    REPLAY_NOT_PRIVATE: { statusCode: 409, code: 'REPLAY_STATE_CONFLICT', message: 'Replay is not private' },
    REPLAY_NOT_STAGED: { statusCode: 409, code: 'REPLAY_STATE_CONFLICT', message: 'Replay is not staged' },
    REPLAY_NOT_PUBLIC_STAGE: { statusCode: 409, code: 'REPLAY_NOT_PUBLIC_STAGE', message: 'Replay publication is only allowed for FINALS stage matches' },
    IDEMPOTENCY_KEY_REUSED: { statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was already used for another request' },
  };
  const clientError = clientErrors[error.message];
  if (clientError === undefined) throw error;
  return reply.status(clientError.statusCode).send({ error: { code: clientError.code, message: clientError.message } });
}

export function registerReplayRoutes(app: FastifyInstance, options: ReplayRoutesOptions): void {
  app.get<{ Querystring: CatalogQuery }>('/api/v1/admin/replays/catalog', async (request, reply) => {
    requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const page = pageValue(request.query.page, 1, 10000);
    const pageSize = pageValue(request.query.pageSize, 25, 100);
    if (page === null || pageSize === null) return reply.status(400).send({ error: { code: 'INVALID_PAGINATION', message: 'Invalid page or pageSize' } });
    try {
      const result = await getReplayCatalog(options.database, page, pageSize);
      return { data: { items: result.items, pagination: { page, pageSize, total: result.total, totalPages: result.totalPages } } };
    } catch (error) {
      return sendReplayError(reply, error);
    }
  });

  app.post<{ Params: { matchId: string }; Body: TransitionBody }>('/api/v1/admin/replays/:matchId/stage', async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const input = transitionInput(request.params.matchId, request.body, request.headers['idempotency-key']);
    if (input === null) return reply.status(400).send({ error: { code: 'INVALID_TRANSITION', message: 'Invalid replay transition request' } });
    try {
      const result = await stageReplayPublication(options.database, options.storage, { ...input, actorAccountId: actor.accountId });
      return { data: result };
    } catch (error) {
      return sendReplayError(reply, error);
    }
  });

  app.post<{ Params: { matchId: string }; Body: TransitionBody }>('/api/v1/admin/replays/:matchId/publish', async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const input = transitionInput(request.params.matchId, request.body, request.headers['idempotency-key']);
    if (input === null) return reply.status(400).send({ error: { code: 'INVALID_TRANSITION', message: 'Invalid replay transition request' } });
    try {
      const result = await publishReplayPublication(options.database, options.storage, { ...input, actorAccountId: actor.accountId });
      return { data: result };
    } catch (error) {
      return sendReplayError(reply, error);
    }
  });

  app.get<{ Params: { matchId: string } }>('/api/v1/public/replays/:matchId', async (request, reply) => {
    if (!uuidPattern.test(request.params.matchId)) return reply.status(404).send({ error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' } });
    try {
      const artifact = await getPublicReplay(options.database, options.storage, request.params.matchId);
      return reply
        .header('content-type', 'application/vnd.ott.spectator-replay+json;version=1')
        .header('x-replay-sha256', artifact.checksum)
        .header('cache-control', 'public, max-age=3600, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(artifact.body);
    } catch (error) {
      return sendReplayError(reply, error);
    }
  });

  app.get<{ Params: { matchId: string } }>('/api/v1/replays/:matchId', async (request, reply) => {
    if (!uuidPattern.test(request.params.matchId)) return reply.status(404).send({ error: { code: 'REPLAY_NOT_FOUND', message: 'Replay is not available' } });
    const principal = requireAuthenticated(request.principal);
    const privatePrincipal: PrivateReplayPrincipal = {
      accountId: principal.accountId,
      role: principal.role as 'BTC_ADMIN' | 'TEAM_ACCOUNT',
      teamId: principal.teamId ?? null,
    };
    try {
      const artifact = await getPrivateReplay(options.database, options.storage, request.params.matchId, privatePrincipal);
      return reply
        .header('content-type', 'application/vnd.ott.spectator-replay+json;version=1')
        .header('x-replay-sha256', artifact.checksum)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(artifact.body);
    } catch (error) {
      return sendReplayError(reply, error);
    }
  });
}
