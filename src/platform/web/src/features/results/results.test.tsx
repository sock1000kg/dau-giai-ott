// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchResultsPage } from './MatchResultsPage.tsx';
import { listResults, ResultsApiError } from './api.ts';

const matchResponse = {
  data: { items: [{ matchId: 'm-1', seriesId: 's-1', stage: 'FINAL', gameNumber: 1, status: 'FINALIZED', teams: { x: { id: 'x', name: 'Team X' }, o: { id: 'o', name: 'Team O' } }, winnerTeamId: 'o', winnerSide: 'O', reason: 'FORFEIT', turnCount: 4, finalizedAt: '2026-10-13T00:00:00.000Z', faults: { X: { recoverableTotal: 2, recoverableConsecutive: 1, lastErrorCode: 'BOT_TIMEOUT' }, O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null } }, seed: 'must-not-render', eventLogKey: 'private/key' }], pagination: { page: 1, pageSize: 10, total: 11, totalPages: 2 } },
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('results API and pages', () => {
  it('maps server result fields and includes an admin team filter only when selected', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => matchResponse });
    vi.stubGlobal('fetch', fetch);
    const result = await listResults('matches', { page: 1, pageSize: 10, teamId: 'team-2' });
    expect(result.items[0]).toMatchObject({ winnerSide: 'O', reason: 'FORFEIT', faults: { X: { recoverableTotal: 2, lastErrorCode: 'BOT_TIMEOUT' } } });
    expect(fetch).toHaveBeenCalledWith('/api/v1/results/matches?page=1&pageSize=10&teamId=team-2', { credentials: 'include' });
  });

  it('renders outcome, fault summary, pagination without private seed or object key', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => url.includes('/admin/teams')
      ? { ok: true, json: async () => ({ data: [] }) }
      : { ok: true, json: async () => matchResponse });
    vi.stubGlobal('fetch', fetch);
    render(<MatchResultsPage isAdmin={false} />);
    expect(await screen.findByText(/Thắng: Team O/)).toBeTruthy();
    expect(screen.getByLabelText('Tóm tắt lỗi bot').textContent).toContain('BOT_TIMEOUT');
    expect(screen.getByText('Trang 1 / 2')).toBeTruthy();
    expect(document.body.textContent).not.toContain('must-not-render');
    expect(document.body.textContent).not.toContain('private/key');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls.find(([url]) => String(url).includes('/results/matches'))?.[0]).not.toContain('teamId');
  });

  it('shows loading, empty and recoverable forbidden/error states', async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((done) => { resolve = done; })));
    render(<MatchResultsPage isAdmin={false} />);
    expect(screen.getByRole('status').textContent).toContain('Đang tải');
    resolve({ ok: true, json: async () => ({ data: { items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } } }) });
    expect(await screen.findByText('Chưa có kết quả phù hợp.')).toBeTruthy();
    cleanup();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    render(<MatchResultsPage isAdmin={false} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('không có quyền');
  });

  it('maps API forbidden response to a stable error class', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(listResults('series', { page: 1, pageSize: 10 })).rejects.toBeInstanceOf(ResultsApiError);
  });

  it('handles terminal infrastructure matches without an official result or fault row', async () => {
    const row = { ...matchResponse.data.items[0], status: 'FAILED', winnerTeamId: null, winnerSide: null, reason: null, turnCount: null, finalizedAt: null, faults: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { items: [row], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } } }) }));
    const result = await listResults('matches', { page: 1, pageSize: 10 });
    expect(result.items[0]?.faults).toBeNull();
  });

  it('maps and renders series score, winner and cancellation state', async () => {
    const seriesResponse = { data: { items: [{ seriesId: 's-2', stage: 'QUALIFICATION', status: 'FINALIZED', format: 'BO2', teams: { a: { id: 'a', name: 'Team A' }, b: { id: 'b', name: 'Team B' } }, score: { a: 2, b: 0 }, winnerTeamId: 'a', cancellationReason: null, finalizedAt: '2026-10-13T00:00:00.000Z', seed: 'private-seed' }], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } } };
    const fetch = vi.fn().mockImplementation(async (url: string) => url.includes('/admin/teams')
      ? { ok: true, json: async () => ({ data: [] }) }
      : url.includes('/series') ? { ok: true, json: async () => seriesResponse } : { ok: true, json: async () => matchResponse });
    vi.stubGlobal('fetch', fetch);
    render(<MatchResultsPage isAdmin={false} />);
    await screen.findByText(/Thắng: Team O/);
    fireEvent.change(screen.getByLabelText('Loại kết quả'), { target: { value: 'series' } });
    expect(await screen.findByText(/Tỉ số: 2 – 0 · Thắng: Team A/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('private-seed');
  });

  it('paginates and supports BTC team filtering', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => url.includes('/admin/teams')
      ? { ok: true, json: async () => ({ data: [{ id: 'team-2', name: 'Team Two' }] }) }
      : { ok: true, json: async () => matchResponse });
    vi.stubGlobal('fetch', fetch);
    render(<MatchResultsPage isAdmin />);
    await screen.findByText(/Thắng: Team O/);
    fireEvent.change(screen.getByLabelText('Đội thi'), { target: { value: 'team-2' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('teamId=team-2'), expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.anything()));
  });
});
