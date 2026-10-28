import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.ts';
import { AuthorizationError, requireAuthenticated, requireRole } from '../auth/authorize.ts';
import type { ObjectStorage } from '../../storage/s3.ts';
import { UploadLimiter, type UploadLimiterOptions } from '../submissions/upload-limiter.ts';
import { REFERENCE_BOT_ARCHIVE_LIMITS } from './archive.ts';
import {
  listReferenceBots,
  ReferenceBotServiceError,
  setReferenceBotEnabled,
  uploadReferenceBot,
} from './service.ts';

const BASE = '/api/v1/admin/reference-bots';
const OCI_MEDIA_TYPE = 'application/vnd.oci.image.archive.v1+tar';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRINTABLE_HEADER_PATTERN = /^[\x20-\x7e]{1,200}$/;

export interface ReferenceBotRoutesOptions {
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly uploadLimiter?: UploadLimiterOptions | UploadLimiter | undefined;
}

interface UploadHeaders {
  readonly 'x-reference-bot-name'?: string;
  readonly 'x-change-reason'?: string;
  readonly 'x-correlation-id'?: string;
  readonly 'idempotency-key'?: string;
}

interface ReasonBody {
  readonly reason?: unknown;
}

function sendError(reply: FastifyReply, error: ReferenceBotServiceError) {
  return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof AuthorizationError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
  }
  if (error instanceof ReferenceBotServiceError) return sendError(reply, error);
  throw error;
}

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function adminCall(request: FastifyRequest, reply: FastifyReply, reason: unknown) {
  const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
  const idempotencyKey = header(request.headers['idempotency-key']);
  if (idempotencyKey === undefined || !PRINTABLE_HEADER_PATTERN.test(idempotencyKey)) {
    reply.status(400).send({ error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must contain 1-200 printable ASCII characters' } });
    return null;
  }
  const suppliedCorrelationId = header(request.headers['x-correlation-id']);
  if (suppliedCorrelationId !== undefined && !UUID_PATTERN.test(suppliedCorrelationId)) {
    reply.status(400).send({ error: { code: 'INVALID_CORRELATION_ID', message: 'X-Correlation-Id must be a UUID' } });
    return null;
  }
  const correlationId = suppliedCorrelationId ?? randomUUID();
  reply.header('X-Correlation-Id', correlationId);
  if (typeof reason !== 'string' || reason.trim().length < 1 || reason.trim().length > 500) {
    reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Reason must be 1-500 characters' } });
    return null;
  }
  return {
    actorAccountId: actor.accountId,
    correlationId,
    idempotencyKey,
    reason: reason.trim(),
  };
}

function uploadErrorHandler(error: Error & { readonly code?: string }, _request: FastifyRequest, reply: FastifyReply) {
  if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return reply.status(413).send({ error: { code: 'ARCHIVE_TOO_LARGE', message: 'OCI archive exceeds 256 MiB' } });
  }
  if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return reply.status(415).send({ error: { code: 'OCI_MEDIA_TYPE_REQUIRED', message: 'Upload must use the OCI image archive media type' } });
  }
  if (error instanceof AuthorizationError) {
    return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
  }
  return reply.send(error);
}

export function registerReferenceBotRoutes(app: FastifyInstance, options: ReferenceBotRoutesOptions): void {
  const limiter = options.uploadLimiter instanceof UploadLimiter
    ? options.uploadLimiter
    : new UploadLimiter(options.uploadLimiter);
  const acquiredByRequest = new WeakMap<FastifyRequest, string>();

  app.addContentTypeParser(OCI_MEDIA_TYPE, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.get(BASE, async (request) => {
    requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    return { data: await listReferenceBots(options.database) };
  });

  app.post<{ Headers: UploadHeaders; Body: Buffer }>(BASE, {
    bodyLimit: REFERENCE_BOT_ARCHIVE_LIMITS.maxArchiveBytes,
    onRequest: async (request, reply) => {
      const principal = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      const key = `reference-bot:${principal.accountId}`;
      const result = limiter.tryAcquire(key);
      if (!result.acquired) {
        reply.header('Retry-After', String(result.retryAfter ?? 5));
        return reply.status(429).send({ error: { code: 'UPLOAD_BUSY', message: 'Reference bot upload capacity reached' } });
      }
      acquiredByRequest.set(request, key);
    },
    onResponse: async (request) => {
      const key = acquiredByRequest.get(request);
      if (key !== undefined) limiter.release(key);
    },
    errorHandler: uploadErrorHandler,
  }, async (request, reply) => {
    const mediaType = header(request.headers['content-type'])?.split(';', 1)[0]?.trim().toLowerCase();
    if (mediaType !== OCI_MEDIA_TYPE) {
      return reply.status(415).send({ error: { code: 'OCI_MEDIA_TYPE_REQUIRED', message: 'Upload must use the OCI image archive media type' } });
    }
    const displayName = header(request.headers['x-reference-bot-name']);
    const call = adminCall(request, reply, request.headers['x-change-reason']);
    if (call === null) return reply;
    if (displayName === undefined) {
      return reply.status(400).send({ error: { code: 'REFERENCE_BOT_NAME_INVALID', message: 'X-Reference-Bot-Name is required' } });
    }
    try {
      const outcome = await uploadReferenceBot(options.database, options.storage, call, { displayName, archive: request.body });
      return reply.status(outcome.replayed ? 200 : 201).send({ data: { ...outcome.data, replayed: outcome.replayed } });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  for (const [operation, enabled] of [['activate', true], ['disable', false]] as const) {
    app.post<{ Params: { id: string }; Body: ReasonBody }>(`${BASE}/:id/${operation}`, async (request, reply) => {
      const call = adminCall(request, reply, request.body?.reason);
      if (call === null) return reply;
      if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(request.params.id)) {
        return reply.status(404).send({ error: { code: 'REFERENCE_BOT_NOT_FOUND', message: 'Reference bot not found' } });
      }
      try {
        const outcome = await setReferenceBotEnabled(options.database, call, request.params.id, enabled);
        return reply.status(outcome.replayed ? 200 : 200).send({ data: { ...outcome.data, replayed: outcome.replayed } });
      } catch (error) {
        return handleError(reply, error);
      }
    });
  }
}
