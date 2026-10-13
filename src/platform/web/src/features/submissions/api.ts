export type SubmissionStatusCode = 'UPLOADED' | 'INSPECTING' | 'INVALID' | 'PREFLIGHT' | 'VALID' | 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';

export interface TeamSubmission {
  readonly id: string;
  readonly status: SubmissionStatusCode;
  readonly archiveSha256: string;
  readonly createdAt: string;
}

export interface SubmissionPage {
  readonly items: readonly TeamSubmission[];
  readonly pagination: { readonly page: number; readonly pageSize: number; readonly totalItems: number; readonly totalPages: number };
}

interface ErrorBody {
  readonly error?: { readonly code?: unknown };
}

const statuses = new Set<SubmissionStatusCode>(['UPLOADED', 'INSPECTING', 'INVALID', 'PREFLIGHT', 'VALID', 'ACTIVE', 'SUPERSEDED', 'REVOKED']);

export class SubmissionApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(status: number, code: string | null) {
    super('Submission request failed');
    this.name = 'SubmissionApiError';
    this.status = status;
    this.code = code;
  }
}

function submissionOf(value: unknown): TeamSubmission {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid submission response');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.status !== 'string' || !statuses.has(row.status as SubmissionStatusCode)
    || typeof row.archiveSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(row.archiveSha256)
    || typeof row.createdAt !== 'string' || Number.isNaN(Date.parse(row.createdAt))) {
    throw new Error('Invalid submission response');
  }
  return { id: row.id, status: row.status as SubmissionStatusCode, archiveSha256: row.archiveSha256, createdAt: row.createdAt };
}

async function responseError(status: number, bodyText: string): Promise<SubmissionApiError> {
  let body: unknown;
  try { body = JSON.parse(bodyText); } catch { body = undefined; }
  const code = typeof body === 'object' && body !== null ? (body as ErrorBody).error?.code : null;
  return new SubmissionApiError(status, typeof code === 'string' ? code : null);
}

export async function listSubmissions(page = 1, pageSize = 20): Promise<SubmissionPage> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const response = await fetch(`/api/v1/submissions?${query}`, { credentials: 'include' });
  const text = await response.text();
  if (!response.ok) throw await responseError(response.status, text);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error('Invalid submission response'); }
  if (typeof body !== 'object' || body === null || !('data' in body) || !Array.isArray(body.data) || !('pagination' in body)) throw new Error('Invalid submission response');
  const pageInfo = body.pagination;
  if (typeof pageInfo !== 'object' || pageInfo === null) throw new Error('Invalid submission response');
  const { page: responsePage, pageSize: responsePageSize, totalItems, totalPages } = pageInfo as Record<string, unknown>;
  if (![responsePage, responsePageSize, totalItems, totalPages].every((number) => Number.isSafeInteger(number) && Number(number) >= 0)
    || responsePage === 0 || responsePageSize === 0) throw new Error('Invalid submission response');
  return {
    items: body.data.map(submissionOf),
    pagination: { page: responsePage as number, pageSize: responsePageSize as number, totalItems: totalItems as number, totalPages: totalPages as number },
  };
}

export function uploadSubmission(file: File, onProgress: (loaded: number, total: number) => void): Promise<TeamSubmission> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/v1/submissions');
    request.withCredentials = true;
    request.setRequestHeader('content-type', 'application/octet-stream');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });
    request.addEventListener('load', () => {
      if (request.status < 200 || request.status >= 300) {
        void responseError(request.status, request.responseText).then(reject);
        return;
      }
      let body: unknown;
      try { body = JSON.parse(request.responseText); } catch { reject(new Error('Invalid submission response')); return; }
      if (typeof body !== 'object' || body === null || !('data' in body)) { reject(new Error('Invalid submission response')); return; }
      try { resolve(submissionOf(body.data)); } catch (error) { reject(error); }
    });
    request.addEventListener('error', () => reject(new SubmissionApiError(0, null)));
    request.send(file);
  });
}
