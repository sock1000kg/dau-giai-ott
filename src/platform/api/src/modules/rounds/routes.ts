import type { FastifyInstance, FastifyReply } from 'fastify';

import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import {
  createRound,
  createRuleSet,
  executeTransition,
  getRound,
  getRuleSet,
  listRounds,
  listRuleSets,
  type CreateRuleSetInput,
  type TransitionInput,
} from './service.ts';
import type { RoundAction } from './types.ts';

export interface RoundRoutesOptions {
  readonly database: Database;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendRoundError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof Error)) throw error;
  const clientErrors: Readonly<Record<string, Readonly<{ statusCode: number; code: string; message: string }>>> = {
    TOURNAMENT_STAGE_INVALID: { statusCode: 400, code: 'TOURNAMENT_STAGE_INVALID', message: 'Invalid tournament stage' },
    INVALID_REASON: { statusCode: 400, code: 'INVALID_REASON', message: 'Reason must be 1-500 characters' },
    RULE_SET_INVALID: { statusCode: 400, code: 'RULE_SET_INVALID', message: 'Invalid rule set' },
    ROUND_ALREADY_EXISTS_IN_STAGE: { statusCode: 409, code: 'ROUND_ALREADY_EXISTS_IN_STAGE', message: 'A round already exists in this stage' },
    ROUND_NOT_FOUND: { statusCode: 404, code: 'ROUND_NOT_FOUND', message: 'Round not found' },
    RULE_SET_NOT_FOUND: { statusCode: 404, code: 'RULE_SET_NOT_FOUND', message: 'Rule set not found' },
    RULE_SET_STAGE_MISMATCH: { statusCode: 409, code: 'RULE_SET_STAGE_MISMATCH', message: 'Rule set does not belong to this stage' },
    IDEMPOTENCY_KEY_INVALID: { statusCode: 400, code: 'IDEMPOTENCY_KEY_INVALID', message: 'Invalid idempotency key' },
    IDEMPOTENCY_KEY_REUSED: { statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED', message: 'Idempotency key was already used for another request' },
    ROUND_TRANSITION_INVALID: { statusCode: 409, code: 'ROUND_TRANSITION_INVALID', message: 'This transition is not allowed' },
  };
  const clientError = clientErrors[error.message];
  if (clientError === undefined) throw error;
  return reply.status(clientError.statusCode).send({ error: { code: clientError.code, message: clientError.message } });
}

function validateStageQuery(query: unknown): string | null {
  if (typeof query !== 'object' || query === null) return null;
  const stage = (query as Record<string, unknown>).tournamentStage;
  if (typeof stage !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(stage)) return null;
  return stage;
}

function validateCreateRuleSetBody(body: unknown): CreateRuleSetInput | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((key) => !['tournamentStage', 'rules', 'reason'].includes(key))) return null;
  if (typeof b.tournamentStage !== 'string') return null;
  if (typeof b.reason !== 'string') return null;
  if (b.rules === undefined || b.rules === null) return null;
  return { tournamentStage: b.tournamentStage, rules: b.rules, reason: b.reason, actorAccountId: '' };
}

function validateCreateRoundBody(body: unknown): { readonly tournamentStage: string; readonly reason: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((key) => !['tournamentStage', 'reason'].includes(key))) return null;
  if (typeof b.tournamentStage !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(b.tournamentStage)) return null;
  if (typeof b.reason !== 'string') return null;
  return { tournamentStage: b.tournamentStage, reason: b.reason };
}

function validateTransitionBody(body: unknown, actionType: string): { readonly reason: string; readonly ruleSetId?: string } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const allowedKeys = actionType === 'open' || actionType === 'start' ? ['reason', 'ruleSetId'] : ['reason'];
  if (Object.keys(b).some((key) => !allowedKeys.includes(key))) return null;
  if (typeof b.reason !== 'string') return null;
  if (actionType === 'open' || actionType === 'start') {
    if (typeof b.ruleSetId !== 'string' || !uuidPattern.test(b.ruleSetId)) return null;
    return { reason: b.reason, ruleSetId: b.ruleSetId };
  }
  return { reason: b.reason };
}

function buildAction(type: string, ruleSetId?: string, idempotencyKey?: string): RoundAction | null {
  switch (type) {
    case 'open':
      if (!ruleSetId) return null;
      return { type: 'open', ruleSetId };
    case 'close':
      return { type: 'close' };
    case 'start':
      if (!ruleSetId || !idempotencyKey) return null;
      return { type: 'start', ruleSetId, idempotencyKey };
    case 'pause':
      return { type: 'pause' };
    case 'resume':
      return { type: 'resume' };
    case 'reconcile':
      return { type: 'reconcile' };
    case 'publish':
      return { type: 'publish' };
    default:
      return null;
  }
}

