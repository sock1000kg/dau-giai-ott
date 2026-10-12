import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Database } from './db/client.ts';
import { AuthorizationError } from './modules/auth/authorize.ts';
import { registerAuthPlugin } from './modules/auth/plugin.ts';
import { createPasswordHasher, type PasswordHashPolicy } from './modules/auth/passwords.ts';
import { createRedisAuthStore, type RedisAuthCommands } from './modules/auth/sessions.ts';
import type { AuthRateLimit, PasswordHasher } from './modules/auth/types.ts';

export interface CreateAuthAppOptions {
  readonly database: Database;
  readonly redis: RedisAuthCommands;
  readonly passwordHasher?: PasswordHasher;
  readonly passwordHashPolicy?: PasswordHashPolicy;
  readonly secureCookies?: boolean;
  readonly rateLimit?: AuthRateLimit;
}

export function createAuthApp(options: CreateAuthAppOptions): FastifyInstance {
  const storeOptions = options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit };
  const authStore = createRedisAuthStore(options.redis, storeOptions);

  const application = Fastify({ logger: false });
  application.register(cookie);
  application.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthorizationError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
  registerAuthPlugin(application, {
    database: options.database,
    sessionStore: authStore,
    passwordHasher: options.passwordHasher ?? createPasswordHasher(options.passwordHashPolicy),
    rateLimiter: authStore,
    secureCookies: options.secureCookies ?? true,
  });
  return application;
}
