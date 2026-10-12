import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.ts';
import { appendAuditEvent } from '../auth/audit.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import type { SessionStore } from '../auth/sessions.ts';
import type { PasswordHasher, SessionPrincipal } from '../auth/types.ts';

export interface TeamRoutesOptions { readonly database: Database; readonly passwordHasher: PasswordHasher; readonly sessionStore: SessionStore; }
interface Team { readonly id: string; readonly name: string; }
interface TeamAccount extends Team { readonly account_id: string; }
const error = (code: string, message: string) => ({ error: { code, message } });
const admin = (request: FastifyRequest): SessionPrincipal => requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
const nameOf = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100 ? value.trim() : null;
const credential = (name: string) => ({ username: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'team'}-${randomBytes(4).toString('hex')}`, password: randomBytes(24).toString('base64url') });
const duplicate = (value: unknown) => typeof value === 'object' && value !== null && 'code' in value && value.code === '23505';

export function registerTeamRoutes(app: FastifyInstance, options: TeamRoutesOptions): void {
  app.post<{ Body: { name?: unknown } }>('/api/v1/admin/teams', async (request, reply) => {
    const actor = admin(request); const name = nameOf(request.body?.name); if (name === null) return reply.status(400).send(error('INVALID_INPUT', 'Invalid team input'));
    const created = await options.database.transaction(async (db) => { const id = randomUUID(); const secret = credential(name); try { await db.query('INSERT INTO teams (id, name) VALUES ($1, $2)', [id, name]); await db.query("INSERT INTO accounts (id, username, password_hash, role, team_id) VALUES ($1, $2, $3, 'TEAM_ACCOUNT', $4)", [randomUUID(), secret.username, await options.passwordHasher.hash(secret.password), id]); return { id, name, credential: secret }; } catch (caught: unknown) { if (duplicate(caught)) return null; throw caught; } });
    if (created === null) return reply.status(409).send(error('TEAM_NAME_TAKEN', 'Team name already exists'));
    await appendAuditEvent(options.database, actor.accountId, 'TEAM_CREATED', 'TEAM', created.id); return reply.status(201).send({ data: created });
  });
  app.get('/api/v1/admin/teams', async (request) => { admin(request); const result = await options.database.query<Team>('SELECT id, name FROM teams ORDER BY name'); return { data: result.rows }; });
  app.patch<{ Params: { id: string }; Body: { name?: unknown } }>('/api/v1/admin/teams/:id', async (request, reply) => { const actor = admin(request); const name = nameOf(request.body?.name); if (name === null) return reply.status(400).send(error('INVALID_INPUT', 'Invalid team input')); try { const result = await options.database.query<Team>('UPDATE teams SET name = $1 WHERE id = $2 RETURNING id, name', [name, request.params.id]); const updated = result.rows[0]; if (updated === undefined) return reply.status(404).send(error('TEAM_NOT_FOUND', 'Team not found')); await appendAuditEvent(options.database, actor.accountId, 'TEAM_UPDATED', 'TEAM', updated.id); return { data: updated }; } catch (caught: unknown) { if (duplicate(caught)) return reply.status(409).send(error('TEAM_NAME_TAKEN', 'Team name already exists')); throw caught; } });
  app.post<{ Params: { id: string } }>('/api/v1/admin/teams/:id/reset-credential', async (request, reply) => { const actor = admin(request); const result = await options.database.query<TeamAccount>("SELECT teams.id, teams.name, accounts.id AS account_id FROM teams JOIN accounts ON accounts.team_id = teams.id WHERE teams.id = $1 AND accounts.role = 'TEAM_ACCOUNT'", [request.params.id]); const team = result.rows[0]; if (team === undefined) return reply.status(404).send(error('TEAM_NOT_FOUND', 'Team not found')); const secret = credential(team.name); await options.database.transaction(async (db) => { await db.query('UPDATE accounts SET username = $1, password_hash = $2, updated_at = now() WHERE id = $3', [secret.username, await options.passwordHasher.hash(secret.password), team.account_id]); await appendAuditEvent(db, actor.accountId, 'TEAM_CREDENTIAL_RESET', 'TEAM', team.id); }); await options.sessionStore.revokeAccount(team.account_id); return { data: { id: team.id, credential: secret } }; });
}
