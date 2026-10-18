import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function catalog(state = 'PRIVATE', stage = 'FINALS') {
  return { data: { items: [{
    matchId: 'match-1', state, eventLogSha256: `sha256:${'a'.repeat(64)}`,
    seriesId: 'series-1', stage, finalizedAt: '2026-10-13T08:00:00.000Z',
    teamX: { id: 'team-x', name: 'Alpha' }, teamO: { id: 'team-o', name: 'Beta' },
  }], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } } };
}

function adminSession() { return response(200, { data: { role: 'BTC_ADMIN' } }); }

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('BTC replay publication console', () => {
  it('loads terminal matches and reflects server-confirmed stage and publish states', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(response(200, catalog()))
      .mockResolvedValueOnce(response(200, { data: { matchId: 'match-1', state: 'STAGED' } }))
      .mockResolvedValueOnce(response(200, catalog('STAGED')))
      .mockResolvedValueOnce(response(200, { data: { matchId: 'match-1', state: 'PUBLISHED' } }))
      .mockResolvedValueOnce(response(200, catalog('PUBLISHED')));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/replays');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /phát hành replay/i })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /alpha.*beta/i })).toBeTruthy();
    expect(screen.getByText('Riêng tư')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /đưa vào duyệt/i }));
    fireEvent.change(screen.getByLabelText(/lý do/i), { target: { value: 'Đã kiểm tra kết quả' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận đưa vào duyệt/i }));
    expect(await screen.findByText('Đang chờ duyệt')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /công bố replay/i }));
    fireEvent.change(screen.getByLabelText(/lý do/i), { target: { value: 'Đủ điều kiện trình chiếu' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận công bố/i }));
    expect(await screen.findByText('Đã công bố')).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/stage') || String(url).includes('/publish'))).toHaveLength(2);
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify({ reason: 'Đã kiểm tra kết quả' }) });
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('idempotency-key')).toBeTruthy();
  });

  it('prevents team accounts from opening the BTC console', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { data: { role: 'TEAM_ACCOUNT', teamId: 'team-x' } }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/replays');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /không có quyền truy cập/i })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires a reason and retains the idempotency key for a retry after a failed transition', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(response(200, catalog()))
      .mockResolvedValueOnce(response(409, { error: { code: 'REPLAY_STATE_CONFLICT', message: 'private detail' } }))
      .mockResolvedValueOnce(response(200, { data: { matchId: 'match-1', state: 'STAGED' } }))
      .mockResolvedValueOnce(response(200, catalog('STAGED')));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/replays');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /đưa vào duyệt/i }));
    const confirm = screen.getByRole('button', { name: /xác nhận đưa vào duyệt/i });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(/lý do/i), { target: { value: 'Kiểm tra lần một' } });
    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).not.toContain('private detail');
    const firstKey = new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('idempotency-key');
    fireEvent.change(screen.getByLabelText(/lý do/i), { target: { value: 'Kiểm tra lần một' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận đưa vào duyệt/i }));
    await waitFor(() => expect(screen.getByText('Đang chờ duyệt')).toBeTruthy());
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get('idempotency-key')).toBe(firstKey);
  });

  it('locks the transition while a request is pending so a rapid second click cannot duplicate it', async () => {
    let resolveTransition: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(response(200, catalog()))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveTransition = resolve; }))
      .mockResolvedValueOnce(response(200, catalog('STAGED')));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/replays');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /đưa vào duyệt/i }));
    fireEvent.change(screen.getByLabelText(/lý do/i), { target: { value: 'BTC xác nhận replay' } });
    const confirm = screen.getByRole('button', { name: /xác nhận đưa vào duyệt/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/stage'))).toHaveLength(1);
    if (resolveTransition === undefined) throw new Error('transition request was not started');
    resolveTransition(response(200, { data: { matchId: 'match-1', state: 'STAGED' } }));
    expect(await screen.findByText('Đang chờ duyệt')).toBeTruthy();
  });

  it('provides loading, empty, and retryable error states', async () => {
    let resolveCatalog: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveCatalog = resolve; }))
      .mockResolvedValueOnce(response(500, { error: { message: 'secret db detail' } }))
      .mockResolvedValueOnce(response(200, { data: { items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } } }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/replays');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /phát hành replay/i })).toBeTruthy();
    // The heading renders before the catalog effect has issued its request; wait for that request explicitly.
    expect((await screen.findByRole('status')).textContent).toMatch(/đang tải/i);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    if (resolveCatalog === undefined) throw new Error('catalog request was not started');
    resolveCatalog(response(200, catalog()));
    expect(await screen.findByRole('heading', { name: /alpha.*beta/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /làm mới/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).not.toContain('secret db detail');
    expect(screen.getByRole('button', { name: /đưa vào duyệt/i }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /thử lại/i }));
    expect(await screen.findByText(/chưa có replay đủ điều kiện/i)).toBeTruthy();
  });

  it('hides stage and publish controls for non-FINALS matches and shows private notice', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(response(200, catalog('PRIVATE', 'QUALIFICATION')));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/replays');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /phát hành replay/i })).toBeTruthy();
    expect(await screen.findByText(/Vòng loại: replay riêng tư — không công khai/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /đưa vào duyệt/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /công bố replay/i })).toBeNull();
  });
});
