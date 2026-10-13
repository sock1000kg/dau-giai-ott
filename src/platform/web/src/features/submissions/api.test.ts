import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSubmissions, SubmissionApiError, uploadSubmission } from './api.ts';

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
  public method = '';
  public url = '';
  public body: XMLHttpRequestBodyInit | null = null;
  public open(method: string, url: string) { this.method = method; this.url = url; }
  public setRequestHeader(name: string, value: string) { this.headers.set(name, value); }
  public send(body: XMLHttpRequestBodyInit | null) { this.body = body; }
}

afterEach(() => vi.unstubAllGlobals());

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
});
