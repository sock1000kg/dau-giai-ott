export type AuthPrincipal =
  | Readonly<{ role: 'BTC_ADMIN' }>
  | Readonly<{ role: 'TEAM_ACCOUNT'; teamId: string }>;

export type LoginResult =
  | Readonly<{ mfaRequired: false; principal: AuthPrincipal }>
  | Readonly<{ mfaRequired: true }>;

interface ApiErrorBody {
  readonly error?: { readonly code?: unknown };
}

export class AuthApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(status: number, code: string | null) {
    super('Authentication request failed');
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`/api/v1/auth/${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (response.status === 204) return undefined;
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = typeof body === 'object' && body !== null
      ? (body as ApiErrorBody).error?.code
      : null;
    throw new AuthApiError(response.status, typeof code === 'string' ? code : null);
  }
  return body;
}

function principalFrom(body: unknown): AuthPrincipal {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new Error('Invalid authentication response');
  }
  const data = (body as { data: unknown }).data;
  if (typeof data !== 'object' || data === null || !('role' in data)) {
    throw new Error('Invalid authentication response');
  }
  const role = (data as { role: unknown }).role;
  if (role === 'BTC_ADMIN') return { role: 'BTC_ADMIN' };
  if (role === 'TEAM_ACCOUNT' && 'teamId' in data && typeof (data as { teamId: unknown }).teamId === 'string') {
    return { role: 'TEAM_ACCOUNT', teamId: (data as { teamId: string }).teamId };
  }
  throw new Error('Invalid authentication response');
}

export async function getCurrentSession(): Promise<AuthPrincipal | null> {
  try {
    return principalFrom(await request('session'));
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 401) return null;
    throw error;
  }
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const body = await request('login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (typeof body === 'object' && body !== null && 'data' in body) {
    const data = (body as { data: unknown }).data;
    if (typeof data === 'object' && data !== null && 'mfaRequired' in data && (data as { mfaRequired: unknown }).mfaRequired === true) {
      return { mfaRequired: true };
    }
  }
  return { mfaRequired: false, principal: principalFrom(body) };
}

export async function loginMfa(payload: { code?: string; recoveryCode?: string }): Promise<AuthPrincipal> {
  const body = await request('login/mfa', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return principalFrom(body);
}

export async function logout(): Promise<void> {
  await request('logout', { method: 'POST' });
}
