import { createHash } from 'node:crypto';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { PublicTournamentPage, formatVnDateTime } from './PublicTournamentPage.tsx';
import type { PublicSnapshot } from './snapshot.ts';

const id = '00000000-0000-4000-8000-000000000001';
function fixture(): PublicSnapshot {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), stage: 'QUALIFICATION', round: { name: 'Week 1', status: 'RUNNING' },
    queue: [{ position: 1, teams: 'A vs B', etaSeconds: 30 }, { position: 2, teams: 'C vs D', etaSeconds: null }],
    results: [{ matchId: id, teams: 'A vs B', score: '1–0', syncVerified: true, replayPublished: true }],
    leaderboard: [{ rank: 1, team: 'A', rating: 1500, eligible: true }, { rank: 4, team: 'D', rating: 1400, eligible: false }],
    rules: { version: 'rules-1', engineVersion: '1.0.0', sections: [{ title: 'Map set', body: 'map-v1' }] },
    schedule: [{ title: 'Cutoff', body: '18:00' }], announcements: [{ title: 'Thông báo BTC', body: 'Đang thi đấu' }],
    faq: [{ title: 'Nộp bot ở đâu?', body: 'Cổng đội thi' }], status: { message: 'Worker recovery', incidentEta: null } };
}
function setup(snapshot = fixture()) {
  const body = JSON.stringify(snapshot), sha256 = createHash('sha256').update(body).digest('hex');
  const pointer = { schemaVersion: 1, file: `snapshot-${sha256}.json`, sha256, updatedAt: snapshot.updatedAt };
  vi.stubGlobal('crypto', { subtle: { digest: async (_a: string, bytes: ArrayBuffer) => Uint8Array.from(createHash('sha256').update(new Uint8Array(bytes)).digest()).buffer } });
  const fetcher = vi.fn(async (url: string, _o?: RequestInit) => new Response(url === '/snapshots/latest.json' ? JSON.stringify(pointer) : body));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function mount(snapshot?: PublicSnapshot, path = '/public') {
  vi.useFakeTimers(); const fetcher = setup(snapshot); window.history.replaceState({}, '', path);
  render(<PublicTournamentPage />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return fetcher;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); });

describe('public tournament page restyle', () => {
  it('renders every labelled section, grid wrappers and the leaderboard anchor', async () => {
    await mount();
    for (const name of ['Bản đồ của vòng', 'Hàng đợi', 'Kết quả', 'Bảng xếp hạng', 'Luật hiện tại', 'Lịch', 'Thông báo', 'FAQ']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(document.getElementById('leaderboard')?.getAttribute('aria-label')).toBe('Bảng xếp hạng');
    expect(document.querySelectorAll('.pub-grid').length).toBe(2);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Giải đấu OTT · Week 1');
  });

  it('shows the queue as an ordered list with positions and plain wait times', async () => {
    await mount();
    const items = within(screen.getByRole('region', { name: 'Hàng đợi' }).querySelector('ol')!).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['#1A vs BDự kiến chờ ~1 phút', '#2C vs DChưa có ước tính']);
  });

  it('lists the leaderboard with eligibility badges and VN time', async () => {
    await mount();
    expect(screen.getByText('Đủ điều kiện')).toBeTruthy();
    expect(screen.getByText('Chưa đủ series')).toBeTruthy();
    expect(formatVnDateTime('2026-10-13T20:30:00.000Z')).toMatch(/03:30:00/);
    expect(formatVnDateTime('bad')).toBe('bad');
  });

  it('links Replay only for verified, published FINALS results', async () => {
    const finals = fixture(); finals.stage = 'FINALS';
    await mount(finals);
    expect(screen.getByRole('link', { name: 'Replay' }).getAttribute('href')).toBe(`/spectator/replays/${id}`);
    cleanup();
    const qualification = fixture();
    await mount(qualification);
    expect(screen.queryByRole('link', { name: 'Replay' })).toBeNull();
  });

  it('raises the stale alert for old snapshots and failed refreshes, not for fresh ones', async () => {
    await mount();
    expect(screen.queryByRole('alert')).toBeNull();
    const fetcher = vi.mocked(fetch);
    fetcher.mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole('alert').textContent).toMatch(/đã cũ/);
    cleanup();
    const old = fixture(); old.updatedAt = '2020-01-01T00:00:00.000Z';
    await mount(old);
    expect(screen.getByRole('alert').textContent).toMatch(/bản cập nhật cuối/);
  });

  it('treats a snapshot older than 90 seconds as stale, but not a 60 second old one', async () => {
    const aged = fixture(); aged.updatedAt = new Date(Date.now() - 300_000).toISOString();
    await mount(aged);
    expect(screen.getByRole('alert').textContent).toMatch(/đã cũ/);
    cleanup();
    const recent = fixture(); recent.updatedAt = new Date(Date.now() - 60_000).toISOString();
    await mount(recent);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows loading and failed placeholders', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<PublicTournamentPage />);
    expect(screen.getByRole('status').textContent).toBe('Đang tải dữ liệu…');
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('status').textContent).toBe('Chưa tải được dữ liệu công khai. Trang sẽ tự thử lại.');
  });
});

describe('public shell links', () => {
  it('marks /public current, and no link for other paths', async () => {
    await mount();
    cleanup();
    window.history.replaceState({}, '', '/public');
    render(<App />);
    expect(screen.getByRole('link', { name: 'Thông tin giải đấu' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Bảng xếp hạng' }).getAttribute('aria-current')).toBeNull();
    cleanup();
    window.history.replaceState({}, '', '/spectator/replays/abc');
    render(<App />);
    expect(document.querySelectorAll('.public-nav-link[aria-current]').length).toBe(0);
  });
});
