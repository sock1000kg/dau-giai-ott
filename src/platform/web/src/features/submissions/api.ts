export type SubmissionStatusCode = 'UPLOADED' | 'INSPECTING' | 'INVALID' | 'PREFLIGHT' | 'VALID' | 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';

export interface TeamSubmission {
  readonly id: string;
  readonly status: SubmissionStatusCode;
  readonly archiveSha256: string;
  readonly createdAt: string;
  readonly preflightPosition?: number | null;
}

export interface SubmissionReservation {
  readonly id: string;
  readonly archiveSha256: string;
  readonly roundId: string;
  readonly reservedAt: string;
  readonly graceEndsAt: string;
  readonly status: 'RESERVED' | 'COMPLETED';
}

export interface SubmissionPage {
  readonly items: readonly TeamSubmission[];
  readonly pagination: { readonly page: number; readonly pageSize: number; readonly totalItems: number; readonly totalPages: number };
  readonly preflightQueueLength?: number | undefined;
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
  const preflightPosition =
    typeof row.preflightPosition === 'number' && Number.isSafeInteger(row.preflightPosition)
      ? row.preflightPosition
      : row.preflightPosition === null
        ? null
        : undefined;
  return {
    id: row.id,
    status: row.status as SubmissionStatusCode,
    archiveSha256: row.archiveSha256,
    createdAt: row.createdAt,
    ...(preflightPosition !== undefined ? { preflightPosition } : {}),
  };
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

  const preflightQueueLength =
    'preflightQueueLength' in body && typeof (body as Record<string, unknown>).preflightQueueLength === 'number'
      ? ((body as Record<string, unknown>).preflightQueueLength as number)
      : undefined;

  return {
    items: body.data.map(submissionOf),
    pagination: { page: responsePage as number, pageSize: responsePageSize as number, totalItems: totalItems as number, totalPages: totalPages as number },
    preflightQueueLength,
  };
}

export async function sha256File(file: File): Promise<string> {
  let buffer: ArrayBuffer;
  if (typeof file.arrayBuffer === 'function') {
    buffer = await file.arrayBuffer();
  } else {
    buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  return `sha256:${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function reserveSubmission(archiveSha256: string): Promise<SubmissionReservation> {
  const response = await fetch('/api/v1/submission-reservations', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ archiveSha256 }),
  });
  const text = await response.text();
  if (!response.ok) throw await responseError(response.status, text);
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Error('Invalid reservation response'); }
  if (typeof body !== 'object' || body === null || !('data' in body) || typeof (body as Record<string, unknown>).data !== 'object' || (body as Record<string, unknown>).data === null) {
    throw new Error('Invalid reservation response');
  }
  const data = (body as Record<string, unknown>).data as Record<string, unknown>;
  return {
    id: String(data.id),
    archiveSha256: String(data.archiveSha256),
    roundId: String(data.roundId),
    reservedAt: String(data.reservedAt),
    graceEndsAt: String(data.graceEndsAt),
    status: data.status as 'RESERVED' | 'COMPLETED',
  };
}

export function uploadSubmission(
  file: File,
  reservationIdOrOnProgress?: string | null | ((loaded: number, total: number) => void),
  onProgress?: ((loaded: number, total: number) => void) | null,
  signal?: AbortSignal,
  onWaitingRetry?: (retryAfterSeconds: number, attempt: number) => void
): Promise<TeamSubmission> {
  let reservationId: string | null = null;
  let progressCallback: ((loaded: number, total: number) => void) | undefined;

  if (typeof reservationIdOrOnProgress === 'function') {
    progressCallback = reservationIdOrOnProgress;
  } else if (typeof reservationIdOrOnProgress === 'string') {
    reservationId = reservationIdOrOnProgress;
    progressCallback = onProgress ?? undefined;
  } else {
    progressCallback = onProgress ?? undefined;
  }

  return new Promise((resolve, reject) => {
    let attempt = 0;
    const maxAttempts = 5;

    function sendAttempt() {
      attempt++;
      if (signal?.aborted) {
        reject(new SubmissionApiError(0, 'ABORTED'));
        return;
      }

      const request = new XMLHttpRequest();
      request.open('POST', '/api/v1/submissions');
      request.withCredentials = true;
      request.setRequestHeader('content-type', 'application/octet-stream');
      if (reservationId) {
        request.setRequestHeader('x-reservation-id', reservationId);
      }

      const abortHandler = () => {
        request.abort();
        reject(new SubmissionApiError(0, 'ABORTED'));
      };
      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && progressCallback) {
          progressCallback(event.loaded, event.total);
        }
      });

      request.addEventListener('load', () => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }

        if (request.status === 429 && attempt < maxAttempts) {
          const retryHeader = request.getResponseHeader('Retry-After');
          const parsed = retryHeader ? parseInt(retryHeader, 10) : 5;
          const retrySeconds = !isNaN(parsed) && parsed >= 1 ? parsed : 5;
          if (onWaitingRetry) {
            onWaitingRetry(retrySeconds, attempt);
          }
          const timeoutId = setTimeout(() => {
            if (signal?.aborted) {
              reject(new SubmissionApiError(0, 'ABORTED'));
            } else {
              sendAttempt();
            }
          }, retrySeconds * 1000);

          if (signal) {
            signal.addEventListener('abort', () => clearTimeout(timeoutId), { once: true });
          }
          return;
        }

        if (request.status < 200 || request.status >= 300) {
          void responseError(request.status, request.responseText).then(reject);
          return;
        }
        let body: unknown;
        try { body = JSON.parse(request.responseText); } catch { reject(new Error('Invalid submission response')); return; }
        if (typeof body !== 'object' || body === null || !('data' in body)) { reject(new Error('Invalid submission response')); return; }
        try { resolve(submissionOf(body.data)); } catch (error) { reject(error); }
      });

      request.addEventListener('error', () => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        reject(new SubmissionApiError(0, null));
      });

      request.addEventListener('abort', () => {
        if (signal) signal.removeEventListener('abort', abortHandler);
        reject(new SubmissionApiError(0, 'ABORTED'));
      });

      request.send(file);
    }

    sendAttempt();
  });
}
