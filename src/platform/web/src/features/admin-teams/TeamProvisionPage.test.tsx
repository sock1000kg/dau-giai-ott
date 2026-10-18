import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

function response(status: number, data?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const item of responses) fetchMock.mockResolvedValueOnce(item);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function adminSession() {
  return response(200, { data: { role: 'BTC_ADMIN' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('BTC team provisioning', () => {
  it('lists teams and only asks for a team name', async () => {
    mockFetch(
      adminSession(),
      response(200, { data: [{ id: 'team-1', name: 'Alpha' }] }),
    );
    window.history.replaceState({}, '', '/admin/teams');

    render(<App />);

    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByLabelText(/tên đội/i)).toBeTruthy();
    expect(screen.queryByLabelText(/username|mật khẩu|team id|teamid/i)).toBeNull();
  });

  it('recovers from a list error and shows a useful empty state', async () => {
    mockFetch(
      adminSession(),
      response(500, { error: { code: 'INTERNAL_ERROR', message: 'database password leaked?' } }),
      response(200, { data: [] }),
    );
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).not.toContain('database password');
    fireEvent.click(screen.getByRole('button', { name: /làm mới/i }));

    expect(await screen.findByText(/chưa có đội nào/i)).toBeTruthy();
  });

  it('shows a loading state until the team list arrives', async () => {
    let resolveList: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveList = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /quản lý đội thi/i })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/đang tải danh sách đội/i);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    if (resolveList === undefined) throw new Error('team list request was not started');
    resolveList(response(200, { data: [{ id: 'team-1', name: 'Alpha' }] }));
    expect(await screen.findByText('Alpha')).toBeTruthy();
  });

  it('creates a team and reveals credentials only in the one-time view', async () => {
    const fetchMock = mockFetch(
      adminSession(),
      response(200, { data: [] }),
      response(201, { data: { id: 'team-new', name: 'Beta', credential: { username: 'beta-1', password: 'new-secret' } } }),
    );
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/tên đội/i), { target: { value: '  Beta  ' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));

    expect(await screen.findByText('new-secret')).toBeTruthy();
    expect(screen.getByText('beta-1')).toBeTruthy();
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/admin/teams');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({ name: 'Beta' }),
    });
    fireEvent.click(screen.getByRole('button', { name: /đã lưu thông tin/i }));
    await waitFor(() => expect(screen.queryByText('new-secret')).toBeNull());
  });

  it('requires confirmation before resetting and replaces the one-time view', async () => {
    const fetchMock = mockFetch(
      adminSession(),
      response(200, { data: [{ id: 'team-1', name: 'Alpha' }] }),
      response(200, { data: { id: 'team-1', credential: { username: 'alpha-new', password: 'reset-secret' } } }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /cấp lại thông tin đăng nhập.*alpha/i }));

    expect(await screen.findByText('reset-secret')).toBeTruthy();
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/admin/teams/team-1/reset-credential');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });

  it('does not send a reset request when the BTC operator cancels confirmation', async () => {
    const fetchMock = mockFetch(
      adminSession(),
      response(200, { data: [{ id: 'team-1', name: 'Alpha' }] }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /cấp lại thông tin đăng nhập.*alpha/i }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('handles duplicate team names without exposing server details', async () => {
    mockFetch(
      adminSession(),
      response(200, { data: [] }),
      response(409, { error: { code: 'TEAM_NAME_TAKEN', message: 'private server detail' } }),
    );
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/tên đội/i), { target: { value: 'Alpha' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/đã tồn tại/i);
    expect(screen.getByRole('alert').textContent).not.toContain('private server detail');
  });

  it('does not render malformed one-time credential responses', async () => {
    mockFetch(
      adminSession(),
      response(200, { data: [] }),
      response(201, { data: { id: 'team-new', name: 'Epsilon', credential: { username: 'epsilon-1', password: '' } } }),
    );
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/tên đội/i), { target: { value: 'Epsilon' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('epsilon-1')).toBeNull();
  });

  it('copies the one-time credentials on request', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockFetch(
      adminSession(),
      response(200, { data: [] }),
      response(201, { data: { id: 'team-new', name: 'Gamma', credential: { username: 'gamma-1', password: 'gamma-secret' } } }),
    );
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/tên đội/i), { target: { value: 'Gamma' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));
    fireEvent.click(await screen.findByRole('button', { name: /sao chép/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Tên đăng nhập: gamma-1\nMật khẩu: gamma-secret'));
    expect(await screen.findByText(/đã sao chép/i)).toBeTruthy();
  });

  it('clears the one-time view when the page is left', async () => {
    mockFetch(
      adminSession(),
      response(200, { data: [] }),
      response(201, { data: { id: 'team-new', name: 'Delta', credential: { username: 'delta-1', password: 'delta-secret' } } }),
    );
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/tên đội/i), { target: { value: 'Delta' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));
    expect(await screen.findByText('delta-secret')).toBeTruthy();

    window.dispatchEvent(new Event('pagehide'));

    await waitFor(() => expect(screen.queryByText('delta-secret')).toBeNull());
  });
});
