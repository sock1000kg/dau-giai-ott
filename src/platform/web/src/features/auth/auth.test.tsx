import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

function response(status: number, data?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => data === undefined ? '' : JSON.stringify(data),
  } as Response;
}

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const item of responses) fetchMock.mockResolvedValueOnce(item);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('authentication routes', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('shows the login form when the server reports an expired session', async () => {
    mockFetch(response(401, { error: { code: 'UNAUTHENTICATED' } }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /đăng nhập/i })).toBeTruthy();
    expect(screen.getByLabelText(/tên đăng nhập/i)).toBeTruthy();
    expect(screen.getByLabelText(/mật khẩu/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /đăng ký|quên mật khẩu/i })).toBeNull();
  });

  it('keeps a generic message for invalid credentials and sends cookie credentials', async () => {
    const fetchMock = mockFetch(
      response(401, { error: { code: 'UNAUTHENTICATED' } }),
      response(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } }),
    );
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/tên đăng nhập/i), { target: { value: 'team-user' } });
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/không đúng/i);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/auth/login');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
    expect(screen.getByRole('alert').textContent).not.toContain('team-user');
  });

  it('accepts Enter submission and routes a successful login by server role', async () => {
    const fetchMock = mockFetch(
      response(401, { error: { code: 'UNAUTHENTICATED' } }),
      response(200, { data: { role: 'TEAM_ACCOUNT', teamId: 'private-team-id' } }),
    );
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/tên đăng nhập/i), { target: { value: 'team-user' } });
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: 'correct-password' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('heading', { name: /cổng đội thi/i })).toBeTruthy();
    expect(screen.queryByText('private-team-id')).toBeNull();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });

  it('explains rate limiting without exposing account existence', async () => {
    mockFetch(
      response(401, { error: { code: 'UNAUTHENTICATED' } }),
      response(429, { error: { code: 'LOGIN_RATE_LIMITED' } }),
    );
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/tên đăng nhập/i), { target: { value: 'unknown-user' } });
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: 'any-password' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Đăng nhập' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/thử lại sau/i);
    expect(screen.getByRole('alert').textContent).not.toContain('unknown-user');
  });

  it('does not render private content when session restoration fails', async () => {
    mockFetch(response(500, { error: { code: 'INTERNAL_ERROR' } }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: /chưa thể kiểm tra phiên/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /đăng xuất/i })).toBeNull();
  });

  it('restores a team session and blocks the BTC route at the UI boundary', async () => {
    mockFetch(response(200, { data: { role: 'TEAM_ACCOUNT', teamId: 'team-1' } }));
    window.history.replaceState({}, '', '/admin/teams');

    render(<App />);

    expect(await screen.findByRole('heading', { name: /không có quyền truy cập/i })).toBeTruthy();
    expect(screen.queryByText('team-1')).toBeNull();
  });

  it('allows a team session to open its session-scoped submission portal', async () => {
    const fetchMock = mockFetch(
      response(200, { data: { role: 'TEAM_ACCOUNT', teamId: 'private-team-id' } }),
      response(200, { data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } }),
    );
    window.history.replaceState({}, '', '/team/submissions');

    render(<App />);

    expect(await screen.findByRole('heading', { name: /nộp bot dự thi/i })).toBeTruthy();
    expect(await screen.findByText(/chưa có submission nào/i)).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/submissions?page=1&pageSize=20');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include' });
    expect(fetchMock.mock.calls[1]?.[0]).not.toContain('teamId');
    expect(screen.queryByText('private-team-id')).toBeNull();
  });

  it('routes results to both roles and keeps the admin-only page blocked from team accounts', async () => {
    mockFetch(
      response(200, { data: { role: 'TEAM_ACCOUNT', teamId: 'team-1' } }),
      response(200, { data: { items: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } } }),
    );
    window.history.replaceState({}, '', '/team/results');
    const { unmount } = render(<App />);
    expect(await screen.findByRole('heading', { name: /kết quả thi đấu/i })).toBeTruthy();
    expect(screen.queryByLabelText('Đội thi')).toBeNull();
    unmount();

    mockFetch(response(200, { data: { role: 'TEAM_ACCOUNT', teamId: 'team-1' } }));
    window.history.replaceState({}, '', '/admin/results');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /không có quyền truy cập/i })).toBeTruthy();
  });

  it('restores a BTC session only into the BTC area', async () => {
    mockFetch(response(200, { data: { role: 'BTC_ADMIN' } }));
    window.history.replaceState({}, '', '/');

    render(<App />);

    expect(await screen.findByRole('heading', { name: /khu vực btc/i })).toBeTruthy();
  });

  it('logs out through the API and returns to login', async () => {
    const fetchMock = mockFetch(
      response(200, { data: { role: 'BTC_ADMIN' } }),
      response(204),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /đăng xuất/i }));

    expect(await screen.findByRole('heading', { name: /đăng nhập/i })).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/auth/logout');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include', method: 'POST' });
  });

  it('keeps the current screen and reports a retryable logout failure', async () => {
    mockFetch(
      response(200, { data: { role: 'BTC_ADMIN' } }),
      response(500, { error: { code: 'INTERNAL_ERROR' } }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /đăng xuất/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /khu vực btc/i })).toBeTruthy();
  });
});
