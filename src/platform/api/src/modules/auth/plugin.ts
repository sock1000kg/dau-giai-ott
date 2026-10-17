import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';

import type { Database } from '../../db/client.ts';
import { appendAuditEvent } from './audit.ts';
import { requireAuthenticated, requireRole } from './authorize.ts';
import type { LoginRateLimiter, SessionStore, RedisAuthCommands } from './sessions.ts';
import type { PasswordHasher, SessionPrincipal } from './types.ts';
import type { SecurityConfig } from '../../config/security.ts';
import { devSecurityConfig } from '../../config/security.ts';
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  buildOtpAuthUri,
  verifyTotp,
} from './totp.ts';
import {
  consumeRecoveryCode,
  getAdminMfa,
  recordTotpStepIfNewer,
  saveRecoveryCodes,
  upsertAdminMfa,
} from './mfa-repository.ts';

declare module 'fastify' {
  interface FastifyRequest {
    clientIp: string;
    principal: SessionPrincipal | null;
  }
}

export interface AuthPluginOptions {
  readonly database: Database;
  readonly sessionStore: SessionStore;
  readonly passwordHasher: PasswordHasher;
  readonly rateLimiter: LoginRateLimiter;
  readonly secureCookies: boolean;
  readonly security?: SecurityConfig;
  readonly redis?: RedisAuthCommands;
}

interface AccountRecord {
  readonly id: string;
  readonly username: string;
  readonly password_hash: string;
  readonly role: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
  readonly team_id: string | null;
}

interface LoginRequest {
  readonly username?: unknown;
  readonly password?: unknown;
}

interface LoginMfaRequest {
  readonly code?: unknown;
  readonly recoveryCode?: unknown;
}

interface MfaChallengeRecord {
  readonly accountId: string;
  readonly username: string;
  attempts: number;
}

const sessionCookieName = 'ott_session';
const mfaChallengeCookieName = 'ott_mfa';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send({ error: { code, message } });
}

function invalidCredentials(reply: FastifyReply) {
  return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Invalid username or password');
}

