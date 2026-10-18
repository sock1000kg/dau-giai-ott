import { createHash } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicTournamentPage } from './PublicTournamentPage.tsx';
import type { PublicSnapshot } from './snapshot.ts';

const mid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(queue: number, results: number, teams: number, updatedAt = new Date().toISOString()): PublicSnapshot {
  return { schemaVersion: 1, updatedAt, stage: 'QUALIFICATION', round: { name: 'Week 1', status: 'RUNNING' },
    queue: Array.from({ length: queue }, (_, i) => ({ position: i + 1, teams: `Q${i + 1} vs Z${i + 1}`, etaSeconds: 30 })),
    results: Array.from({ length: results }, (_, i) => ({ matchId: mid(i + 1), teams: `R${i + 1} vs S${i + 1}`, score: '1–0', syncVerified: true, replayPublished: true })),
    leaderboard: Array.from({ length: teams }, (_, i) => ({ rank: i + 1, team: `T${i + 1}`, rating: 1500 - i, eligible: true })),
    rules: { version: 'rules-1', engineVersion: '1.0.0', sections: [{ title: 'Map set', body: 'map-v1' }] },
    schedule: [{ title: 'Cutoff', body: '18:00' }], announcements: [], faq: [], status: { message: 'ok', incidentEta: null } };
}
let current: PublicSnapshot;
function stub(snapshot: PublicSnapshot) {
  current = snapshot;
  vi.stubGlobal('crypto', { subtle: { digest: async (_a: string, bytes: ArrayBuffer) => Uint8Array.from(createHash('sha256').update(new Uint8Array(bytes)).digest()).buffer } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = JSON.stringify(current), sha256 = createHash('sha256').update(body).digest('hex');
    return new Response(url === '/snapshots/latest.json'
      ? JSON.stringify({ schemaVersion: 1, file: `snapshot-${sha256}.json`, sha256, updatedAt: current.updatedAt }) : body);
  }));
}
async function mount(snapshot: PublicSnapshot) {
  vi.useFakeTimers(); stub(snapshot); window.history.replaceState({}, '', '/public');
  render(<PublicTournamentPage />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
const region = (name: string) => screen.getByRole('region', { name });
const items = (name: string) => within(region(name)).queryAllByRole('listitem').map((li) => li.textContent ?? '');
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); });

describe('public lists with limits', () => {
  it('queue: 12 rows show 10 plus Xem thêm (2 còn lại); 3 rows show all without a button', async () => {
    await mount(fixture(12, 0, 0));
    expect(items('Hàng đợi').length).toBe(10);
    expect(items('Hàng đợi')[0]).toContain('#1');
    expect(within(region('Hàng đợi')).getByText('12 trận đang chờ')).toBeTruthy();
    fireEvent.click(within(region('Hàng đợi')).getByRole('button', { name: 'Xem thêm (2 còn lại)' }));
    expect(items('Hàng đợi').length).toBe(12);
    cleanup();
    await mount(fixture(3, 0, 0));
    expect(items('Hàng đợi').length).toBe(3);
    expect(within(region('Hàng đợi')).queryByRole('button')).toBeNull();
  });

  it('results: newest first, 20 of 250 visible with (230 còn lại), without mutating order of the source', async () => {
    const snap = fixture(0, 250, 0);
    await mount(snap);
    const shown = items('Kết quả');
    expect(shown.length).toBe(20);
    expect(shown[0]).toContain('R250 vs S250');
    expect(shown[19]).toContain('R231 vs S231');
    expect(within(region('Kết quả')).getByText('250 kết quả')).toBeTruthy();
    expect(within(region('Kết quả')).getByRole('button', { name: 'Xem thêm (230 còn lại)' })).toBeTruthy();
    expect(region('Kết quả').querySelector('.pub-scroll')?.getAttribute('aria-label')).toBe('Danh sách kết quả');
    expect(snap.results[0]!.teams).toBe('R1 vs S1');
  });

  it('leaderboard: top 10 of 250 with the count line and the full link; all rows when ≤ 10', async () => {
    await mount(fixture(0, 0, 250));
    const rows = within(region('Bảng xếp hạng')).getAllByRole('row').slice(1);
    expect(rows.length).toBe(10);
    expect(rows[9]!.textContent).toContain('T10');
    expect(screen.getByText('Hiển thị 10 / 250 đội')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Xem bảng xếp hạng đầy đủ →' }).getAttribute('href')).toBe('/leaderboard');
    expect(document.getElementById('leaderboard')).toBeTruthy();
    cleanup();
    await mount(fixture(0, 0, 3));
    expect(within(region('Bảng xếp hạng')).getAllByRole('row').length).toBe(4);
    expect(screen.queryByText(/Hiển thị/)).toBeNull();
  });

  it('shows empty texts for an empty queue and no results', async () => {
    await mount(fixture(0, 0, 0));
    expect(screen.getByText('Hàng đợi trống.')).toBeTruthy();
    expect(screen.getByText('Chưa có kết quả.')).toBeTruthy();
    expect(within(region('Hàng đợi')).queryByRole('list')).toBeNull();
  });

  it('keeps the expanded state across a polled snapshot and puts the new newest result first', async () => {
    await mount(fixture(0, 50, 0));
    fireEvent.click(within(region('Kết quả')).getByRole('button', { name: 'Xem thêm (30 còn lại)' }));
    expect(items('Kết quả').length).toBe(40);
    stub(fixture(0, 55, 0, new Date(Date.now() + 1000).toISOString()));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const shown = items('Kết quả');
    expect(shown.length).toBe(40);
    expect(shown[0]).toContain('R55 vs S55');
    expect(within(region('Kết quả')).getByRole('button', { name: 'Xem thêm (15 còn lại)' })).toBeTruthy();
  });
});
