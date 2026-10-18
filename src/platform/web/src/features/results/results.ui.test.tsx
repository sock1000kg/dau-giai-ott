// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listResults } from './api.ts';
import { MatchResultsPage } from './MatchResultsPage.tsx';

const base = { seriesId: 's-1', stage: 'QUALIFICATION', gameNumber: 1, teams: { x: { id: 'x', name: 'Team X' }, o: { id: 'o', name: 'Team O' } }, faults: null };
const rows = [
  { ...base, matchId: 'm-fin', status: 'FINALIZED', winnerTeamId: 'o', winnerSide: 'O', reason: 'REACHED_GOAL', turnCount: 12, finalizedAt: '2026-10-18T17:30:00.000Z' },
  { ...base, matchId: 'm-fail', status: 'FAILED', winnerTeamId: null, winnerSide: null, reason: null, turnCount: null, finalizedAt: null },
  { ...base, matchId: 'm-can', status: 'CANCELLED', winnerTeamId: null, winnerSide: null, reason: 'TURN_LIMIT', turnCount: 3, finalizedAt: '2026-10-18T00:00:00.000Z' },
];
const page = (items: unknown[], totalPages = 2) => ({ ok: true, json: async () => ({ data: { items, pagination: { page: 1, pageSize: 10, total: items.length, totalPages } } }) });

