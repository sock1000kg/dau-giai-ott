import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.ts';
import type { ObjectStorage } from '../../storage/s3.ts';
import { requireAuthenticated } from '../auth/authorize.ts';
import {
  createTestRun,
  getTestRunById,
  listTestRuns,
  TestRunError,
  type TestRunEnqueuer,
  type TestRunOpponentType,
} from './service.ts';

export interface TestRunRoutesOptions {
  readonly database: Database;
  readonly storage?: ObjectStorage | undefined;
  readonly enqueuer?: TestRunEnqueuer | undefined;
}

interface CreateTestRunBody {
  readonly submissionId: string;
  readonly opponentType: TestRunOpponentType;
  readonly opponentSubmissionId?: string;
  readonly opponentReferenceBot?: string;
  readonly roundId?: string;
  readonly teamId?: string; // BTC_ADMIN override
}

export function registerTestRunRoutes(
  app: FastifyInstance,
  options: TestRunRoutesOptions,
): void {
  // 1. POST /api/v1/test-runs
  app.post(
    '/api/v1/test-runs',
    async (request: FastifyRequest<{ Body: CreateTestRunBody }>, reply: FastifyReply) => {
      const principal = requireAuthenticated(request.principal);

      let targetTeamId: string;
      if (principal.role === 'TEAM_ACCOUNT') {
        if (!principal.teamId) {
          return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Team account without team' } });
        }
        targetTeamId = principal.teamId;
      } else if (principal.role === 'BTC_ADMIN') {
        if (!request.body?.teamId) {
          return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'teamId is required for BTC_ADMIN' } });
        }
        targetTeamId = request.body.teamId;
      } else {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Unauthorized role' } });
      }

      const { submissionId, opponentType, opponentSubmissionId, opponentReferenceBot, roundId } = request.body ?? {};

      if (!submissionId || !opponentType) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'submissionId and opponentType are required' },
        });
      }

      try {
        const testRun = await createTestRun(options.database, options.enqueuer, {
          teamId: targetTeamId,
          submissionId,
          opponentType,
          opponentSubmissionId: opponentSubmissionId ?? undefined,
          opponentReferenceBot: opponentReferenceBot ?? undefined,
          roundId: roundId ?? undefined,
        });

        return reply.status(201).send({ data: testRun });
      } catch (error) {
        if (error instanceof TestRunError) {
          if (error.status === 429) {
            reply.header('Retry-After', '3600');
          }
          return reply.status(error.status).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );

  // 2. GET /api/v1/test-runs
  app.get('/api/v1/test-runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = requireAuthenticated(request.principal);
    const callerTeamId = principal.teamId !== null ? principal.teamId : undefined;
    const runs = await listTestRuns(options.database, {
      role: principal.role,
      teamId: callerTeamId,
    });
    return reply.status(200).send({ data: runs });
  });

  // 3. GET /api/v1/test-runs/:id
  app.get(
    '/api/v1/test-runs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const principal = requireAuthenticated(request.principal);
      const testRunId = request.params.id;
      const callerTeamId = principal.teamId !== null ? principal.teamId : undefined;

      try {
        const testRun = await getTestRunById(options.database, testRunId, {
          role: principal.role,
          teamId: callerTeamId,
        });
        return reply.status(200).send({ data: testRun });
      } catch (error) {
        if (error instanceof TestRunError) {
          return reply.status(error.status).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );

  // 4. GET /api/v1/test-runs/:id/replay
  app.get(
    '/api/v1/test-runs/:id/replay',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const principal = requireAuthenticated(request.principal);
      const testRunId = request.params.id;
      const callerTeamId = principal.teamId !== null ? principal.teamId : undefined;

      try {
        const testRun = await getTestRunById(options.database, testRunId, {
          role: principal.role,
          teamId: callerTeamId,
        });

        if (!testRun.replayKey) {
          return reply.status(404).send({
            error: { code: 'REPLAY_NOT_FOUND', message: 'Replay not available for this test run' },
          });
        }

        if (!options.storage) {
          return reply.status(500).send({
            error: { code: 'STORAGE_UNAVAILABLE', message: 'Object storage not configured' },
          });
        }

        const replayBytes = await options.storage.get(testRun.replayKey);
        const replayJson = JSON.parse(new TextDecoder().decode(replayBytes));

        reply.header('Cache-Control', 'private, no-store');
        return reply.status(200).send({ data: replayJson });
      } catch (error) {
        if (error instanceof TestRunError) {
          return reply.status(error.status).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );
}