export function registerRoundRoutes(app: FastifyInstance, options: RoundRoutesOptions): void {
  app.get('/api/v1/admin/round-rule-sets', async (request, reply) => {
    requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const stage = validateStageQuery(request.query);
    if (!stage) return reply.status(400).send({ error: { code: 'TOURNAMENT_STAGE_INVALID', message: 'Invalid tournament stage' } });
    try {
      const items = await listRuleSets(options.database, stage);
      return { data: { items } };
    } catch (error) {
      return sendRoundError(reply, error);
    }
  });

  app.get<{ Params: { ruleSetId: string } }>('/api/v1/admin/round-rule-sets/:ruleSetId', async (request, reply) => {
    requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    if (!uuidPattern.test(request.params.ruleSetId)) return reply.status(404).send({ error: { code: 'RULE_SET_NOT_FOUND', message: 'Rule set not found' } });
    try {
      const item = await getRuleSet(options.database, request.params.ruleSetId);
      if (!item) return reply.status(404).send({ error: { code: 'RULE_SET_NOT_FOUND', message: 'Rule set not found' } });
      return { data: item };
    } catch (error) {
      return sendRoundError(reply, error);
    }
  });

  app.post('/api/v1/admin/round-rule-sets', async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const body = validateCreateRuleSetBody(request.body);
    if (!body) return reply.status(400).send({ error: { code: 'RULE_SET_INVALID', message: 'Invalid rule set' } });
    try {
      const result = await createRuleSet(options.database, { ...body, actorAccountId: actor.accountId });
      return reply.status(201).send({ data: { id: result.id, version: result.version, rulesSha256: result.rulesSha256 } });
    } catch (error) {
      return sendRoundError(reply, error);
    }
  });

  app.get('/api/v1/admin/rounds', async (request, reply) => {
    requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const stage = validateStageQuery(request.query);
    if (!stage) return reply.status(400).send({ error: { code: 'TOURNAMENT_STAGE_INVALID', message: 'Invalid tournament stage' } });
    try {
      const items = await listRounds(options.database, stage);
      return { data: { items } };
    } catch (error) {
      return sendRoundError(reply, error);
    }
  });

  app.get<{ Params: { roundId: string } }>('/api/v1/admin/rounds/:roundId', async (request, reply) => {
    requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    if (!uuidPattern.test(request.params.roundId)) return reply.status(404).send({ error: { code: 'ROUND_NOT_FOUND', message: 'Round not found' } });
    try {
      const item = await getRound(options.database, request.params.roundId);
      if (!item) return reply.status(404).send({ error: { code: 'ROUND_NOT_FOUND', message: 'Round not found' } });
      return { data: item };
    } catch (error) {
      return sendRoundError(reply, error);
    }
  });

  app.post('/api/v1/admin/rounds', async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const body = validateCreateRoundBody(request.body);
    if (!body) return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Invalid round creation body' } });
    try {
      const result = await createRound(options.database, { tournamentStage: body.tournamentStage, reason: body.reason, actorAccountId: actor.accountId });
      return reply.status(201).send({ data: result });
    } catch (error) {
      return sendRoundError(reply, error);
    }
  });

  const transitionActions = ['open', 'close', 'start', 'pause', 'resume', 'reconcile', 'publish'] as const;
  for (const action of transitionActions) {
    app.post<{ Params: { roundId: string }; Body: Record<string, unknown> }>(
      `/api/v1/admin/rounds/:roundId/${action}`,
      async (request, reply) => {
        const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
        if (!uuidPattern.test(request.params.roundId)) return reply.status(404).send({ error: { code: 'ROUND_NOT_FOUND', message: 'Round not found' } });
        const body = validateTransitionBody(request.body, action);
        if (!body) return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Invalid transition body' } });
        if (action === 'start') {
          const idempotencyKey = request.headers['idempotency-key'];
          if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 200) {
            return reply.status(400).send({ error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key header is required (1-200 chars)' } });
          }
        }
        const roundAction = buildAction(action, body.ruleSetId, action === 'start' ? request.headers['idempotency-key'] as string : undefined);
        if (!roundAction) return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Invalid transition body' } });
        const input: TransitionInput = {
          roundId: request.params.roundId,
          action: roundAction,
          reason: body.reason,
          actorAccountId: actor.accountId,
          idempotencyKey: action === 'start' ? (request.headers['idempotency-key'] as string) : (undefined as string | undefined),
        };
        try {
          const result = await executeTransition(options.database, input);
          return { data: result };
        } catch (error) {
          return sendRoundError(reply, error);
        }
      },
    );
  }
}