function stub(items: unknown[] = rows, totalPages = 2) {
  const fetch = vi.fn().mockImplementation(async (url: string) => url.includes('/admin/teams') ? { ok: true, json: async () => ({ data: [{ id: 't2', name: 'Team Two' }] }) } : page(items, totalPages));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const resultUrls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/results/'));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('results page UI', () => {
  it('uses a stage dropdown with the base options and no free-text input', async () => {
    stub();
    render(<MatchResultsPage isAdmin={false} />);
    await screen.findByText('Đã chốt');
    const select = screen.getByLabelText('Vòng/stage') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect([...select.options].map((o) => [o.value, o.text])).toEqual([['', 'Tất cả vòng'], ['QUALIFICATION', 'Vòng loại · QUALIFICATION'], ['FINALS', 'Chung kết · FINALS']]);
  });

  it('selecting a stage requests it and resets to page 1; "Tất cả vòng" sends no stage', async () => {
    const fetch = stub();
    render(<MatchResultsPage isAdmin={false} />);
    await screen.findByText('Đã chốt');
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(resultUrls(fetch).some((u) => u.includes('page=2'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Vòng/stage'), { target: { value: 'FINALS' } });
    await waitFor(() => expect(resultUrls(fetch).at(-1)).toContain('stage=FINALS'));
    expect(resultUrls(fetch).at(-1)).toContain('page=1');
    fireEvent.change(screen.getByLabelText('Vòng/stage'), { target: { value: '' } });
    await waitFor(() => expect(resultUrls(fetch).length).toBeGreaterThan(3));
    expect(resultUrls(fetch).at(-1)).not.toContain('stage=');
  });

  it('API omits an empty stage and sends a chosen one', async () => {
    const fetch = stub();
    await listResults('matches', { page: 1, pageSize: 10, stage: '' });
    await listResults('matches', { page: 1, pageSize: 10, stage: 'FINALS' });
    expect(resultUrls(fetch)).toEqual(['/api/v1/results/matches?page=1&pageSize=10', '/api/v1/results/matches?page=1&pageSize=10&stage=FINALS']);
  });

  it('adds an unknown stage seen in results and makes it selectable', async () => {
    const fetch = stub([{ ...rows[0], stage: 'SEMIS' }]);
    render(<MatchResultsPage isAdmin={false} />);
    await screen.findByText('Đã chốt');
    const select = screen.getByLabelText('Vòng/stage') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain('SEMIS');
    fireEvent.change(select, { target: { value: 'SEMIS' } });
    await waitFor(() => expect(resultUrls(fetch).at(-1)).toContain('stage=SEMIS'));
    expect((screen.getByLabelText('Vòng/stage') as HTMLSelectElement).value).toBe('SEMIS');
  });

  it('renders a labelled table for FINALIZED, FAILED and CANCELLED rows with one Replay link', async () => {
    stub();
    render(<MatchResultsPage isAdmin={false} />);
    await screen.findByText('Đã chốt');
    const table = screen.getByRole('table', { name: 'Kết quả từng trận' });
    const body = within(table).getAllByRole('row').slice(1);
    expect(body).toHaveLength(3);
    expect(within(body[0] as HTMLElement).getByText('Đã chốt')).toBeTruthy();
    expect(within(body[0] as HTMLElement).getByText('Thắng: Team O')).toBeTruthy();
    expect(within(body[0] as HTMLElement).getByText('Chạm đích')).toBeTruthy();
    expect(within(body[0] as HTMLElement).getByText('00:30 19/10/2026')).toBeTruthy();
    expect(within(body[1] as HTMLElement).getByText('Lỗi hạ tầng')).toBeTruthy();
    expect(within(body[1] as HTMLElement).getAllByText('—', { selector: 'td' })).toHaveLength(2);
    expect(within(body[2] as HTMLElement).getByText('Đã hủy')).toBeTruthy();
    expect(within(body[2] as HTMLElement).getByText('Hòa · hết giới hạn lượt')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Replay' });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/team/replays/m-fin');
    expect(screen.getByText(/Hiển thị 3 kết quả · Trang 1 \/ 2/)).toBeTruthy();
    expect(screen.getAllByText(/Team X vs Team O/)).toHaveLength(3);
    expect(document.querySelectorAll('[aria-hidden="true"], [hidden]')).toHaveLength(0);
  });

  it('shows the team filter to admins only and uses the admin replay URL', async () => {
    stub();
    render(<MatchResultsPage isAdmin />);
    expect(await screen.findByLabelText('Đội thi')).toBeTruthy();
    expect((await screen.findByRole('link', { name: 'Replay' })).getAttribute('href')).toBe('/admin/replays/m-fin/view');
    cleanup();
    stub();
    render(<MatchResultsPage isAdmin={false} />);
    await screen.findByText('Đã chốt');
    expect(screen.queryByLabelText('Đội thi')).toBeNull();
  });

  it('shows an alert with retry on failure, an empty state, and disabled pagination bounds', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue(page([], 0));
    vi.stubGlobal('fetch', fetch);
    render(<MatchResultsPage isAdmin={false} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Không thể tải kết quả');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Chưa có kết quả phù hợp.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Trang trước' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Trang sau' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('navigation', { name: 'Phân trang kết quả' })).toBeTruthy();
  });

  it('renders the series view with score, winner, status and cancellation labels', async () => {
    const series = [
      { seriesId: 's-a', stage: 'FINALS', status: 'FINALIZED', format: 'BO3', teams: { a: { id: 'a', name: 'Team A' }, b: { id: 'b', name: 'Team B' } }, score: { a: 2, b: 1 }, winnerTeamId: 'b', cancellationReason: null, finalizedAt: '2026-10-18T17:30:00Z' },
      { seriesId: 's-b', stage: 'FINALS', status: 'CANCELLED', format: 'BO3', teams: { a: { id: 'a', name: 'Team A' }, b: { id: 'b', name: 'Team B' } }, score: { a: null, b: null }, winnerTeamId: null, cancellationReason: 'MATCH_CANCELLED', finalizedAt: null },
    ];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => page(url.includes('/series') ? series : rows)));
    render(<MatchResultsPage isAdmin={false} />);
    await screen.findByText('Đã chốt');
    fireEvent.change(screen.getByLabelText('Loại kết quả'), { target: { value: 'series' } });
    expect(await screen.findByText('Tỉ số: 2 – 1 · Thắng: Team B')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Kết quả loạt trận' })).toBeTruthy();
    expect(screen.getByText('Tỉ số: — – —')).toBeTruthy();
    expect(screen.getByText('Trận bị hủy')).toBeTruthy();
    expect(screen.getByText('Đã hủy')).toBeTruthy();
  });
});
