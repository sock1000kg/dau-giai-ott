import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.ts';
import { appendAuditEvent } from '../auth/audit.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import type { SessionStore } from '../auth/sessions.ts';
import type { PasswordHasher, SessionPrincipal } from '../auth/types.ts';
import {
  BulkConflictError,
  BulkNotFoundError,
  bulkImportTeams,
  bulkResetTeams,
  generateCredential,
  validateCsv,
} from './bulk.ts';

export interface TeamRoutesOptions {
  readonly database: Database;
  readonly passwordHasher: PasswordHasher;
  readonly sessionStore: SessionStore;
}

interface Team {
  readonly id: string;
  readonly name: string;
}

interface TeamWithEmail extends Team {
  readonly representative_email: string | null;
}

interface TeamAccount extends Team {
  readonly account_id: string;
}

const error = (code: string, message: string) => ({ error: { code, message } });
const admin = (request: FastifyRequest): SessionPrincipal =>
  requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
const nameOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100 ? value.trim() : null;
const duplicate = (value: unknown) =>
  typeof value === 'object' && value !== null && 'code' in value && value.code === '23505';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerTeamRoutes(app: FastifyInstance, options: TeamRoutesOptions): void {
  app.post<{ Body: { name?: unknown } }>('/api/v1/admin/teams', async (request, reply) => {
    const actor = admin(request);
    const name = nameOf(request.body?.name);
    if (name === null) return reply.status(400).send(error('INVALID_INPUT', 'Invalid team input'));
    const created = await options.database.transaction(async (db) => {
      const id = randomUUID();
      const secret = generateCredential(name);
      try {
        await db.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [id, name]);
        await db.query(
          "INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4)",
          [randomUUID(), secret.username, await options.passwordHasher.hash(secret.password), id],
        );
        return { id, name, credential: secret };
      } catch (caught: unknown) {
        if (duplicate(caught)) return null;
        throw caught;
      }
    });
    if (created === null) return reply.status(409).send(error('TEAM_NAME_TAKEN', 'Team name already exists'));
    await appendAuditEvent(options.database, actor.accountId, 'TEAM_CREATED', 'TEAM', created.id);
    return reply.status(201).send({ data: created });
  });

  app.get('/api/v1/admin/teams', async (request) => {
    admin(request);
    const result = await options.database.query<TeamWithEmail>(
      'SELECT id, name, representative_email FROM teams ORDER BY name',
    );
    return {
      data: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        representativeEmail: row.representative_email ?? null,
      })),
    };
  });

  app.patch<{ Params: { id: string }; Body: { name?: unknown } }>('/api/v1/admin/teams/:id', async (request, reply) => {
    const actor = admin(request);
    const name = nameOf(request.body?.name);
    if (name === null) return reply.status(400).send(error('INVALID_INPUT', 'Invalid team input'));
    try {
      const result = await options.database.query<Team>(
        'UPDATE teams SET name = $1 WHERE id = $2 RETURNING id, name',
        [name, request.params.id],
      );
      const updated = result.rows[0];
      if (updated === undefined) return reply.status(404).send(error('TEAM_NOT_FOUND', 'Team not found'));
      await appendAuditEvent(options.database, actor.accountId, 'TEAM_UPDATED', 'TEAM', updated.id);
      return { data: updated };
    } catch (caught: unknown) {
      if (duplicate(caught)) return reply.status(409).send(error('TEAM_NAME_TAKEN', 'Team name already exists'));
      throw caught;
    }
  });

  app.post<{ Params: { id: string } }>('/api/v1/admin/teams/:id/reset-credential', async (request, reply) => {
    const actor = admin(request);
    const result = await options.database.query<TeamAccount>(
      "SELECT teams.id, teams.name, accounts.id AS account_id FROM teams JOIN accounts ON accounts.team_id = teams.id WHERE teams.id = $1 AND accounts.role = 'TEAM_ACCOUNT'",
      [request.params.id],
    );
    const team = result.rows[0];
    if (team === undefined) return reply.status(404).send(error('TEAM_NOT_FOUND', 'Team not found'));
    const secret = generateCredential(team.name);
    await options.database.transaction(async (db) => {
      await db.query('UPDATE accounts SET username = $1, password_hash = $2, updated_at = now() WHERE id = $3', [
        secret.username,
        await options.passwordHasher.hash(secret.password),
        team.account_id,
      ]);
      await appendAuditEvent(db, actor.accountId, 'TEAM_CREDENTIAL_RESET', 'TEAM', team.id);
    });
    await options.sessionStore.revokeAccount(team.account_id);
    return { data: { id: team.id, credential: secret } };
  });

  // Bulk import route
  app.post(
    '/api/v1/admin/teams/bulk-import',
    { bodyLimit: 512 * 1024 },
    async (request, reply) => {
      const actor = admin(request);
      const body = request.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return reply.status(400).send(error('INVALID_INPUT', 'Invalid input'));
      }
      const keys = Object.keys(body);
      if (keys.length !== 1 || keys[0] !== 'csv' || typeof (body as { csv?: unknown }).csv !== 'string') {
        return reply.status(400).send(error('INVALID_INPUT', 'Invalid input'));
      }

      const validation = validateCsv((body as { csv: string }).csv);
      if (!validation.ok) {
        return reply.status(400).send({
          error: {
            code: 'CSV_INVALID',
            message: 'CSV validation failed',
            errors: validation.errors,
          },
        });
      }

      try {
        const result = await bulkImportTeams(options.database, options.passwordHasher, actor.accountId, validation.rows);
        return reply
          .status(200)
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .header('Cache-Control', 'no-store')
          .header('Pragma', 'no-cache')
          .header('X-Content-Type-Options', 'nosniff')
          .header('X-Batch-Id', result.batchId)
          .send(result.csvContent);
      } catch (caught: unknown) {
        if (caught instanceof BulkConflictError) {
          return reply.status(409).send({
            error: {
              code: 'CSV_CONFLICT',
              message: 'CSV conflict with existing data',
              errors: caught.errors,
            },
          });
        }
        throw caught;
      }
    },
  );

  // Bulk reset route
  app.post(
    '/api/v1/admin/teams/bulk-reset',
    { bodyLimit: 512 * 1024 },
    async (request, reply) => {
      const actor = admin(request);
      const body = request.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return reply.status(400).send(error('INVALID_INPUT', 'Invalid input'));
      }
      const keys = Object.keys(body);
      if (keys.length !== 1 || keys[0] !== 'teamIds') {
        return reply.status(400).send(error('INVALID_INPUT', 'Invalid input'));
      }

      const teamIds = (body as { teamIds?: unknown }).teamIds;
      if (!Array.isArray(teamIds) || teamIds.length < 1 || teamIds.length > 500) {
        return reply.status(400).send(error('INVALID_INPUT', 'Invalid team IDs'));
      }

      const seenIds = new Set<string>();
      for (const id of teamIds) {
        if (typeof id !== 'string' || !UUID_REGEX.test(id) || seenIds.has(id)) {
          return reply.status(400).send(error('INVALID_INPUT', 'Invalid team IDs'));
        }
        seenIds.add(id);
      }

      try {
        const result = await bulkResetTeams(
          options.database,
          options.passwordHasher,
          options.sessionStore,
          actor.accountId,
          teamIds,
        );
        return reply
          .status(200)
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${result.filename}"`)
          .header('Cache-Control', 'no-store')
          .header('Pragma', 'no-cache')
          .header('X-Content-Type-Options', 'nosniff')
          .header('X-Batch-Id', result.batchId)
          .send(result.csvContent);
      } catch (caught: unknown) {
        if (caught instanceof BulkNotFoundError) {
          return reply.status(409).send({
            error: {
              code: 'TEAM_NOT_FOUND',
              message: 'One or more teams not found',
              missingIndexes: caught.missingIndexes,
            },
          });
        }
        throw caught;
      }
    },
  );
}
