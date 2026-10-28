import { afterEach, describe, expect, it, vi } from 'vitest';
import { listReferenceBots, ReferenceBotApiError, setReferenceBotEnabled, uploadReferenceBot } from './api.ts';

const bot = {
  id: 'bot-1', displayName: 'BTC first legal', archiveSha256: `sha256:${'a'.repeat(64)}`,
  manifestDigest: `sha256:${'b'.repeat(64)}`, configDigest: `sha256:${'c'.repeat(64)}`,
  policyVersion: 'P2_BASELINE_V1', enabled: false, createdAt: '2026-10-24T10:00:00.000Z', enabledAt: null, disabledAt: null,
};

afterEach(() => vi.unstubAllGlobals());

describe('reference bot API client', () => {
  it('lists and validates only the public catalog DTO fields', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [bot] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    expect(await listReferenceBots()).toEqual([bot]);
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/reference-bots', expect.objectContaining({ method: 'GET', credentials: 'include' }));
  });

  it('sends the OCI archive as binary with metadata and stable idempotency header', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { ...bot, replayed: false } }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const file = new File(['tar'], 'bot.oci.tar', { type: 'application/x-tar' });

    const result = await uploadReferenceBot({ file, displayName: bot.displayName, reason: 'BTC test upload', idempotencyKey: 'upload-key-1' });

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get('content-type')).toBe('application/vnd.oci.image.archive.v1+tar');
    expect(new Headers(init.headers).get('x-reference-bot-name')).toBe(bot.displayName);
    expect(new Headers(init.headers).get('idempotency-key')).toBe('upload-key-1');
    expect(init.body).toBe(file);
    expect(result).toEqual({ data: bot, replayed: false });
  });

  it('posts reasoned activation and disable requests as JSON', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { ...bot, replayed: true } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await setReferenceBotEnabled(bot.id, true, 'Approved', 'activation-key');
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/admin/reference-bots/bot-1/activate', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ reason: 'Approved' }),
      headers: expect.any(Headers),
    }));
    expect(new Headers((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('idempotency-key')).toBe('activation-key');
  });

  it('returns structured API errors and rejects malformed catalog data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'REFERENCE_BOT_ARCHIVE_EXISTS' } }), { status: 409 })));
    await expect(listReferenceBots()).rejects.toMatchObject({ name: 'ReferenceBotApiError', status: 409, code: 'REFERENCE_BOT_ARCHIVE_EXISTS' } satisfies Partial<ReferenceBotApiError>);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ ...bot, archiveSha256: 'bad' }] }), { status: 200 })));
    await expect(listReferenceBots()).rejects.toThrow(/Invalid reference bot response/);
  });
});