function loginValues(body: LoginRequest | undefined): { readonly username: string; readonly password: string } | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
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
  const security = options.security ?? devSecurityConfig();
  const dummyPasswordHash = options.passwordHasher.hash('not-a-user-password');

  application.decorateRequest('principal', null);

  application.addHook('onRequest', async (request) => {
    const token = request.cookies[sessionCookieName];
    if (token !== undefined) {
      request.principal = await options.sessionStore.read(token);
    }
  });

  // Login endpoint
  application.post<{ Body: LoginRequest }>('/api/v1/auth/login', async (request, reply) => {
    const clientIp = request.clientIp ?? request.ip;
    const values = loginValues(request.body);
    const username = values?.username ?? '';
    const password = values?.password ?? '';

    if (await options.rateLimiter.isLimited(username, clientIp)) {
      return sendError(reply, 429, 'LOGIN_RATE_LIMITED', 'Too many login attempts. Try again later.');
    }

    const lookup = values === null
      ? undefined
      : await options.database.query<AccountRecord>(
        "SELECT id, username, password_hash, role, team_id FROM accounts WHERE username = $1 AND status = 'ACTIVE'",
        [username],
      );
    const account = lookup?.rows[0];
    const passwordHash = account?.password_hash ?? await dummyPasswordHash;
    const passwordMatches = await options.passwordHasher.verify(passwordHash, password);
    const principal = account === undefined || !passwordMatches ? null : asPrincipal(account);

    if (principal === null) {
      await options.rateLimiter.recordFailure(username, clientIp);
      return invalidCredentials(reply);
    }

    // BTC with totpRequired=true: issue single-use MFA challenge cookie and return { mfaRequired: true }
    if (principal.role === 'BTC_ADMIN' && security.totpRequired) {
      if (!options.redis) {
        throw new Error('Redis is required for MFA challenges');
      }
      const mfaToken = randomBytes(32).toString('base64url');
      const challengeKey = `auth:mfa:challenge:${digest(mfaToken)}`;
      const challengeData: MfaChallengeRecord = {
        accountId: principal.accountId,
        username,
        attempts: 0,
      };
      await options.redis.set(challengeKey, JSON.stringify(challengeData), { EX: 300 });

      reply.setCookie(mfaChallengeCookieName, mfaToken, {
        httpOnly: true,
        path: '/',
        sameSite: 'strict',
        secure: options.secureCookies,
      });

      return { data: { mfaRequired: true } };
    }

    // Team account or BTC with totpRequired=false
    const token = await options.sessionStore.create(principal);
    try {
      await appendAuditEvent(options.database, principal.accountId, 'AUTH_LOGIN', 'ACCOUNT', principal.accountId);
    } catch (error) {
      await options.sessionStore.revoke(token);
      throw error;
    }
    await options.rateLimiter.clear(username, clientIp);
    reply.setCookie(sessionCookieName, token, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: options.secureCookies,
    });
    return { data: { role: principal.role, teamId: principal.teamId } };
  });

  // Login MFA endpoint
  application.post<{ Body: LoginMfaRequest }>('/api/v1/auth/login/mfa', async (request, reply) => {
    const clientIp = request.clientIp ?? request.ip;
    const mfaToken = request.cookies[mfaChallengeCookieName];

    if (!mfaToken || typeof mfaToken !== 'string' || mfaToken.length < 16 || !options.redis) {
      return invalidCredentials(reply);
    }

    const challengeKey = `auth:mfa:challenge:${digest(mfaToken)}`;
    const rawChallenge = await options.redis.get(challengeKey);
    if (rawChallenge === null) {
      return invalidCredentials(reply);
    }

    let challenge: MfaChallengeRecord;
    try {
      challenge = JSON.parse(rawChallenge);
    } catch {
      return invalidCredentials(reply);
    }

    challenge.attempts += 1;
    if (challenge.attempts >= 5) {
      await options.redis.del(challengeKey);
    } else {
      await options.redis.set(challengeKey, JSON.stringify(challenge), { EX: 300 });
    }

    if (await options.rateLimiter.isLimited(challenge.username, clientIp)) {
      return sendError(reply, 429, 'LOGIN_RATE_LIMITED', 'Too many login attempts. Try again later.');
    }

    const body = request.body;
    const hasCode = typeof body?.code === 'string' && body.code.trim().length > 0;
    const hasRecovery = typeof body?.recoveryCode === 'string' && body.recoveryCode.trim().length > 0;

    // Strict body: exactly one of code or recoveryCode
    if ((hasCode && hasRecovery) || (!hasCode && !hasRecovery)) {
      await options.rateLimiter.recordFailure(challenge.username, clientIp);
      return invalidCredentials(reply);
    }

    let auditMethod: 'TOTP' | 'RECOVERY_CODE';

    if (hasCode) {
      const code = (body.code as string).trim();
      const mfaRecord = await getAdminMfa(options.database, challenge.accountId);
      if (mfaRecord === null || !security.totpEncryptionKey) {
        await options.rateLimiter.recordFailure(challenge.username, clientIp);
        return invalidCredentials(reply);
      }

      let secret: string;
      try {
        secret = decryptTotpSecret(
          {
            ciphertext: mfaRecord.secret_ciphertext,
            iv: mfaRecord.secret_iv,
            tag: mfaRecord.secret_tag,
          },
          security.totpEncryptionKey,
        );
      } catch {
        await options.rateLimiter.recordFailure(challenge.username, clientIp);
        return invalidCredentials(reply);
      }

      const verifyResult = verifyTotp(code, secret);
      if (!verifyResult.valid || verifyResult.step === undefined) {
        await options.rateLimiter.recordFailure(challenge.username, clientIp);
        return invalidCredentials(reply);
      }

      // Replay check
      const updated = await recordTotpStepIfNewer(options.database, challenge.accountId, verifyResult.step);
      if (!updated) {
        await options.rateLimiter.recordFailure(challenge.username, clientIp);
        return invalidCredentials(reply);
      }

      auditMethod = 'TOTP';
    } else {
      const recoveryCode = (body.recoveryCode as string).trim();
      const codeHash = hashRecoveryCode(recoveryCode);
      const consumed = await consumeRecoveryCode(options.database, challenge.accountId, codeHash);
      if (!consumed) {
        await options.rateLimiter.recordFailure(challenge.username, clientIp);
        return invalidCredentials(reply);
      }

      auditMethod = 'RECOVERY_CODE';
    }

    // Success: delete challenge and clear mfa cookie
    await options.redis.del(challengeKey);
    reply.clearCookie(mfaChallengeCookieName, {
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: options.secureCookies,
    });

    const principal: SessionPrincipal = {
      accountId: challenge.accountId,
      role: 'BTC_ADMIN',
      teamId: undefined,
      mfa: true,
    };
    const sessionToken = await options.sessionStore.create(principal);

    try {
      await appendAuditEvent(
        options.database,
        challenge.accountId,
        'AUTH_LOGIN_MFA',
        'ACCOUNT',
        challenge.accountId,
        auditMethod,
      );
    } catch (error) {
      await options.sessionStore.revoke(sessionToken);
      throw error;
    }

    await options.rateLimiter.clear(challenge.username, clientIp);
    reply.setCookie(sessionCookieName, sessionToken, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: options.secureCookies,
    });

    return { data: { role: principal.role } };
  });

  // Self-service MFA enrollment endpoints
  application.post('/api/v1/auth/mfa/enroll', async (request, reply) => {
    const principal = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    if (security.totpRequired && principal.mfa !== true) {
      return sendError(reply, 403, 'FORBIDDEN', 'MFA session required');
    }
    if (!options.redis) {
      throw new Error('Redis is required for MFA enrollment');
    }

    const secret = generateTotpSecret();
    await options.redis.set(`auth:mfa:pending:${principal.accountId}`, secret, { EX: 600 });
    const uri = buildOtpAuthUri({ accountName: 'admin', secret });

    await appendAuditEvent(options.database, principal.accountId, 'MFA_ENROLLED', 'ACCOUNT', principal.accountId);
    reply.header('Cache-Control', 'no-store');
    return reply.send({ data: { secret, uri } });
  });

  application.post<{ Body: { code?: unknown } }>('/api/v1/auth/mfa/confirm', async (request, reply) => {
    const principal = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    if (security.totpRequired && principal.mfa !== true) {
      return sendError(reply, 403, 'FORBIDDEN', 'MFA session required');
    }
    if (typeof request.body?.code !== 'string') {
      return sendError(reply, 400, 'INVALID_BODY', 'Confirmation code is required');
    }
    if (!options.redis) {
      throw new Error('Redis is required for MFA enrollment');
    }

    const pendingSecret = await options.redis.get(`auth:mfa:pending:${principal.accountId}`);
    if (pendingSecret === null) {
      return sendError(reply, 400, 'MFA_NOT_PENDING', 'No MFA enrollment pending');
    }

    const verifyResult = verifyTotp(request.body.code, pendingSecret);
    if (!verifyResult.valid || verifyResult.step === undefined) {
      return sendError(reply, 400, 'INVALID_CODE', 'Invalid confirmation code');
    }

    if (!security.totpEncryptionKey) {
      throw new Error('TOTP encryption key is not configured');
    }

    const encrypted = encryptTotpSecret(pendingSecret, security.totpEncryptionKey);
    await upsertAdminMfa(options.database, principal.accountId, encrypted, verifyResult.step);
    await options.redis.del(`auth:mfa:pending:${principal.accountId}`);

    const { formatted, hashes } = generateRecoveryCodes(10);
    await saveRecoveryCodes(options.database, principal.accountId, hashes);

    await appendAuditEvent(options.database, principal.accountId, 'MFA_CONFIRMED', 'ACCOUNT', principal.accountId);
    reply.header('Cache-Control', 'no-store');
    return reply.send({ data: { confirmed: true, recoveryCodes: formatted } });
  });

  application.post('/api/v1/auth/mfa/recovery-codes', async (request, reply) => {
    const principal = requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN');
    if (security.totpRequired && principal.mfa !== true) {
      return sendError(reply, 403, 'FORBIDDEN', 'MFA session required');
    }

    const mfaRecord = await getAdminMfa(options.database, principal.accountId);
    if (mfaRecord === null) {
      return sendError(reply, 400, 'MFA_NOT_ENROLLED', 'MFA is not enrolled');
    }

    const { formatted, hashes } = generateRecoveryCodes(10);
    await saveRecoveryCodes(options.database, principal.accountId, hashes);

    await appendAuditEvent(options.database, principal.accountId, 'MFA_RECOVERY_CODES_REGENERATED', 'ACCOUNT', principal.accountId);
    reply.header('Cache-Control', 'no-store');
    return reply.send({ data: { recoveryCodes: formatted } });
  });

  application.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[sessionCookieName];
    if (token !== undefined) {
      await options.sessionStore.revoke(token);
    }
    if (request.principal !== null) {
      await appendAuditEvent(options.database, request.principal.accountId, 'AUTH_LOGOUT', 'ACCOUNT', request.principal.accountId);
    }
    reply.clearCookie(sessionCookieName, { httpOnly: true, path: '/', sameSite: 'lax', secure: options.secureCookies });
    return reply.status(204).send();
  });

  application.get('/api/v1/auth/session', async (request, reply) => {
    const principal = requireAuthenticated(request.principal);
    return reply.send({ data: { role: principal.role, teamId: principal.teamId } });
  });
}
