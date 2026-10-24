import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { loadPublicSnapshot, type PublicSnapshot } from './snapshot.ts';

const id = '00000000-0000-4000-8000-000000000001';
function fixture(): PublicSnapshot {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), stage: 'QUALIFICATION', round: { name: 'Week 1', status: 'RUNNING' },
    queue: [{ position: 1, teams: 'A vs B', etaSeconds: 30 }],
    results: [{ matchId: id, teams: 'A vs B', score: '1–0', syncVerified: true, replayPublished: true }],
    leaderboard: [{ rank: 1, team: 'A', rating: 1500, eligible: false }],
    rules: { version: 'rules-1', engineVersion: '1.0.0', sections: [{ title: 'Map set', body: 'map-v1, checksum abc; maxTurns 100' }] },
    schedule: [{ title: 'Cutoff', body: '18:00' }], announcements: [{ title: 'Thông báo BTC', body: 'Đang thi đấu' }],
    faq: [{ title: 'Nộp bot ở đâu?', body: 'Cổng đội thi' }], status: { message: 'Worker recovery', incidentEta: '10 phút' } };
}
function responses(snapshot = fixture()) {
  const body = JSON.stringify(snapshot), sha256 = createHash('sha256').update(body).digest('hex');
  return { body, sha256, pointer: { schemaVersion: 1, file: `snapshot-${sha256}.json`, sha256, updatedAt: snapshot.updatedAt } };
}
function setup(snapshot = fixture()) {
  const data = responses(snapshot);
  vi.stubGlobal('crypto', { subtle: { digest: async (_algorithm: string, bytes: ArrayBuffer) => {
    const hash = createHash('sha256').update(new Uint8Array(bytes)).digest();
    return Uint8Array.from(hash).buffer;
  } } });
  const fetcher = vi.fn(async (url: string, _options?: RequestInit) => new Response(url === '/snapshots/latest.json' ? JSON.stringify(data.pointer) : data.body));
  vi.stubGlobal('fetch', fetcher);
  return { data, fetcher };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); });

describe('public-site static snapshots', () => {
  it('offers the bot resource bundle even while tournament data is loading', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    window.history.replaceState({}, '', '/public');

    render(<App />);

    const download = screen.getByRole('link', { name: 'Tải bộ tài nguyên làm bot (.zip)' });
    expect(download.getAttribute('href')).toBe('/downloads/ott-bot-resources-v1.zip');
    expect(download.getAttribute('download')).toBe('ott-bot-resources-v1.zip');
    expect(screen.getByRole('region', { name: 'Tài nguyên làm bot' })).toBeTruthy();
    const archive = readFileSync(resolve(process.cwd(), 'public/downloads/ott-bot-resources-v1.zip'));
    expect(archive.subarray(0, 4).toString('hex')).toBe('504b0304');
  });

  it('renders public data without session, database, worker or control requests', async () => {
    const { fetcher } = setup(); window.history.replaceState({}, '', '/public');
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /Week 1/ });
    for (const name of ['Hàng đợi', 'Kết quả', 'Bảng xếp hạng', 'Luật hiện tại', 'Lịch', 'Thông báo', 'FAQ', 'Bản đồ của vòng']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getByText('Chưa đủ series')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Replay' })).toBeNull();
    await waitFor(() => {
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
        '/snapshots/latest.json',
        expect.stringMatching(/^\/snapshots\/snapshot-[0-9a-f]{64}\.json$/),
        '/api/v1/public/rounds/current/maps',
      ]);
    });
    for (const [, options] of fetcher.mock.calls) {
      expect(options?.method ?? 'GET').toBe('GET');
      expect(options?.credentials).toBe('omit');
    }
  });
  it('links finals replay only after sync and publication', async () => {
    const snapshot = fixture(); snapshot.stage = 'FINALS'; setup(snapshot);
    window.history.replaceState({}, '', '/public'); render(<App />);
    expect((await screen.findByRole('link', { name: 'Replay' })).getAttribute('href')).toBe(`/spectator/replays/${id}`);
  });
  it('hides finals replay before verified import and flags stale snapshots', async () => {
    const snapshot = fixture(); snapshot.stage = 'FINALS';
    snapshot.updatedAt = '2020-01-01T00:00:00.000Z'; snapshot.results[0]!.syncVerified = false;
    setup(snapshot); window.history.replaceState({}, '', '/public'); render(<App />);
    await screen.findByRole('heading', { level: 1, name: /Week 1/ });
    expect(screen.queryByRole('link', { name: 'Replay' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/đã cũ/);
    expect(screen.getByRole('link', { name: 'Bảng xếp hạng' }).getAttribute('href')).toBe('/leaderboard');
  });
  it('retains the last good snapshot when polling fails', async () => {
    vi.useFakeTimers(); const { fetcher } = setup(); window.history.replaceState({}, '', '/public');
    render(<App />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('heading', { level: 1, name: /Week 1/ })).toBeTruthy();
    fetcher.mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole('alert').textContent).toMatch(/bản cập nhật cuối/);
    expect(screen.getByText('Worker recovery')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: /Week 1/ })).toBeTruthy();
  });
  it('rejects checksum mutation, unsafe pointer paths and old snapshots', async () => {
    const { data, fetcher } = setup();
    fetcher.mockImplementation(async (url: string) => new Response(url.endsWith('latest.json') ? JSON.stringify(data.pointer) : `${data.body} `));
    await expect(loadPublicSnapshot(null)).rejects.toThrow(/checksum/);
    data.pointer.file = '../private';
    await expect(loadPublicSnapshot(null)).rejects.toThrow(/pointer/);
    const current = fixture(), old = { ...current, updatedAt: '2020-01-01T00:00:00.000Z' };
    setup(old); await expect(loadPublicSnapshot(current)).rejects.toThrow(/Outdated/);
  });
});
