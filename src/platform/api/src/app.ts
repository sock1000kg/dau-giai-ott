import { createHash } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Database } from './db/client.ts';
import { AuthorizationError } from './modules/auth/authorize.ts';
import { registerAuthPlugin } from './modules/auth/plugin.ts';
import { registerTeamRoutes } from './modules/teams/routes.ts';
import { registerSubmissionRoutes } from './modules/submissions/routes.ts';
import { registerLeaderboardRoutes } from './modules/ratings/routes.ts';
import { registerResultRoutes } from './modules/results/routes.ts';
import { registerReplayRoutes } from './modules/replays/routes.ts';
import { registerRoundRoutes } from './modules/rounds/routes.ts';
import { registerOperationsRoutes } from './modules/operations/routes.ts';
import type { MatchJobEnqueuer } from './modules/scheduling/service.ts';
import type { ObjectStorage } from './storage/s3.ts';
import { createPasswordHasher, type PasswordHashPolicy } from './modules/auth/passwords.ts';
import { createRedisAuthStore, type RedisAuthCommands } from './modules/auth/sessions.ts';
import type { AuthRateLimit, PasswordHasher } from './modules/auth/types.ts';
import {
  assertSecurityConfig,
  devSecurityConfig,
  effectiveClientIp,
  isIpInAllowlist,
  type SecurityConfig,
} from './config/security.ts';

import type { UploadLimiterOptions } from './modules/submissions/upload-limiter.ts';

export interface CreateAuthAppOptions {
  readonly database: Database;
  readonly redis: RedisAuthCommands;
  readonly passwordHasher?: PasswordHasher;
  readonly passwordHashPolicy?: PasswordHashPolicy;
  readonly secureCookies?: boolean;
  readonly rateLimit?: AuthRateLimit;
  readonly storage?: ObjectStorage;
  readonly security?: SecurityConfig;
  readonly uploadLimiter?: UploadLimiterOptions;
  readonly matchEnqueuer?: MatchJobEnqueuer;
  readonly now?: () => Date;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function createAuthApp(options: CreateAuthAppOptions): FastifyInstance {
  const security = options.security ?? devSecurityConfig();
  // AC-23: Assert security config before building routes or initializing app
  assertSecurityConfig(security);

  const storeOptions = options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit };
  const authStore = createRedisAuthStore(options.redis, storeOptions);
  const passwordHasher = options.passwordHasher ?? createPasswordHasher(options.passwordHashPolicy);

  // Fastify global bodyLimit 1 MiB (1048576 bytes)
  const application = Fastify({ logger: false, bodyLimit: 1048576 });
  application.register(cookie);

  application.decorateRequest('clientIp', '');

  application.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthorizationError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  // Effective client IP and admin network allowlist onRequest hook
  application.addHook('onRequest', async (request, reply) => {
    const socketAddress = request.raw.socket.remoteAddress ?? '';
    request.clientIp = effectiveClientIp(socketAddress, request.headers['x-forwarded-for'], security.trustedProxies);

    // Guard for admin routes and MFA management routes
    const isNetworkRestricted =
      request.url.startsWith('/api/v1/admin/') ||
      request.url.startsWith('/api/v1/auth/mfa/') ||
      request.url.startsWith('/admin/');

    if (isNetworkRestricted) {
      if (security.adminAllowlist.length > 0 && !isIpInAllowlist(request.clientIp, security.adminAllowlist)) {
        return reply.status(403).send({
          error: { code: 'ADMIN_NETWORK_FORBIDDEN', message: 'Access denied from this network address' },
        });
      }
    }
  });

  // Register auth plugin (decorates request.principal in onRequest)
  registerAuthPlugin(application, {
    database: options.database,
    sessionStore: authStore,
    passwordHasher,
    rateLimiter: authStore,
    secureCookies: options.secureCookies ?? true,
    security,
    redis: options.redis,
  });

  // Write rate limit preHandler hook (after onRequest where session/principal and clientIp are loaded)
  application.addHook('preHandler', async (request, reply) => {
    const isWriteMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    if (!isWriteMethod) return;

    // Login routes have their own dedicated rate limiter
    if (request.url.startsWith('/api/v1/auth/login')) return;

    // IP-level write rate limit
    const ipKey = `rate:write:ip:${digest(request.clientIp)}`;
    const ipCount = await options.redis.incr(ipKey);
    if (ipCount === 1) {
      await options.redis.expire(ipKey, 60);
    }
    if (ipCount > security.writeRateLimit.perIpPerMinute) {
      reply.header('Retry-After', '60');
      return reply.status(429).send({
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
      });
    }

    // Account-level write rate limit if authenticated
    if (request.principal) {
      const accountKey = `rate:write:account:${digest(request.principal.accountId)}`;
      const acctCount = await options.redis.incr(accountKey);
      if (acctCount === 1) {
        await options.redis.expire(accountKey, 60);
      }
      if (acctCount > security.writeRateLimit.perAccountPerMinute) {
        reply.header('Retry-After', '60');
        return reply.status(429).send({
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
        });
      }
    }
  });

  // Security headers onSend hook
  application.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.hasHeader('x-content-type-options')) {
      reply.header('X-Content-Type-Options', 'nosniff');
    }
    if (!reply.hasHeader('referrer-policy')) {
      reply.header('Referrer-Policy', 'no-referrer');
    }
    if (!reply.hasHeader('content-security-policy')) {
      reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    }
    if (!reply.hasHeader('x-frame-options')) {
      reply.header('X-Frame-Options', 'DENY');
    }
    if (!reply.hasHeader('cross-origin-resource-policy')) {
      reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    }
    if ((security.mode === 'hosted' || security.mode === 'production') && !reply.hasHeader('strict-transport-security')) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  registerTeamRoutes(application, { database: options.database, passwordHasher, sessionStore: authStore });
  registerLeaderboardRoutes(application, { database: options.database });
  registerResultRoutes(application, { database: options.database });
  registerRoundRoutes(application, { database: options.database });
  registerOperationsRoutes(application, { database: options.database, sessionStore: authStore, enqueuer: options.matchEnqueuer });
  if (options.storage !== undefined) {
    registerSubmissionRoutes(application, {
      database: options.database,
      storage: options.storage,
      uploadLimiter: options.uploadLimiter,
      now: options.now,
    });
    registerReplayRoutes(application, { database: options.database, storage: options.storage });
  }

  return application;
}
