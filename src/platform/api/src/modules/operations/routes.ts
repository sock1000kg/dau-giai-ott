import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import type { SessionStore } from '../auth/sessions.ts';
import { dispatchScheduledMatches, type MatchJobEnqueuer } from '../scheduling/service.ts';
import { sanitizeAuditRecord, sanitizeCaseRecord, toNdjson } from './export.ts';
import {
  addCaseEvidence,
  cancelMatch,
  changeCaseStatus,
  decideCase,
  exportAudit,
  exportCases,
  getCase,
  listAudit,
  listCases,
  listPublicQueueOverrides,
  openCase,
  openCaseFromDuplicate,
  rerunMatch,
  revokeSubmission,
  suspendTeam,
  unsuspendTeam,
  type PrivilegedContext,
  type PrivilegedOutcome,
} from './service.ts';
import {
  CASE_KINDS,
  CASE_STATUSES,
  OperationsError,
  parseAuditQuery,
  parseCancelBody,
  parseDecisionBody,
  parseEvidenceBody,
  parseIdempotencyKey,
  parseOpenCaseBody,
  parseReasonBody,
  parseRerunBody,
  parseStatusBody,
  parseUuid,
  resolveCorrelationId,
  type CaseKind,
  type CaseStatus,
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
  INVALID_EVIDENCE: 'Evidence is invalid',
  INVALID_CASE_KIND: 'Invalid case kind',
  INVALID_CASE_STATUS: 'Invalid case status',
  INVALID_CASE_DECISION: 'Invalid case decision',
  CASE_SUBJECT_REQUIRED: 'Case subject is required',
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

function pagination(query: unknown): { readonly page: number; readonly pageSize: number } | null {
  const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
  const page = q.page === undefined ? 1 : Number(q.page);
  const pageSize = q.pageSize === undefined ? 20 : Number(q.pageSize);
  if (!Number.isInteger(page) || !Number.isInteger(pageSize) || page < 1 || pageSize < 1 || pageSize > 100) return null;
  return { page, pageSize };
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

  // ------------------------------------------------------------ cases
  app.post(`${BASE}/cases`, async (request, reply) => {
    const parsed = await withBody(request, reply, parseOpenCaseBody);
    if (parsed === null) return reply;
    try {
      const { status, body } = respond(parsed.call, await openCase(database, contextFor(parsed.call, parsed.body.reason), parsed.body), 201);
      return reply.status(status).send(body);
    } catch (error) {
      return handleFailure(reply, error);
    }
  });

  app.post<{ Params: { submissionId: string } }>(`${BASE}/cases/from-duplicate/:submissionId`, async (request, reply) => {
    const parsed = await withBody(request, reply, parseReasonBody);
    if (parsed === null) return reply;
    const submissionId = parseUuid(request.params.submissionId);
    if (submissionId === null) return notFound(reply, 'SUBMISSION_NOT_FOUND', 'Submission not found');
    try {
      const { status, body } = respond(parsed.call, await openCaseFromDuplicate(database, contextFor(parsed.call, parsed.body.reason), submissionId), 201);
      return reply.status(status).send(body);
    } catch (error) {
      return handleFailure(reply, error);
    }
  });

  app.get(`${BASE}/cases`, async (request, reply) => {
    const call = beginAdminCall(request, reply);
    if (call === null) return reply;
    const page = pagination(request.query);
    const q = (typeof request.query === 'object' && request.query !== null ? request.query : {}) as Record<string, unknown>;
    const status = q.status === undefined ? null : (CASE_STATUSES as readonly unknown[]).includes(q.status) ? q.status as CaseStatus : undefined;
    const kind = q.kind === undefined ? null : (CASE_KINDS as readonly unknown[]).includes(q.kind) ? q.kind as CaseKind : undefined;
    if (page === null || status === undefined || kind === undefined) return badRequest(reply, 'INVALID_QUERY');
    const { items, total } = await listCases(database, { status, kind, ...page });
    return { data: { items }, pagination: { ...page, totalItems: total, totalPages: Math.max(1, Math.ceil(total / page.pageSize)) }, correlationId: call.correlationId };
  });

  app.get(`${BASE}/cases/export`, async (request, reply) => {
    const call = beginAdminCall(request, reply);
    if (call === null) return reply;
    const records = (await exportCases(database)).map((item) => sanitizeCaseRecord({ ...item }));
    return reply.type('application/x-ndjson; charset=utf-8').send(toNdjson(records));
  });

  app.get<{ Params: { id: string } }>(`${BASE}/cases/:id`, async (request, reply) => {
    const call = beginAdminCall(request, reply);
    if (call === null) return reply;
    const id = parseUuid(request.params.id);
    const item = id === null ? null : await getCase(database, id);
    if (item === null) return notFound(reply, 'CASE_NOT_FOUND', 'Case not found');
    return { data: item, correlationId: call.correlationId };
  });

  app.post<{ Params: { id: string } }>(`${BASE}/cases/:id/evidence`, async (request, reply) => {
    const parsed = await withBody(request, reply, parseEvidenceBody);
    if (parsed === null) return reply;
    const id = parseUuid(request.params.id);
    if (id === null) return notFound(reply, 'CASE_NOT_FOUND', 'Case not found');
    try {
      const { status, body } = respond(parsed.call, await addCaseEvidence(database, contextFor(parsed.call, parsed.body.reason), id, parsed.body.evidence), 201);
      return reply.status(status).send(body);
    } catch (error) {
      return handleFailure(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>(`${BASE}/cases/:id/status`, async (request, reply) => {
    const parsed = await withBody(request, reply, parseStatusBody);
    if (parsed === null) return reply;
    const id = parseUuid(request.params.id);
    if (id === null) return notFound(reply, 'CASE_NOT_FOUND', 'Case not found');
    try {
      const { status, body } = respond(parsed.call, await changeCaseStatus(database, contextFor(parsed.call, parsed.body.reason), id, parsed.body.status));
      return reply.status(status).send(body);
    } catch (error) {
      return handleFailure(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>(`${BASE}/cases/:id/decision`, async (request, reply) => {
    const parsed = await withBody(request, reply, parseDecisionBody);
    if (parsed === null) return reply;
    const id = parseUuid(request.params.id);
    if (id === null) return notFound(reply, 'CASE_NOT_FOUND', 'Case not found');
    try {
      const { status, body } = respond(parsed.call, await decideCase(database, contextFor(parsed.call, parsed.body.reason), id, parsed.body.decision));
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
