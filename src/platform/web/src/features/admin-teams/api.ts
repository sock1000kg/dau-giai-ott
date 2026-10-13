export interface TeamSummary {
  readonly id: string;
  readonly name: string;
}

export interface TeamCredential {
  readonly username: string;
  readonly password: string;
}

export class TeamApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(status: number, code: string | null) {
    super('Team administration request failed');
    this.name = 'TeamApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/v1/admin/teams${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    throw new TeamApiError(response.status, typeof code === 'string' ? code : null);
  }
  return body;
}

function dataOf(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new Error('Invalid team API response');
  }
  return body.data;
}

function credentialOf(value: unknown): TeamCredential {
  if (typeof value !== 'object' || value === null || !('username' in value) || !('password' in value)
    || typeof value.username !== 'string' || value.username.length === 0
    || typeof value.password !== 'string' || value.password.length === 0) {
    throw new Error('Invalid team credential response');
  }
  return { username: value.username, password: value.password };
}

function teamOf(value: unknown): TeamSummary {
  if (typeof value !== 'object' || value === null || !('id' in value) || !('name' in value)
    || typeof value.id !== 'string' || value.id.length === 0
    || typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 100) {
    throw new Error('Invalid team API response');
  }
  return { id: value.id, name: value.name };
}

export async function listTeams(): Promise<readonly TeamSummary[]> {
  const data = dataOf(await request(''));
  if (!Array.isArray(data)) throw new Error('Invalid team API response');
  return data.map(teamOf);
}

export async function createTeam(name: string): Promise<Readonly<{ team: TeamSummary; credential: TeamCredential }>> {
  const data = dataOf(await request('', { method: 'POST', body: JSON.stringify({ name }) }));
  if (typeof data !== 'object' || data === null || !('credential' in data)) {
    throw new Error('Invalid team credential response');
  }
  const team = teamOf(data);
  return { team, credential: credentialOf(data.credential) };
}

export async function resetTeamCredential(teamId: string): Promise<TeamCredential> {
  const data = dataOf(await request(`/${encodeURIComponent(teamId)}/reset-credential`, { method: 'POST' }));
  if (typeof data !== 'object' || data === null || !('credential' in data)) {
    throw new Error('Invalid team credential response');
  }
  return credentialOf(data.credential);
}
