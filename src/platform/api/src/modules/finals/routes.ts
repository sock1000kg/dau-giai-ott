import { createHash } from 'node:crypto';

import type { FastifyInstance, FastifyReply } from 'fastify';

import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import {
  closeLanCutoff,
  createFinalsCompetition,
  createFinalsRuleSet,
  FinalsRuleSetInvalidError,
  getFinalsCompetition,
  openLanSubmission,
  pinFinalsSubmission,
  seedFinalsCompetition,
} from './service.ts';

export interface FinalsRoutesOptions {
  readonly database: Database;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clientErrors: Readonly<Record<string, Readonly<{ statusCode: number; message: string }>>> = {
  INVALID_REASON: { statusCode: 400, message: 'Reason must be 1-500 characters' },
  TOURNAMENT_STAGE_INVALID: { statusCode: 400, message: 'Invalid tournament stage' },
  REQUEST_HASH_INVALID: { statusCode: 400, message: 'Invalid request hash' },
  IDEMPOTENCY_KEY_INVALID: { statusCode: 400, message: 'Idempotency-Key header is required (1-200 chars)' },
  IDEMPOTENCY_KEY_REUSED: { statusCode: 409, message: 'Idempotency key was already used for another request' },
  ARTIFACT_HASH_INVALID: { statusCode: 400, message: 'artifactSha256 must be a 64-character hex digest' },
  FINALS_WINDOW_INVALID: { statusCode: 400, message: 'The LAN submission window is invalid' },
  FINALS_RULE_SET_NOT_FOUND: { statusCode: 404, message: 'Finals rule set not found' },
  FINALS_RULE_SET_STAGE_MISMATCH: { statusCode: 409, message: 'Rule set does not belong to this stage' },
  FINALS_COMPETITION_NOT_FOUND: { statusCode: 404, message: 'Finals competition not found' },
  FINALS_ALREADY_SEEDED: { statusCode: 409, message: 'The finals ranking is already locked' },
  FINALS_STATUS_INVALID: { statusCode: 409, message: 'This transition is not allowed in the current status' },
  FINALS_CUTOFF_CLOSED: { statusCode: 409, message: 'The LAN cutoff is already closed' },
  FINALS_PIN_CONFLICT: { statusCode: 409, message: 'A LAN submission is already pinned for this team' },
  FINALS_SEED_COUNT_INVALID: { statusCode: 409, message: 'Exactly eight eligible teams are required to seed finals' },
  FINALS_DRAW_SEED_INVALID: { statusCode: 400, message: 'drawSeed must be a published non-empty value' },
  FINALS_CANDIDATE_DUPLICATE: { statusCode: 409, message: 'Duplicate team or submission in the ranking' },
  FINALS_CANDIDATE_INVALID: { statusCode: 409, message: 'Ranking metric is not a safe integer' },
  FINALS_SEED_INVALID: { statusCode: 409, message: 'Locked seeding is not the unique ordinal 1..8' },
};

function sendFinalsError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof Error)) throw error;
  if (error instanceof FinalsRuleSetInvalidError) {
    return reply.status(400).send({
      error: { code: 'FINALS_RULE_SET_INVALID', message: 'Invalid finals rule set', details: error.details },
    });
  }
  const clientError = clientErrors[error.message];
  if (clientError === undefined) throw error;
  return reply.status(clientError.statusCode).send({ error: { code: error.message, message: clientError.message } });
}

function readUuid(value: unknown): string | null {
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}

