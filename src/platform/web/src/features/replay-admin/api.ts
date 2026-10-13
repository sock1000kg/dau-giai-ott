export type ReplayPublicationState = 'PRIVATE' | 'STAGED' | 'PUBLISHED';

export interface ReplayCatalogEntry {
  readonly matchId: string;
  readonly state: ReplayPublicationState;
  readonly eventLogSha256: string;
  readonly seriesId: string;
  readonly stage: string;
  readonly finalizedAt: string;
  readonly teamX: Readonly<{ id: string; name: string }>;
  readonly teamO: Readonly<{ id: string; name: string }>;
}

export interface ReplayCatalogPage {
  readonly items: readonly ReplayCatalogEntry[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export class ReplayAdminApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(status: number, code: string | null) {
    super('Replay administration request failed');
    this.name = 'ReplayAdminApiError';
    this.status = status;
    this.code = code;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid replay catalog response');
  return value as Record<string, unknown>;
}

function entry(value: unknown): ReplayCatalogEntry {
  const row = object(value);
  const teamX = object(row.teamX);
  const teamO = object(row.teamO);
  if (typeof row.matchId !== 'string' || !['PRIVATE', 'STAGED', 'PUBLISHED'].includes(String(row.state))
    || typeof row.eventLogSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(row.eventLogSha256)
    || typeof row.seriesId !== 'string' || typeof row.stage !== 'string' || typeof row.finalizedAt !== 'string'
    || Number.isNaN(Date.parse(row.finalizedAt)) || typeof teamX.id !== 'string' || typeof teamX.name !== 'string'
    || typeof teamO.id !== 'string' || typeof teamO.name !== 'string') throw new Error('Invalid replay catalog response');
  return {
    matchId: row.matchId,
    state: row.state as ReplayPublicationState,
    eventLogSha256: row.eventLogSha256,
    seriesId: row.seriesId,
    stage: row.stage,
    finalizedAt: row.finalizedAt,
    teamX: { id: teamX.id, name: teamX.name },
    teamO: { id: teamO.id, name: teamO.name },
  };
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const root = typeof body === 'object' && body !== null && 'error' in body ? object(body.error) : null;
    throw new ReplayAdminApiError(response.status, typeof root?.code === 'string' ? root.code : null);
  }
  return body;
}

export async function listReplayCatalog(page = 1, pageSize = 25): Promise<ReplayCatalogPage> {
  const body = object(await request(`/api/v1/admin/replays/catalog?page=${page}&pageSize=${pageSize}`));
  const data = object(body.data);
  const pagination = object(data.pagination);
  if (!Array.isArray(data.items) || ![pagination.page, pagination.pageSize, pagination.total, pagination.totalPages]
    .every((item) => Number.isSafeInteger(item) && Number(item) >= 0)) throw new Error('Invalid replay catalog response');
  return {
    items: data.items.map(entry),
    page: Number(pagination.page),
    pageSize: Number(pagination.pageSize),
    total: Number(pagination.total),
    totalPages: Number(pagination.totalPages),
  };
}

export async function transitionReplay(
  matchId: string,
  action: 'stage' | 'publish',
  reason: string,
  idempotencyKey: string,
): Promise<ReplayPublicationState> {
  const body = object(await request(`/api/v1/admin/replays/${encodeURIComponent(matchId)}/${action}`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ reason }),
  }));
  const data = object(body.data);
  if (data.matchId !== matchId || !['PRIVATE', 'STAGED', 'PUBLISHED'].includes(String(data.state))) throw new Error('Invalid replay transition response');
  return data.state as ReplayPublicationState;
}
