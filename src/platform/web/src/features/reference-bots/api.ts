export interface ReferenceBot {
  readonly id: string;
  readonly displayName: string;
  readonly archiveSha256: string;
  readonly manifestDigest: string;
  readonly configDigest: string;
  readonly policyVersion: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly enabledAt: string | null;
  readonly disabledAt: string | null;
}

export interface ReferenceBotMutation {
  readonly data: ReferenceBot;
  readonly replayed: boolean;
}

export class ReferenceBotApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(status: number, code: string | null) {
    super('Reference bot request failed');
    this.name = 'ReferenceBotApiError';
    this.status = status;
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid reference bot response');
  }
  return value as Record<string, unknown>;
}

function parseBot(value: unknown): ReferenceBot {
  const row = record(value);
  if (typeof row.id !== 'string' || typeof row.displayName !== 'string'
    || typeof row.archiveSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(row.archiveSha256)
    || typeof row.manifestDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(row.manifestDigest)
    || typeof row.configDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(row.configDigest)
    || typeof row.policyVersion !== 'string' || typeof row.enabled !== 'boolean'
    || typeof row.createdAt !== 'string' || Number.isNaN(Date.parse(row.createdAt))
    || !(row.enabledAt === null || typeof row.enabledAt === 'string' && !Number.isNaN(Date.parse(row.enabledAt)))
    || !(row.disabledAt === null || typeof row.disabledAt === 'string' && !Number.isNaN(Date.parse(row.disabledAt)))) {
    throw new Error('Invalid reference bot response');
  }
  return {
    id: row.id,
    displayName: row.displayName,
    archiveSha256: row.archiveSha256,
    manifestDigest: row.manifestDigest,
    configDigest: row.configDigest,
    policyVersion: row.policyVersion,
    enabled: row.enabled,
    createdAt: row.createdAt,
    enabledAt: row.enabledAt as string | null,
    disabledAt: row.disabledAt as string | null,
  };
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof Blob)) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const root = typeof body === 'object' && body !== null && 'error' in body ? record(body.error) : null;
    throw new ReferenceBotApiError(response.status, typeof root?.code === 'string' ? root.code : null);
  }
  return body;
}

export async function listReferenceBots(): Promise<readonly ReferenceBot[]> {
  const body = record(await request('/api/v1/admin/reference-bots', { method: 'GET' }));
  if (!Array.isArray(body.data)) throw new Error('Invalid reference bot response');
  return body.data.map(parseBot);
}

export async function uploadReferenceBot(input: {
  readonly file: File;
  readonly displayName: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}): Promise<ReferenceBotMutation> {
  const body = record(await request('/api/v1/admin/reference-bots', {
    method: 'POST',
    headers: {
      'content-type': 'application/vnd.oci.image.archive.v1+tar',
      'x-reference-bot-name': input.displayName,
      'x-change-reason': input.reason,
      'idempotency-key': input.idempotencyKey,
    },
    body: input.file,
  }));
  const data = record(body.data);
  return { data: parseBot(data), replayed: data.replayed === true };
}

export async function setReferenceBotEnabled(
  id: string,
  enabled: boolean,
  reason: string,
  idempotencyKey: string,
): Promise<ReferenceBotMutation> {
  const action = enabled ? 'activate' : 'disable';
  const body = record(await request(`/api/v1/admin/reference-bots/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify({ reason }),
  }));
  const data = record(body.data);
  return { data: parseBot(data), replayed: data.replayed === true };
}
