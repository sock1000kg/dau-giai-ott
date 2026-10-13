export type AuthPrincipal =
  | Readonly<{ role: 'BTC_ADMIN' }>
  | Readonly<{ role: 'TEAM_ACCOUNT'; teamId: string }>;

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
  const data = body.data;
  if (typeof data !== 'object' || data === null || !('role' in data)) {
    throw new Error('Invalid authentication response');
  }
  if (data.role === 'BTC_ADMIN') return { role: 'BTC_ADMIN' };
  if (data.role === 'TEAM_ACCOUNT' && 'teamId' in data && typeof data.teamId === 'string') {
    return { role: 'TEAM_ACCOUNT', teamId: data.teamId };
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

export async function login(username: string, password: string): Promise<AuthPrincipal> {
  return principalFrom(await request('login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  }));
}

export async function logout(): Promise<void> {
  await request('logout', { method: 'POST' });
}
