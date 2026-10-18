import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import type { SessionStore } from '../auth/sessions.ts';
import { dispatchScheduledMatches, type MatchJobEnqueuer } from '../scheduling/service.ts';
import { sanitizeAuditRecord, toNdjson } from './export.ts';
import {
  cancelMatch,
  exportAudit,
  listAudit,
  listPublicQueueOverrides,
  rerunMatch,
  revokeSubmission,
  suspendTeam,
  unsuspendTeam,
  type PrivilegedContext,
  type PrivilegedOutcome,
} from './service.ts';
import {
  OperationsError,
  parseAuditQuery,
  parseCancelBody,
  parseIdempotencyKey,
  parseReasonBody,
  parseRerunBody,
  parseUuid,
  resolveCorrelationId,
  type Parsed,
} from './types.ts';

export interface OperationsRoutesOptions {
  readonly database: Database;
  readonly sessionStore?: SessionStore;
  /** When present the API tries to publish the rerun outbox row right after commit; the outbox stays the source of truth. */
  readonly enqueuer?: MatchJobEnqueuer | undefined;
}

const BASE = '/api/v1/admin/operations';

const clientMessages: Readonly<Record<string, string>> = {
  INVALID_REQUEST: 'Invalid request body',
  INVALID_REASON: 'Reason must be 1-500 characters',
  INVALID_PUBLIC_REASON: 'Public reason must be 1-200 characters',
  RERUN_CONFIRMATION_REQUIRED: 'verifiedInfraFailure must be true',
  INVALID_QUERY: 'Invalid query',
};

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send({ error: { code, message }, correlationId: reply.getHeader('x-correlation-id') });
}

function badRequest(reply: FastifyReply, code: string) {
  return sendError(reply, 400, code, clientMessages[code] ?? 'Invalid request');
}

interface AdminCall {
  readonly actorAccountId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string | undefined;
}

/** RBAC first, then correlation id (generated when absent, echoed always) and idempotency key validation. */
function beginAdminCall(request: FastifyRequest, reply: FastifyReply): AdminCall | null {
  const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
  const correlationId = resolveCorrelationId(request.headers['x-correlation-id']);
  if (correlationId === null) {
    sendError(reply, 400, 'INVALID_CORRELATION_ID', 'X-Correlation-Id must be a UUID');
    return null;
  }
  reply.header('X-Correlation-Id', correlationId);
  const key = parseIdempotencyKey(request.headers['idempotency-key']);
  if (!key.ok) {
    sendError(reply, 400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 1-200 printable characters');
    return null;
  }
  return { actorAccountId: actor.accountId, correlationId, idempotencyKey: key.key };
}

function contextFor(call: AdminCall, reason: string): PrivilegedContext {
  return { actorAccountId: call.actorAccountId, correlationId: call.correlationId, reason, idempotencyKey: call.idempotencyKey };
}

function respond<T>(call: AdminCall, outcome: PrivilegedOutcome<T>, status = 200) {
  return { status: outcome.replayed ? 200 : status, body: { data: { ...outcome.after, replayed: outcome.replayed }, correlationId: call.correlationId } };
}

function handleFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof OperationsError) return sendError(reply, error.statusCode, error.code, error.message);
  throw error;
}

