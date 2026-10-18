import type { FastifyInstance, FastifyReply } from 'fastify';

import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import { parseReason, parseUuid, resolveCorrelationId } from '../operations/types.ts';
import { DEFAULT_GATE_BOT_ID, GateError } from './gate.ts';
import { listGateResults, recordGateResult, type RecordGateInput } from './service.ts';

export interface QualificationGateRoutesOptions {
  readonly database: Database;
}

const BASE = '/api/v1/admin/qualification-gate';
const BODY_KEYS = ['reason', 'submissionId', 'gateBotId', 'gateBotDigest', 'game1MatchId', 'game2MatchId'];
const GATE_BOT_ID_PATTERN = /^[a-z][a-z0-9_]{0,99}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send({ error: { code, message }, correlationId: reply.getHeader('x-correlation-id') });
}

function parseBody(body: unknown): { readonly reason: string; readonly input: RecordGateInput } | { readonly code: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { code: 'INVALID_REQUEST' };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !BODY_KEYS.includes(key))) return { code: 'INVALID_REQUEST' };
  const reason = parseReason(record.reason);
  if (reason === null) return { code: 'INVALID_REASON' };
  const submissionId = parseUuid(record.submissionId);
  const game1MatchId = parseUuid(record.game1MatchId);
  const game2MatchId = parseUuid(record.game2MatchId);
  const gateBotId = record.gateBotId === undefined ? DEFAULT_GATE_BOT_ID : record.gateBotId;
  const gateBotDigest = record.gateBotDigest;
  if (submissionId === null || game1MatchId === null || game2MatchId === null
    || typeof gateBotId !== 'string' || !GATE_BOT_ID_PATTERN.test(gateBotId)
    || typeof gateBotDigest !== 'string' || !DIGEST_PATTERN.test(gateBotDigest)) return { code: 'INVALID_REQUEST' };
  return { reason, input: { submissionId, gateBotId, gateBotDigest, game1MatchId, game2MatchId } };
}

export function registerQualificationGateRoutes(app: FastifyInstance, options: QualificationGateRoutesOptions): void {
  const { database } = options;

  app.post(`${BASE}/results`, async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const correlationId = resolveCorrelationId(request.headers['x-correlation-id']);
    if (correlationId === null) return sendError(reply, 400, 'INVALID_CORRELATION_ID', 'X-Correlation-Id must be a UUID');
    reply.header('X-Correlation-Id', correlationId);
    const parsed = parseBody(request.body);
    if ('code' in parsed) return sendError(reply, 400, parsed.code, parsed.code === 'INVALID_REASON' ? 'Reason must be 1-500 characters' : 'Invalid request body');
    try {
      const { result, replayed } = await recordGateResult(database, { actorAccountId: actor.accountId, correlationId, reason: parsed.reason }, parsed.input);
      return reply.status(replayed ? 200 : 201).send({ data: { ...result, replayed }, correlationId });
    } catch (error) {
      if (error instanceof GateError) return sendError(reply, error.statusCode, error.code, error.message);
      throw error;
    }
  });

  app.get<{ Params: { submissionId: string } }>(`${BASE}/submissions/:submissionId`, async (request, reply) => {
    requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const correlationId = resolveCorrelationId(request.headers['x-correlation-id']);
    if (correlationId === null) return sendError(reply, 400, 'INVALID_CORRELATION_ID', 'X-Correlation-Id must be a UUID');
    reply.header('X-Correlation-Id', correlationId);
    const submissionId = parseUuid(request.params.submissionId);
    if (submissionId === null) return sendError(reply, 400, 'INVALID_REQUEST', 'Invalid submission id');
    const found = await listGateResults(database, submissionId);
    if (found === null) return sendError(reply, 404, 'SUBMISSION_NOT_FOUND', 'Submission not found');
    return { data: { submissionId, rankable: found.rankable, results: found.results }, correlationId };
  });
}
