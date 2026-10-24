import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.ts';
import type { ObjectStorage } from '../../storage/s3.ts';
import { AuthorizationError, requireAuthenticated } from '../auth/authorize.ts';
import {
  createTestRun,
  getTestRunPolicy,
  getTestRunById,
  listTestRunsPage,
  TestRunError,
  type TestRunEnqueuer,
  type TestRunOpponentType,
} from './service.ts';
import { ReplayApiError, getTestRunReplayArtifact } from '../replays/service.ts';

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
  readonly mapId?: string;
  readonly mapChecksum?: string;
  readonly teamId?: string; // BTC_ADMIN override
}

function requireTestRunRole(request: FastifyRequest): ReturnType<typeof requireAuthenticated> {
  const principal = requireAuthenticated(request.principal);
  const role: string = principal.role;
  if (role !== 'TEAM_ACCOUNT' && role !== 'BTC_ADMIN') {
    throw new AuthorizationError('FORBIDDEN', 403, 'You are not allowed to access this resource');
  }
  return principal;
}

function publicTestRun(run: Awaited<ReturnType<typeof getTestRunById>>) {
  return {
    id: run.id,
    roundId: run.roundId,
    submissionId: run.submissionId,
    opponentType: run.opponentType,
    opponentSubmissionId: run.opponentSubmissionId,
    opponentReferenceBot: run.opponentReferenceBot,
    status: run.status,
    quotaConsumed: run.quotaConsumed,
    result: run.result,
    stderrX: run.stderrX,
    stderrO: run.stderrO,
    failureReason: run.failureReason,
    isInfraFailure: run.isInfraFailure,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

export function registerTestRunRoutes(
  app: FastifyInstance,
  options: TestRunRoutesOptions,
): void {
  // 1. POST /api/v1/test-runs
  app.post(
    '/api/v1/test-runs',
    async (request: FastifyRequest<{ Body: CreateTestRunBody }>, reply: FastifyReply) => {
      const principal = requireTestRunRole(request);

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

      const { submissionId, opponentType, opponentSubmissionId, opponentReferenceBot, roundId, mapId, mapChecksum } = request.body ?? {};
      const idempotencyKey = request.headers['idempotency-key'];
      if (principal.role === 'BTC_ADMIN' && !request.body?.teamId) {
        return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'teamId is required for BTC_ADMIN' } });
      }

      if (!submissionId || !opponentType) {
        return reply.status(400).send({
          error: { code: 'BAD_REQUEST', message: 'submissionId and opponentType are required' },
        });
      }
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8 || idempotencyKey.length > 200) {
        return reply.status(400).send({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header (8-200 characters) is required' } });
      }

      try {
        const testRun = await createTestRun(options.database, options.enqueuer, {
          teamId: targetTeamId,
          submissionId,
          opponentType,
          opponentSubmissionId: opponentSubmissionId ?? undefined,
          opponentReferenceBot: opponentReferenceBot ?? undefined,
          roundId: roundId ?? undefined,
          mapId: mapId ?? undefined,
          mapChecksum: mapChecksum ?? undefined,
          idempotencyKey,
        });

        return reply.status(testRun.status === 'QUEUED' ? 201 : 200).send({ data: publicTestRun(testRun) });
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
  app.get('/api/v1/test-runs', async (request: FastifyRequest<{ Querystring: { page?: string; pageSize?: string } }>, reply: FastifyReply) => {
    const principal = requireTestRunRole(request);
    const callerTeamId = principal.teamId !== null ? principal.teamId : undefined;
    const page = Number(request.query.page ?? 1);
    const pageSize = Number(request.query.pageSize ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return reply.status(400).send({ error: { code: 'BAD_PAGINATION', message: 'page must be >= 1 and pageSize must be 1..100' } });
    }
    const runs = await listTestRunsPage(options.database, {
      role: principal.role,
      teamId: callerTeamId,
    }, page, pageSize);
    return reply.status(200).send({ data: runs.data.map(publicTestRun), pagination: { page, pageSize, totalItems: runs.totalItems, totalPages: Math.ceil(runs.totalItems / pageSize) } });
  });

  app.get('/api/v1/test-run-policy', async (request: FastifyRequest<{ Querystring: { roundId?: string; teamId?: string } }>, reply: FastifyReply) => {
    const principal = requireTestRunRole(request);
    const teamId = principal.role === 'BTC_ADMIN' ? request.query.teamId : principal.teamId ?? undefined;
    if (!teamId) return reply.status(400).send({ error: { code: 'TEAM_ID_REQUIRED', message: 'A team context is required' } });
    if (principal.role !== 'TEAM_ACCOUNT' && principal.role !== 'BTC_ADMIN') return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Unauthorized role' } });
    const policy = await getTestRunPolicy(options.database, teamId, options.enqueuer, request.query.roundId);
    return reply.status(200).send({ data: policy });
  });

  // 3. GET /api/v1/test-runs/:id
  app.get(
    '/api/v1/test-runs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const principal = requireTestRunRole(request);
      const testRunId = request.params.id;
      const callerTeamId = principal.teamId !== null ? principal.teamId : undefined;

      try {
        const testRun = await getTestRunById(options.database, testRunId, {
          role: principal.role,
          teamId: callerTeamId,
        });
        return reply.status(200).send({ data: publicTestRun(testRun) });
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
      const principal = requireTestRunRole(request);
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
        if (!testRun.replaySha256 || !testRun.finalStateHash) throw new ReplayApiError(409, 'REPLAY_INTEGRITY_FAILED', 'Replay integrity metadata unavailable');
        const artifact = getTestRunReplayArtifact(replayBytes, testRun.id, testRun.replaySha256, testRun.finalStateHash);
        reply.header('Cache-Control', 'private, no-store');
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Replay-Sha256', artifact.checksum);
        reply.header('Content-Type', `application/vnd.ott.spectator-replay+json;version=${artifact.version}`);
        return reply.status(200).send(artifact.body);
      } catch (error) {
        if (error instanceof ReplayApiError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
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

