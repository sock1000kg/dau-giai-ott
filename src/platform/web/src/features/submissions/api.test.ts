import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listSubmissions,
  reserveSubmission,
  sha256File,
  SubmissionApiError,
  uploadSubmission,
} from './api.ts';

const submission = { id: 'sub-1', status: 'PREFLIGHT', archiveSha256: `sha256:${'b'.repeat(64)}`, createdAt: '2026-10-13T00:00:00.000Z' };
const submissionPage = { data: [submission], pagination: { page: 2, pageSize: 20, totalItems: 21, totalPages: 2 } };

function httpResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

class FakeXhr extends EventTarget {
  public readonly upload = new EventTarget();
  public withCredentials = false;
  public status = 201;
  public responseText = JSON.stringify({ data: submission });
  public readonly headers = new Map<string, string>();
  public readonly responseHeaders = new Map<string, string>();
  public method = '';
  public url = '';
  public body: XMLHttpRequestBodyInit | null = null;
  public open(method: string, url: string) { this.method = method; this.url = url; }
  public setRequestHeader(name: string, value: string) { this.headers.set(name, value); }
  public getResponseHeader(name: string): string | null { return this.responseHeaders.get(name) ?? null; }
  public send(body: XMLHttpRequestBodyInit | null) { this.body = body; }
  public abort() { this.dispatchEvent(new Event('abort')); }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('submission API', () => {
  it('lists only validated session-scoped submissions and includes cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpResponse(200, submissionPage));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listSubmissions(2, 20)).resolves.toEqual({ items: [submission], pagination: submissionPage.pagination });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/submissions?page=2&pageSize=20', { credentials: 'include' });
  });

  it('rejects malformed listing payloads rather than rendering untrusted values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(httpResponse(200, { ...submissionPage, data: [{ ...submission, status: '<script>' }] })));
    await expect(listSubmissions()).rejects.toThrow('Invalid submission response');
  });

  it('uploads the raw archive with cookie auth and reports byte progress without metadata', async () => {
    const xhr = new FakeXhr();
    vi.stubGlobal('XMLHttpRequest', class { constructor() { return xhr; } });
    const file = new File(['OCI bytes'], 'bot.tar');
    const progress = vi.fn();
    const result = uploadSubmission(file, progress);
    const event = new Event('progress');
    Object.defineProperties(event, { lengthComputable: { value: true }, loaded: { value: 5 }, total: { value: 10 } });
    xhr.upload.dispatchEvent(event);
    xhr.dispatchEvent(new Event('load'));

    await expect(result).resolves.toEqual(submission);
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/v1/submissions');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers.get('content-type')).toBe('application/octet-stream');
    expect(xhr.body).toBe(file);
    expect(progress).toHaveBeenCalledWith(5, 10);
  });

  it('preserves only stable API error status and code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(httpResponse(403, { error: { code: 'FORBIDDEN', message: 'internal secret text' } })));
    await expect(listSubmissions()).rejects.toMatchObject<Partial<SubmissionApiError>>({ status: 403, code: 'FORBIDDEN' });
  });

  it('sha256File calculates correct sha256 prefix and hex string', async () => {
    const content = new TextEncoder().encode('hello world');
    const file = new File([content], 'test.tar');
    const hash = await sha256File(file);
    // sha256 of "hello world" is b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    expect(hash).toBe('sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('reserveSubmission sends POST to /api/v1/submission-reservations and returns parsed reservation', async () => {
    const reservationData = {
      id: 'res-1',
      archiveSha256: `sha256:${'c'.repeat(64)}`,
      roundId: 'round-1',
      reservedAt: '2026-10-17T00:00:00.000Z',
      graceEndsAt: '2026-10-18T00:00:00.000Z',
      status: 'RESERVED',
    };
    const fetchMock = vi.fn().mockResolvedValue(httpResponse(201, { data: reservationData }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await reserveSubmission(`sha256:${'c'.repeat(64)}`);
    expect(res).toEqual(reservationData);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/submission-reservations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archiveSha256: `sha256:${'c'.repeat(64)}` }),
    });
  });

  it('uploadSubmission attaches X-Reservation-Id and retries on 429 with Retry-After backoff', async () => {
    vi.useFakeTimers();

    const xhrs: FakeXhr[] = [];
    vi.stubGlobal('XMLHttpRequest', class {
      constructor() {
        const xhr = new FakeXhr();
        xhrs.push(xhr);
        return xhr;
      }
    });

    const file = new File(['OCI bytes'], 'bot.tar');
    const onWaitingRetry = vi.fn();
    const uploadPromise = uploadSubmission(file, 'res-123', null, undefined, onWaitingRetry);

    expect(xhrs.length).toBe(1);
    const firstXhr = xhrs[0]!;
    expect(firstXhr.headers.get('x-reservation-id')).toBe('res-123');

    // Simulate 429 with Retry-After: 3
    firstXhr.status = 429;
    firstXhr.responseHeaders.set('Retry-After', '3');
    firstXhr.dispatchEvent(new Event('load'));

    expect(onWaitingRetry).toHaveBeenCalledWith(3, 1);
    expect(xhrs.length).toBe(1);

    // Fast-forward 2 seconds: not yet retried
    await vi.advanceTimersByTimeAsync(2000);
    expect(xhrs.length).toBe(1);

    // Fast-forward 1 more second: retry sent!
    await vi.advanceTimersByTimeAsync(1000);
    expect(xhrs.length).toBe(2);

    const secondXhr = xhrs[1]!;
    expect(secondXhr.headers.get('x-reservation-id')).toBe('res-123');

    // Second request succeeds
    secondXhr.status = 201;
    secondXhr.dispatchEvent(new Event('load'));

    await expect(uploadPromise).resolves.toEqual(submission);
  });
});