export function registerOperationsRoutes(app: FastifyInstance, options: OperationsRoutesOptions): void {
  const { database } = options;

  async function withBody<T>(
    request: FastifyRequest,
    reply: FastifyReply,
    parse: (body: unknown) => Parsed<T>,
  ): Promise<{ readonly call: AdminCall; readonly body: T } | null> {
    const call = beginAdminCall(request, reply);
    if (call === null) return null;
    const parsed = parse(request.body);
    if (!parsed.ok) {
      badRequest(reply, parsed.code);
      return null;
    }
    return { call, body: parsed.value };
  }

  const notFound = (reply: FastifyReply, code: string, message: string) => sendError(reply, 404, code, message);

  async function publishAfterCommit(): Promise<void> {
    if (options.enqueuer === undefined) return;
    await dispatchScheduledMatches(database, options.enqueuer).catch(() => undefined);
  }

  // ------------------------------------------------------------ teams
  for (const [path, run] of [['suspend', suspendTeam], ['unsuspend', unsuspendTeam]] as const) {
    app.post<{ Params: { teamId: string } }>(`${BASE}/teams/:teamId/${path}`, async (request, reply) => {
      const parsed = await withBody(request, reply, parseReasonBody);
      if (parsed === null) return reply;
      const teamId = parseUuid(request.params.teamId);
      if (teamId === null) return notFound(reply, 'TEAM_NOT_FOUND', 'Team not found');
      try {
        const outcome = await run(database, contextFor(parsed.call, parsed.body.reason), teamId);
        if (path === 'suspend' && options.sessionStore !== undefined) {
          const accountIds = (outcome as PrivilegedOutcome<readonly string[]>).effects ?? [];
          await Promise.all(accountIds.map((id) => options.sessionStore!.revokeAccount(id)));
        }
        const { status, body } = respond(parsed.call, outcome);
        return reply.status(status).send(body);
      } catch (error) {
        return handleFailure(reply, error);
      }
    });
  }

  // ------------------------------------------------------------ submissions
  app.post<{ Params: { id: string } }>(`${BASE}/submissions/:id/revoke`, async (request, reply) => {
    const parsed = await withBody(request, reply, parseReasonBody);
    if (parsed === null) return reply;
    const id = parseUuid(request.params.id);
    if (id === null) return notFound(reply, 'SUBMISSION_NOT_FOUND', 'Submission not found');
    try {
      const { status, body } = respond(parsed.call, await revokeSubmission(database, contextFor(parsed.call, parsed.body.reason), id));
      return reply.status(status).send(body);
    } catch (error) {
      return handleFailure(reply, error);
    }
  });

  // ------------------------------------------------------------ matches
  app.post<{ Params: { id: string } }>(`${BASE}/matches/:id/cancel`, async (request, reply) => {
    const parsed = await withBody(request, reply, parseCancelBody);
    if (parsed === null) return reply;
    const id = parseUuid(request.params.id);
    if (id === null) return notFound(reply, 'MATCH_NOT_FOUND', 'Match not found');
    try {
      const outcome = await cancelMatch(database, contextFor(parsed.call, parsed.body.reason), id, parsed.body);
      const { status, body } = respond(parsed.call, outcome);
      return reply.status(status).send(body);
    } catch (error) {
      return handleFailure(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>(`${BASE}/matches/:id/rerun`, async (request, reply) => {
    const parsed = await withBody(request, reply, parseRerunBody);
    if (parsed === null) return reply;
    const id = parseUuid(request.params.id);
    if (id === null) return notFound(reply, 'MATCH_NOT_FOUND', 'Match not found');
    try {
      const outcome = await rerunMatch(database, contextFor(parsed.call, parsed.body.reason), id, parsed.body);
      if (!outcome.replayed) await publishAfterCommit();
      const { status, body } = respond(parsed.call, outcome);
      return reply.status(status).send(body);
    } catch (error) {
      return handleFailure(reply, error);
    }
  });

  // ------------------------------------------------------------ audit
  app.get(`${BASE}/audit`, async (request, reply) => {
    const call = beginAdminCall(request, reply);
    if (call === null) return reply;
    const query = parseAuditQuery(request.query);
    if (!query.ok) return badRequest(reply, query.code);
    const { items, total } = await listAudit(database, query.value);
    const data = items.map((item) => sanitizeAuditRecord({ ...item }));
    return {
      data: { items: data },
      pagination: { page: query.value.page, pageSize: query.value.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / query.value.pageSize)) },
      correlationId: call.correlationId,
    };
  });

  app.get(`${BASE}/audit/export`, async (request, reply) => {
    const call = beginAdminCall(request, reply);
    if (call === null) return reply;
    const query = parseAuditQuery(request.query, 100);
    if (!query.ok) return badRequest(reply, query.code);
    const records = (await exportAudit(database, query.value)).map((item) => sanitizeAuditRecord({ ...item }));
    return reply.type('application/x-ndjson; charset=utf-8').send(toNdjson(records));
  });

  // ------------------------------------------------------------ public
  app.get('/api/v1/public/queue-overrides', async (_request, reply) => {
    const items = await listPublicQueueOverrides(database);
    return reply.header('Cache-Control', 'public, max-age=30').send({ data: { items } });
  });
}
