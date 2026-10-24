import { createHash } from 'node:crypto';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicTournamentPage } from './PublicTournamentPage.tsx';
import type { PublicSnapshot } from './snapshot.ts';

const snap: PublicSnapshot = { schemaVersion: 1, updatedAt: new Date().toISOString(), stage: 'QUALIFICATION', round: { name: 'Week 1', status: 'RUNNING' },
  queue: [{ position: 1, teams: 'A vs B', etaSeconds: 30 }, { position: 2, teams: 'C vs D', etaSeconds: null }],
  results: [{ matchId: '00000000-0000-4000-8000-000000000001', teams: 'R vs S', score: '1–0', syncVerified: true, replayPublished: true }],
  leaderboard: [], rules: { version: 'rules-1', engineVersion: '1.0.0', sections: [{ title: 'Map set', body: 'map-v1' }] },
  schedule: [{ title: 'Cutoff', body: '18:00' }], announcements: [], faq: [], status: { message: 'ok', incidentEta: '10 phút' } };

async function mount() {
  vi.useFakeTimers();
  vi.stubGlobal('crypto', { subtle: { digest: async (_a: string, bytes: ArrayBuffer) => Uint8Array.from(createHash('sha256').update(new Uint8Array(bytes)).digest()).buffer } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = JSON.stringify(snap), sha256 = createHash('sha256').update(body).digest('hex');
    return new Response(url === '/snapshots/latest.json'
      ? JSON.stringify({ schemaVersion: 1, file: `snapshot-${sha256}.json`, sha256, updatedAt: snap.updatedAt }) : body);
  }));
  window.history.replaceState({}, '', '/public');
  render(<PublicTournamentPage />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); });

describe('public panel layout (heights are not assertable in jsdom; checked in a browser)', () => {
  it('queue and results lists use the same scroll region treatment', async () => {
    await mount();
    const queue = within(screen.getByRole('region', { name: 'Hàng đợi' })).getByRole('region', { name: 'Danh sách hàng đợi' });
    const results = within(screen.getByRole('region', { name: 'Kết quả' })).getByRole('region', { name: 'Danh sách kết quả' });
    expect(queue.className).toBe(results.className);
    expect(queue.className).toContain('pub-scroll--fill');
    expect(queue.getAttribute('style')).toBeNull();
    expect(results.getAttribute('style')).toBeNull();
  });

  it('the panel grid has the stretch class and both panels share the panel classes', async () => {
    await mount();
    const grid = document.querySelector('.pub-grid--panels')!;
    expect(grid).toBeTruthy();
    const queueSection = screen.getByRole('region', { name: 'Hàng đợi' });
    const resultsSection = screen.getByRole('region', { name: 'Kết quả' });
    expect(queueSection.className).toBe(resultsSection.className);
    expect(queueSection.querySelector('.ui-card')!.className).toBe(resultsSection.querySelector('.ui-card')!.className);
    expect(grid.contains(queueSection) && grid.contains(resultsSection)).toBe(true);
  });

  it('uses plain Vietnamese wait wording instead of ETA', async () => {
    await mount();
    expect(screen.getByText('Dự kiến chờ ~1 phút')).toBeTruthy();
    expect(screen.getByText('Chưa có ước tính')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/ETA/);
  });
});
