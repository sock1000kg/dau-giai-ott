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
import type { ObjectStorage } from './storage/s3.ts';
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
  readonly storage?: ObjectStorage;
}

export function createAuthApp(options: CreateAuthAppOptions): FastifyInstance {
  const storeOptions = options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit };
  const authStore = createRedisAuthStore(options.redis, storeOptions);
  const passwordHasher = options.passwordHasher ?? createPasswordHasher(options.passwordHashPolicy);

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
    passwordHasher,
    rateLimiter: authStore,
    secureCookies: options.secureCookies ?? true,
  });
  registerTeamRoutes(application, { database: options.database, passwordHasher, sessionStore: authStore });
  registerLeaderboardRoutes(application, { database: options.database });
  registerResultRoutes(application, { database: options.database });
  if (options.storage !== undefined) {
    registerSubmissionRoutes(application, { database: options.database, storage: options.storage });
    registerReplayRoutes(application, { database: options.database, storage: options.storage });
  }
  return application;
}
