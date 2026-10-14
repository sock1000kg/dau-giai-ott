export interface TeamSummary {
  readonly id: string;
  readonly name: string;
  readonly representativeEmail?: string | null;
}

export interface TeamCredential {
  readonly username: string;
  readonly password: string;
}

export interface ApiRowError {
  readonly row: number;
  readonly column?: string;
  readonly code: string;
  readonly relatedRow?: number;
}

export class TeamApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  public readonly errors?: readonly ApiRowError[] | undefined;
  public readonly missingIndexes?: readonly number[] | undefined;

  public constructor(
    status: number,
    code: string | null,
    errors?: readonly ApiRowError[],
    missingIndexes?: readonly number[],
  ) {
    super('Team administration request failed');
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'TeamApiError';
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.missingIndexes = missingIndexes;
  }
}

export function isTeamApiError(error: unknown): error is TeamApiError {
  return (
    error instanceof TeamApiError ||
    (typeof error === 'object' && error !== null && 'name' in error && error.name === 'TeamApiError')
  );
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
    const errors = typeof error === 'object' && error !== null && 'errors' in error && Array.isArray(error.errors) ? error.errors : undefined;
    const missingIndexes = typeof error === 'object' && error !== null && 'missingIndexes' in error && Array.isArray(error.missingIndexes) ? error.missingIndexes : undefined;
    throw new TeamApiError(response.status, typeof code === 'string' ? code : null, errors, missingIndexes);
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
  const representativeEmail = 'representativeEmail' in value && typeof value.representativeEmail === 'string'
    ? value.representativeEmail
    : null;
  return { id: value.id, name: value.name, representativeEmail };
}

function extractFilename(header: string | null): string {
  if (!header) return 'team-credentials.csv';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match && match[1] ? match[1].trim() : 'team-credentials.csv';
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

export async function bulkImportTeams(csv: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch('/api/v1/admin/teams/bulk-import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    const errors = typeof error === 'object' && error !== null && 'errors' in error && Array.isArray(error.errors)
      ? error.errors
      : undefined;
    throw new TeamApiError(response.status, typeof code === 'string' ? code : null, errors);
  }
  const filename = extractFilename(response.headers.get('content-disposition'));
  const blob = await response.blob();
  return { blob, filename };
}

export async function bulkResetTeamCredentials(teamIds: readonly string[]): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch('/api/v1/admin/teams/bulk-reset', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ teamIds }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    const missingIndexes = typeof error === 'object' && error !== null && 'missingIndexes' in error && Array.isArray(error.missingIndexes)
      ? error.missingIndexes
      : undefined;
    throw new TeamApiError(response.status, typeof code === 'string' ? code : null, undefined, missingIndexes);
  }
  const filename = extractFilename(response.headers.get('content-disposition'));
  const blob = await response.blob();
  return { blob, filename };
}
