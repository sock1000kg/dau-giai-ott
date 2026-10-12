import type { FastifyInstance, FastifyReply } from 'fastify';

import type { Database } from '../../db/client.ts';
import { appendAuditEvent } from './audit.ts';
import { requireAuthenticated } from './authorize.ts';
import type { LoginRateLimiter, SessionStore } from './sessions.ts';
import type { PasswordHasher, SessionPrincipal } from './types.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal: SessionPrincipal | null;
  }
}
export interface AuthPluginOptions {
  readonly database: Database;
  readonly sessionStore: SessionStore;
  readonly passwordHasher: PasswordHasher;
  readonly rateLimiter: LoginRateLimiter;
  readonly secureCookies: boolean;
}

interface AccountRecord {
  readonly id: string;
  readonly password_hash: string;
  readonly role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
  readonly team_id: string | null;
}

interface LoginRequest {
  readonly username?: unknown;
  readonly password?: unknown;
}

const cookieName = 'ott_session';

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send({ error: { code, message } });
}

function invalidCredentials(reply: FastifyReply) {
  return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');
}

function loginValues(body: LoginRequest): { readonly username: string; readonly password: string } | null {
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return null;
  }
  if (body.username.length === 0 || body.username.length > 128 || body.password.length > 1024) {
    return null;
  }
  return { username: body.username, password: body.password };
}

function asPrincipal(account: AccountRecord): SessionPrincipal | null {
  if (account.role === 'BTC_ADMIN' && account.team_id === null) {
    return { accountId: account.id, role: 'BTC_ADMIN', teamId: undefined };
  }
  if (account.role === 'TEAM_ACCOUNT' && account.team_id !== null) {
    return { accountId: account.id, role: 'TEAM_ACCOUNT', teamId: account.team_id };
  }
  return null;
}

export function registerAuthPlugin(application: FastifyInstance, options: AuthPluginOptions): void {
  const dummyPasswordHash = options.passwordHasher.hash('not-a-user-password');
  application.decorateRequest('principal', null);

  application.addHook('onRequest', async (request) => {
    const token = request.cookies[cookieName];
    if (token !== undefined) {
      request.principal = await options.sessionStore.read(token);
    }
  });

  application.post<{ Body: LoginRequest }>('/api/v1/auth/login', async (request, reply) => {
    const values = loginValues(request.body);
    const username = values?.username ?? '';
    const password = values?.password ?? '';
    if (await options.rateLimiter.isLimited(username, request.ip)) {
      return sendError(reply, 429, 'LOGIN_RATE_LIMITED', 'Too many login attempts. Try again later.');
    }

    const lookup = values === null
      ? undefined
      : await options.database.query<AccountRecord>(
        "SELECT id, password_hash, role, team_id FROM accounts WHERE username = $1 AND status = 'ACTIVE'",
        [username],
      );
    const account = lookup?.rows[0];
    const passwordHash = account?.password_hash ?? await dummyPasswordHash;
    const passwordMatches = await options.passwordHasher.verify(passwordHash, password);
    const principal = account === undefined || !passwordMatches ? null : asPrincipal(account);
    if (principal === null) {
      await options.rateLimiter.recordFailure(username, request.ip);
      return invalidCredentials(reply);
    }

    const token = await options.sessionStore.create(principal);
    try {
      await appendAuditEvent(options.database, principal.accountId, 'AUTH_LOGIN', 'ACCOUNT', principal.accountId);
    } catch (error) {
      await options.sessionStore.revoke(token);
      throw error;
    }
    await options.rateLimiter.clear(username, request.ip);
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: options.secureCookies,
    });
    return { data: { role: principal.role, teamId: principal.teamId } };
  });

  application.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[cookieName];
    if (token !== undefined) {
      await options.sessionStore.revoke(token);
    }
    if (request.principal !== null) {
      await appendAuditEvent(options.database, request.principal.accountId, 'AUTH_LOGOUT', 'ACCOUNT', request.principal.accountId);
    }
    reply.clearCookie(cookieName, { httpOnly: true, path: '/', sameSite: 'lax', secure: options.secureCookies });
    return reply.status(204).send();
  });

  application.get('/api/v1/auth/session', async (request, reply) => {
    const principal = requireAuthenticated(request.principal);
    return reply.send({ data: { role: principal.role, teamId: principal.teamId } });
  });
}
