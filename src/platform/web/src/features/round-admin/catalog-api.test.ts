import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRoundCatalog, RoundAdminApiError } from './api.ts';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

const map = { mapId: 'map-a', version: 1, checksum: 'a'.repeat(64), width: 11, height: 9 };
const valid = { engineVersions: ['1.0.0'], maps: [map], faultPolicyVersions: ['P2_BASELINE_V1'] };

afterEach(() => vi.unstubAllGlobals());

describe('getRoundCatalog', () => {
  it('parses a valid catalog from the admin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { data: valid }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRoundCatalog()).resolves.toEqual(valid);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/admin/rounds/catalog');
  });

  it.each([
    ['missing data', {}],
    ['engines not an array', { data: { ...valid, engineVersions: '1.0.0' } }],
    ['engine not a string', { data: { ...valid, engineVersions: [1] } }],
    ['fault policies missing', { data: { engineVersions: [], maps: [] } }],
    ['fault policy not a string', { data: { ...valid, faultPolicyVersions: [null] } }],
    ['maps not an array', { data: { ...valid, maps: {} } }],
    ['map not an object', { data: { ...valid, maps: ['map-a'] } }],
    ['map id not a string', { data: { ...valid, maps: [{ ...map, mapId: 1 }] } }],
    ['checksum not a string', { data: { ...valid, maps: [{ ...map, checksum: 1 }] } }],
    ['version zero', { data: { ...valid, maps: [{ ...map, version: 0 }] } }],
    ['width fractional', { data: { ...valid, maps: [{ ...map, width: 1.5 }] } }],
    ['height string', { data: { ...valid, maps: [{ ...map, height: '9' }] } }],
  ])('rejects a malformed payload: %s', async (_name, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, body)));
    await expect(getRoundCatalog()).rejects.toThrow('Invalid catalog response');
  });

  it('throws RoundAdminApiError on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(404, { error: { code: 'NOT_FOUND' } })));
    await expect(getRoundCatalog()).rejects.toBeInstanceOf(RoundAdminApiError);
  });
});