function readString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= max ? value : null;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function requestHashOf(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export function registerFinalsRoutes(app: FastifyInstance, options: FinalsRoutesOptions): void {
  app.post('/api/v1/admin/finals/rule-sets', async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const body = request.body as Record<string, unknown> | null;
    const tournamentStage = readString(body?.['tournamentStage'], 64);
    const reason = readString(body?.['reason'], 500);
    if (tournamentStage === null || reason === null || body?.['rules'] === undefined) {
      return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Invalid rule set body' } });
    }
    try {
      const result = await createFinalsRuleSet(options.database, {
        tournamentStage,
        rules: body['rules'],
        reason,
        actorAccountId: actor.accountId,
      });
      return reply.status(201).send({ data: result });
    } catch (error) {
      return sendFinalsError(reply, error);
    }
  });

  app.post('/api/v1/admin/finals/competitions', async (request, reply) => {
    const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    const body = request.body as Record<string, unknown> | null;
    const tournamentStage = readString(body?.['tournamentStage'], 64);
    const ruleSetId = readUuid(body?.['ruleSetId']);
    const reason = readString(body?.['reason'], 500);
    if (tournamentStage === null || ruleSetId === null || reason === null) {
      return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Invalid competition body' } });
    }
    const bronzeMatchEnabled = body?.['bronzeMatchEnabled'];
    if (bronzeMatchEnabled !== undefined && typeof bronzeMatchEnabled !== 'boolean') {
      return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Invalid competition body' } });
    }
    try {
      const result = await createFinalsCompetition(options.database, {
        tournamentStage,
        ruleSetId,
        ...(typeof bronzeMatchEnabled === 'boolean' ? { bronzeMatchEnabled } : {}),
        reason,
        actorAccountId: actor.accountId,
      });
      return reply.status(201).send({ data: result });
    } catch (error) {
      return sendFinalsError(reply, error);
    }
  });

  app.get<{ Params: { competitionId: string } }>(
    '/api/v1/admin/finals/competitions/:competitionId',
    async (request, reply) => {
      requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      if (readUuid(request.params.competitionId) === null) {
        return reply
          .status(404)
          .send({ error: { code: 'FINALS_COMPETITION_NOT_FOUND', message: 'Finals competition not found' } });
      }
      try {
        const item = await getFinalsCompetition(options.database, request.params.competitionId);
        if (item === null) {
          return reply
            .status(404)
            .send({ error: { code: 'FINALS_COMPETITION_NOT_FOUND', message: 'Finals competition not found' } });
        }
        return { data: item };
      } catch (error) {
        return sendFinalsError(reply, error);
      }
    },
  );

  app.post<{ Params: { competitionId: string } }>(
    '/api/v1/admin/finals/competitions/:competitionId/seed',
    async (request, reply) => {
      const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      const competitionId = readUuid(request.params.competitionId);
      const body = request.body as Record<string, unknown> | null;
      const drawSeed = readString(body?.['drawSeed'], 200);
      const reason = readString(body?.['reason'], 500);
      if (competitionId === null || drawSeed === null || reason === null) {
        return reply.status(400).send({
          error: { code: 'FINALS_DRAW_SEED_INVALID', message: 'drawSeed must be a published non-empty value' },
        });
      }
      const minimumSeries = body?.['minimumSeries'];
      if (minimumSeries !== undefined && !(Number.isSafeInteger(minimumSeries) && (minimumSeries as number) >= 1)) {
        return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Invalid minimumSeries' } });
      }
      try {
        const result = await seedFinalsCompetition(options.database, {
          competitionId,
          drawSeed,
          reason,
          actorAccountId: actor.accountId,
          ...(Number.isSafeInteger(minimumSeries) ? { minimumSeries: minimumSeries as number } : {}),
        });
        return { data: result };
      } catch (error) {
        return sendFinalsError(reply, error);
      }
    },
  );

  app.post<{ Params: { competitionId: string } }>(
    '/api/v1/admin/finals/competitions/:competitionId/submission-window',
    async (request, reply) => {
      const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      const competitionId = readUuid(request.params.competitionId);
      const body = request.body as Record<string, unknown> | null;
      const opensAt = readDate(body?.['submissionOpensAt']);
      const cutoffAt = readDate(body?.['lanCutoffAt']);
      const reason = readString(body?.['reason'], 500);
      if (competitionId === null || opensAt === null || cutoffAt === null || reason === null) {
        return reply.status(400).send({
          error: { code: 'FINALS_WINDOW_INVALID', message: 'The LAN submission window is invalid' },
        });
      }
      try {
        const result = await openLanSubmission(options.database, {
          competitionId,
          submissionOpensAt: opensAt,
          lanCutoffAt: cutoffAt,
          reason,
          actorAccountId: actor.accountId,
        });
        return { data: result };
      } catch (error) {
        return sendFinalsError(reply, error);
      }
    },
  );

  app.post<{ Params: { competitionId: string } }>(
    '/api/v1/admin/finals/competitions/:competitionId/cutoff',
    async (request, reply) => {
      const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      const competitionId = readUuid(request.params.competitionId);
      if (competitionId === null) {
        return reply
          .status(404)
          .send({ error: { code: 'FINALS_COMPETITION_NOT_FOUND', message: 'Finals competition not found' } });
      }
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        return reply.status(400).send({
          error: { code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key header is required (1-200 chars)' },
        });
      }
      const body = request.body as Record<string, unknown> | null;
      const reason = readString(body?.['reason'], 500);
      if (reason === null) {
        return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Reason must be 1-500 characters' } });
      }
      try {
        const result = await closeLanCutoff(options.database, {
          competitionId,
          idempotencyKey,
          requestHash: requestHashOf(body),
          reason,
          actorAccountId: actor.accountId,
        });
        return { data: result };
      } catch (error) {
        return sendFinalsError(reply, error);
      }
    },
  );

  app.post<{ Params: { competitionId: string } }>(
    '/api/v1/admin/finals/competitions/:competitionId/submission-pins',
    async (request, reply) => {
      const actor = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
      const competitionId = readUuid(request.params.competitionId);
      const body = request.body as Record<string, unknown> | null;
      const teamId = readUuid(body?.['teamId']);
      const submissionId = readUuid(body?.['submissionId']);
      const source = body?.['source'];
      const artifactSha256 = body?.['artifactSha256'];
      const compatible = body?.['compatible'];
      const reason = readString(body?.['reason'], 500);
      if (
        competitionId === null ||
        teamId === null ||
        submissionId === null ||
        reason === null ||
        (source !== 'LAN' && source !== 'QUALIFICATION_ACTIVE') ||
        typeof artifactSha256 !== 'string' ||
        typeof compatible !== 'boolean'
      ) {
        return reply.status(400).send({ error: { code: 'INVALID_REASON', message: 'Invalid submission pin body' } });
      }
      try {
        const result = await pinFinalsSubmission(options.database, {
          competitionId,
          teamId,
          submissionId,
          source,
          artifactSha256,
          compatible,
          reason,
          actorAccountId: actor.accountId,
        });
        return reply.status(201).send({ data: result });
      } catch (error) {
        return sendFinalsError(reply, error);
      }
    },
  );
}
