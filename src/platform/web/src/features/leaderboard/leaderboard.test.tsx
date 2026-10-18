// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { LeaderboardPage } from './LeaderboardPage.tsx';
import { listLeaderboard } from './api.ts';

const pageOne = {
  data: {
    items: [
      { rank: 1, tieBreakStatus: 'CLEAR', team: { id: 'a', name: 'Alpha' }, rating: 1200, headToHeadPoints: 3, series: { wins: 2, draws: 0, losses: 0 }, winRate: 1, technicalFaultCount: 0, forfeitCount: 0, updatedAt: '2026-10-13T00:00:00.000Z', scheduleSeed: 'private', objectKey: 'private/object' },
      { rank: 4, tieBreakStatus: 'BTC_REQUIRED', team: { id: 'b', name: 'Beta' }, rating: 1000, headToHeadPoints: 0, series: { wins: 0, draws: 1, losses: 1 }, winRate: 0.25, technicalFaultCount: 1, forfeitCount: 0, updatedAt: '2026-10-12T00:00:00.000Z' },
      { rank: 4, tieBreakStatus: 'BTC_REQUIRED', team: { id: 'c', name: 'Gamma' }, rating: 1000, headToHeadPoints: 0, series: { wins: 0, draws: 1, losses: 1 }, winRate: 0.25, technicalFaultCount: 0, forfeitCount: 1, updatedAt: '2026-10-11T00:00:00.000Z' },
    ],
    pagination: { page: 1, pageSize: 25, total: 4, totalPages: 2 },
  },
};

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('public leaderboard', () => {
  it('requests paged server-ranked data and maps official rank/tie-break values', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, pageOne));
    vi.stubGlobal('fetch', fetch);
    const result = await listLeaderboard({ stage: 'QUALIFICATION', page: 1, pageSize: 25 });
    expect(fetch).toHaveBeenCalledWith('/api/v1/leaderboard?stage=QUALIFICATION&page=1&pageSize=25', { credentials: 'include' });
    expect(result.items.map((item) => [item.rank, item.tieBreakStatus])).toEqual([[1, 'CLEAR'], [4, 'BTC_REQUIRED'], [4, 'BTC_REQUIRED']]);
    expect(result.items[0]).not.toHaveProperty('scheduleSeed');
    expect(result.items[0]).not.toHaveProperty('objectKey');
  });

  it('is available to an anonymous visitor and preserves official ranks and ties', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, pageOne));
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState({}, '', '/leaderboard');
    render(<App />);

    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /bảng xếp hạng/i })).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Gamma')).toBeTruthy();
    expect(screen.getAllByText('4')).toHaveLength(2);
    expect(screen.getAllByText(/BTC cần quyết định/i)).toHaveLength(2);
    expect(document.body.textContent).not.toContain('private/object');
    expect(document.body.textContent).not.toContain('private');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toContain('/api/v1/leaderboard');
  });

  it('supports pagination and stage selection without computing client ranks', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => response(200, url.includes('page=2')
      ? { data: { items: [{ ...pageOne.data.items[1], rank: 4 }], pagination: { page: 2, pageSize: 25, total: 4, totalPages: 2 } } }
      : pageOne));
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState({}, '', '/leaderboard');
    render(<LeaderboardPage />);
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByLabelText('Vòng đấu / stage'), { target: { value: 'PLAYOFF' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Lọc bảng xếp hạng' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('stage=PLAYOFF'), expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.anything()));
    expect(screen.getAllByText('4').length).toBeGreaterThan(0);
  });

  it('announces loading, empty and retryable error states accessibly', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; })));
    window.history.replaceState({}, '', '/leaderboard');
    render(<LeaderboardPage />);
    expect(screen.getByRole('status').textContent).toMatch(/đang tải/i);
    resolve(response(200, { data: { items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } } }));
    expect(await screen.findByText(/chưa có dữ liệu bảng xếp hạng/i)).toBeTruthy();
    cleanup();

    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    render(<LeaderboardPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: /thử lại/i })).toBeTruthy();
  });

  it('labels teams below the minimum series as "Chưa xếp hạng" and defaults older rows to ranked', async () => {
    const rows = [
      { ...pageOne.data.items[1], team: { id: 'u', name: 'Unranked' }, ratingStatus: 'UNRANKED_MIN_SERIES', ratedSeries: 4, finalsEligible: false },
      { ...pageOne.data.items[2], team: { id: 'r', name: 'Ranked' }, ratingStatus: 'RANKED', ratedSeries: 5, finalsEligible: true },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { data: { items: rows, pagination: pageOne.data.pagination } })));
    const result = await listLeaderboard();
    expect(result.items.map((item) => item.ratingStatus)).toEqual(['UNRANKED_MIN_SERIES', 'RANKED']);
    window.history.replaceState({}, '', '/leaderboard');
    render(<LeaderboardPage />);
    expect(await screen.findByText('Unranked')).toBeTruthy();
    expect(screen.getAllByText(/Chưa xếp hạng/)).toHaveLength(1);
  });
});
