export type AccountRole = 'BTC_ADMIN' | 'TEAM_ACCOUNT';

export type SessionPrincipal =
  | Readonly<{ accountId: string; role: 'BTC_ADMIN'; teamId: undefined; mfa?: boolean }>
  | Readonly<{ accountId: string; role: 'TEAM_ACCOUNT'; teamId: string }>;

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export interface AuthRateLimit {
  readonly maxFailures: number;
  readonly windowSeconds: number;
}
