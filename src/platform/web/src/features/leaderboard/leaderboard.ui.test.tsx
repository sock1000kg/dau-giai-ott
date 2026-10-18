// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { LeaderboardPage, stageOptions } from './LeaderboardPage.tsx';
import { LeaderboardTable, formatShortDate } from './LeaderboardTable.tsx';
import type { LeaderboardEntry } from './api.ts';

function entry(over: Record<string, unknown>): LeaderboardEntry {
  return { rank: 1, tieBreakStatus: 'CLEAR', ratingStatus: 'RANKED', team: { id: 'x', name: 'X' }, rating: 1234567, headToHeadPoints: 3,
    series: { wins: 2, draws: 1, losses: 0 }, winRate: 0.855, technicalFaultCount: 0, forfeitCount: 0, updatedAt: '2026-10-13T20:30:00.000Z', ...over } as LeaderboardEntry;
}
const rows = [
  entry({ rank: 1, team: { id: 'a', name: 'Alpha' } }),
  entry({ rank: 1, team: { id: 'b', name: 'Beta' }, tieBreakStatus: 'BTC_REQUIRED' }),
  entry({ rank: 3, team: { id: 'c', name: 'Gamma' }, ratingStatus: 'UNRANKED_MIN_SERIES' }),
  entry({ rank: 4, team: { id: 'd', name: 'Delta' } }),
];
function response(data: unknown): Response { return { ok: true, status: 200, json: async () => data } as Response; }
function stubFetch(items: readonly LeaderboardEntry[] = rows, totalPages = 2) {
  const fetch = vi.fn().mockResolvedValue(response({ data: { items, pagination: { page: 1, pageSize: 25, total: items.length, totalPages } } }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('leaderboard stage select', () => {
  it('offers known stages and keeps any other stage selectable', () => {
    expect(stageOptions('QUALIFICATION').map(([value]) => value)).toEqual(['QUALIFICATION', 'FINALS']);
    expect(stageOptions('QUALIFICATION_X', '').map(([value]) => value)).toEqual(['QUALIFICATION', 'FINALS', 'QUALIFICATION_X']);
    expect(stageOptions('FINALS', 'FINALS').length).toBe(2);
  });

  it('renders the select with options and applies only on submit, resetting to page 1', async () => {
    const fetch = stubFetch();
    render(<LeaderboardPage />);
    await screen.findByText('Alpha');
    const select = screen.getByLabelText('Vòng đấu / stage') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Vòng loại', 'Chung kết']);
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.anything()));
    const calls = fetch.mock.calls.length;
    fireEvent.change(select, { target: { value: 'FINALS' } });
    expect(fetch.mock.calls.length).toBe(calls);
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/v1/leaderboard?stage=FINALS&page=1&pageSize=25', expect.anything()));
  });
});

describe('leaderboard table', () => {
  it('shows tags, highlights top-3 ranks only and keeps ties', () => {
    render(<LeaderboardTable items={rows} />);
    expect(screen.getByRole('region', { name: 'Bảng xếp hạng các đội' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByText('BTC cần quyết định')).toBeTruthy();
    expect(screen.getByText('Chưa xếp hạng')).toBeTruthy();
    const classOf = (name: string) => screen.getByText(name).closest('tr')?.className ?? '';
    expect(classOf('Alpha')).toContain('pub-row-top');
    expect(classOf('Beta')).toContain('pub-row-top');
    expect(classOf('Gamma')).toContain('pub-row-top');
    expect(classOf('Delta')).not.toContain('pub-row-top');
    expect(screen.getByText('Thứ hạng và thành tích do máy chủ giải đấu cung cấp').tagName).toBe('CAPTION');
  });

  it('formats numbers in vi-VN and dates in Vietnam time', () => {
    render(<LeaderboardTable items={[rows[0]!]} />);
    expect(screen.getByText('1.234.567')).toBeTruthy();
    expect(screen.getByText('85,5%')).toBeTruthy();
    expect(formatShortDate('2026-10-13T20:30:00.000Z')).toBe('14/10/2026');
    expect(screen.getByText('14/10/2026').getAttribute('datetime')).toBe('2026-10-13T20:30:00.000Z');
    expect(formatShortDate('nope')).toBe('nope');
  });
});

describe('leaderboard states', () => {
  it('shows summary and disables pagination at the edges', async () => {
    stubFetch();
    render(<LeaderboardPage />);
    await screen.findByText('Alpha');
    expect(screen.getByText('Hiển thị 4 đội · Trang 1 / 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Trang trước' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Trang sau' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows empty, loading and retryable error states', async () => {
    stubFetch([], 0);
    render(<LeaderboardPage />);
    expect(screen.getByRole('status').textContent).toMatch(/Đang tải/);
    expect(await screen.findByText('Chưa có dữ liệu bảng xếp hạng cho vòng đấu này.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Trang sau' }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<LeaderboardPage />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  });
});

describe('public shell links', () => {
  it('marks only the matching public link as current', async () => {
    stubFetch();
    window.history.replaceState({}, '', '/leaderboard');
    render(<App />);
    await screen.findByText('Alpha');
    expect(screen.getByRole('link', { name: 'Bảng xếp hạng' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Thông tin giải đấu' }).getAttribute('aria-current')).toBeNull();
  });
});
