import { createHash, randomBytes } from 'node:crypto';

import type { AuthRateLimit, SessionPrincipal } from './types.ts';

export interface RedisAuthCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { readonly EX: number }): Promise<unknown>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  sAdd(key: string, member: string): Promise<number>;
  sMembers(key: string): Promise<string[]>;
}

export interface SessionStore {
  create(principal: SessionPrincipal): Promise<string>;
  read(token: string): Promise<SessionPrincipal | null>;
  revoke(token: string): Promise<void>;
  revokeAccount(accountId: string): Promise<void>;
}

export interface LoginRateLimiter {
  isLimited(username: string, clientAddress: string): Promise<boolean>;
  recordFailure(username: string, clientAddress: string): Promise<void>;
  clear(username: string, clientAddress: string): Promise<void>;
}

export interface RedisAuthStoreOptions {
  readonly sessionTtlSeconds?: number;
  readonly rateLimit?: AuthRateLimit;
}

const defaultRateLimit: AuthRateLimit = { maxFailures: 5, windowSeconds: 60 };

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function isSessionPrincipal(value: unknown): value is SessionPrincipal {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.accountId !== 'string') {
    return false;
  }
  if (candidate.role === 'BTC_ADMIN') {
    return candidate.teamId === undefined;
  }
  return candidate.role === 'TEAM_ACCOUNT' && typeof candidate.teamId === 'string';
}

export class RedisAuthStore implements SessionStore, LoginRateLimiter {
  private readonly sessionTtlSeconds: number;
  private readonly rateLimit: AuthRateLimit;
  private readonly redis: RedisAuthCommands;

  public constructor(redis: RedisAuthCommands, options: RedisAuthStoreOptions = {}) {
    this.redis = redis;
    this.sessionTtlSeconds = options.sessionTtlSeconds ?? 60 * 60 * 12;
    this.rateLimit = options.rateLimit ?? defaultRateLimit;
  }

  public async create(principal: SessionPrincipal): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const sessionKey = this.sessionKey(token);
    const accountKey = this.accountKey(principal.accountId);
    await this.redis.set(sessionKey, JSON.stringify(principal), { EX: this.sessionTtlSeconds });
    await this.redis.sAdd(accountKey, sessionKey);
    await this.redis.expire(accountKey, this.sessionTtlSeconds);
    return token;
  }

  public async read(token: string): Promise<SessionPrincipal | null> {
    if (token.length < 32) {
      return null;
    }
    const encoded = await this.redis.get(this.sessionKey(token));
    if (encoded === null) {
      return null;
    }
    try {
      const principal: unknown = JSON.parse(encoded);
      return isSessionPrincipal(principal) ? principal : null;
    } catch {
      return null;
    }
  }

  public async revoke(token: string): Promise<void> {
    await this.redis.del(this.sessionKey(token));
  }

  public async revokeAccount(accountId: string): Promise<void> {
    const accountKey = this.accountKey(accountId);
    const sessions = await this.redis.sMembers(accountKey);
    if (sessions.length > 0) {
      await Promise.all(sessions.map((sessionKey) => this.redis.del(sessionKey)));
    }
    await this.redis.del(accountKey);
  }

  public async isLimited(username: string, clientAddress: string): Promise<boolean> {
    const count = await this.redis.get(this.loginKey(username, clientAddress));
    return count !== null && Number(count) >= this.rateLimit.maxFailures;
  }

  public async recordFailure(username: string, clientAddress: string): Promise<void> {
    const key = this.loginKey(username, clientAddress);
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, this.rateLimit.windowSeconds);
    }
  }

  public async clear(username: string, clientAddress: string): Promise<void> {
    await this.redis.del(this.loginKey(username, clientAddress));
  }

  private sessionKey(token: string): string {
    return `auth:session:${digest(token)}`;
  }

  private loginKey(username: string, clientAddress: string): string {
    return `auth:login:${digest(`${username}\u0000${clientAddress}`)}`;
  }

  private accountKey(accountId: string): string {
    return `auth:account:${digest(accountId)}`;
  }
}

export function createRedisAuthStore(redis: RedisAuthCommands, options?: RedisAuthStoreOptions): RedisAuthStore {
  return new RedisAuthStore(redis, options);
}
