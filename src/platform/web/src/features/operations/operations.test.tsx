import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

const matchId = '3f1b7c64-9d0e-4a53-8e55-0b1f4c2d7a11';

interface Mock {
  role?: 'BTC_ADMIN' | 'TEAM_ACCOUNT';
  privileged?: (url: string, init: RequestInit) => Response | Promise<Response>;
}

function install(options: Mock = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
    const path = String(url);
    calls.push({ url: path, init });
    if (path.startsWith('/api/v1/auth/')) {
      return response(200, { data: options.role === 'TEAM_ACCOUNT' ? { role: 'TEAM_ACCOUNT', teamId: 't1' } : { role: 'BTC_ADMIN' } });
    }
    if (path === '/api/v1/admin/teams') return response(200, { data: [] });
    if (path.startsWith('/api/v1/results/matches')) return response(200, { data: { items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } } });
    if (path.startsWith('/api/v1/admin/operations/audit')) return response(200, { data: { items: [] } });
    if (path === '/api/v1/public/queue-overrides') return response(200, { data: { items: [{ id: 'o1', action: 'RERUN', matchOpaqueId: 'abcdef0123456789', publicReason: 'Worker restarted', createdAt: '2026-10-18T00:00:00Z' }] } });
    if (init?.method === 'POST' && path.startsWith('/api/v1/admin/operations/')) {
      return options.privileged ? options.privileged(path, init) : response(200, { data: {} });
    }
    throw new Error(`unmocked request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

const posts = (calls: { url: string; init: RequestInit | undefined }[]) => calls.filter(({ init }) => init?.method === 'POST');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

async function openConsole(options: Mock = {}) {
  const api = install(options);
  window.history.replaceState({}, '', '/admin/operations');
  render(<App />);
  await screen.findByRole('heading', { name: 'Vận hành đặc quyền' });
  return api;
}

const priv = () => within(screen.getByRole('region', { name: 'Thao tác đặc quyền' }));

function fill(label: string | RegExp, value: string) {
  fireEvent.change(priv().getByLabelText(label), { target: { value } });
}

describe('OperationsConsole', () => {
  it('denies the route to team accounts and anonymous-equivalent roles', async () => {
    install({ role: 'TEAM_ACCOUNT' });
    window.history.replaceState({}, '', '/admin/operations');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /không có quyền truy cập/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Vận hành đặc quyền' })).toBeNull();
  });

  it('shows the public queue overrides and the audit viewer to BTC', async () => {
    await openConsole();
    expect(await screen.findByText(/Worker restarted/)).toBeTruthy();
    expect(screen.getByRole('table', { name: /sự kiện audit/i })).toBeTruthy();
  });

  it('requires a reason before the confirm step and sends nothing until confirmed', async () => {
    const api = await openConsole();
    fill('Mã đội (UUID)', matchId);
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    expect((await priv().findByRole('alert')).textContent).toMatch(/lý do/i);
    expect(priv().queryByRole('button', { name: 'Xác nhận thực hiện' })).toBeNull();

    fill(/Lý do \(bắt buộc, tối đa 500/, 'đã xác minh gian lận');
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    expect(await priv().findByRole('button', { name: 'Xác nhận thực hiện' })).toBeTruthy();
    expect(posts(api.calls)).toHaveLength(0);
  });

  it('sends exactly one request with one idempotency key and a correlation id on a double click', async () => {
    let release: (value: Response) => void = () => undefined;
    const api = await openConsole({ privileged: () => new Promise<Response>((resolve) => { release = resolve; }) });
    fill('Mã đội (UUID)', matchId);
    fill(/Lý do \(bắt buộc, tối đa 500/, 'đã xác minh gian lận');
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    const confirm = await priv().findByRole('button', { name: 'Xác nhận thực hiện' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    const [call] = posts(api.calls);
    expect(call!.url).toBe(`/api/v1/admin/operations/teams/${matchId}/suspend`);
    const headers = new Headers(call!.init!.headers);
    expect(headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(call!.init!.body))).toEqual({ reason: 'đã xác minh gian lận' });
    release(response(200, { data: {} }));
    expect(await screen.findByText(/Đã thực hiện: Đình chỉ đội/)).toBeTruthy();
  });

  it('requires the infra confirmation and a public reason for rerun, then posts the confirmed body', async () => {
    const api = await openConsole();
    fireEvent.change(priv().getByLabelText('Thao tác'), { target: { value: 'rerun' } });
    fill('Mã trận (UUID)', matchId);
    fill(/Lý do \(bắt buộc, tối đa 500/, 'worker mất lease');
    fill(/Lý do công khai/, 'Máy chủ khởi động lại');
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    expect((await priv().findByRole('alert')).textContent).toMatch(/lý do/i);
    expect(priv().queryByRole('button', { name: 'Xác nhận thực hiện' })).toBeNull();

    fireEvent.click(priv().getByLabelText(/xác nhận đây là lỗi hạ tầng/i));
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    fireEvent.click(await priv().findByRole('button', { name: 'Xác nhận thực hiện' }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(posts(api.calls)[0]!.url).toBe(`/api/v1/admin/operations/matches/${matchId}/rerun`);
    expect(JSON.parse(String(posts(api.calls)[0]!.init!.body))).toEqual({ reason: 'worker mất lease', publicReason: 'Máy chủ khởi động lại', verifiedInfraFailure: true });
  });

  it.each([
    [409, 'RERUN_NOT_INFRA_FAILURE', /không thuộc nhóm lỗi hạ tầng/],
    [409, 'RERUN_ROUND_SETTLED', /đã quyết toán/],
    [409, 'IDEMPOTENCY_KEY_REUSED', /idempotency/i],
    [403, 'FORBIDDEN', /không có quyền/],
    [401, 'UNAUTHENTICATED', /hết hạn/],
    [500, 'INTERNAL_ERROR', /Không thể hoàn tất/],
  ])('maps server error %s %s to a stable Vietnamese message', async (status, code, pattern) => {
    await openConsole({ privileged: () => response(status, { error: { code, message: 'server text must not leak' } }) });
    fireEvent.change(priv().getByLabelText('Thao tác'), { target: { value: 'rerun' } });
    fill('Mã trận (UUID)', matchId);
    fill(/Lý do \(bắt buộc, tối đa 500/, 'r');
    fill(/Lý do công khai/, 'p');
    fireEvent.click(priv().getByLabelText(/xác nhận đây là lỗi hạ tầng/i));
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    fireEvent.click(await priv().findByRole('button', { name: 'Xác nhận thực hiện' }));
    const alert = await priv().findByRole('alert');
    expect(alert.textContent).toMatch(pattern);
    expect(alert.textContent).not.toContain('server text must not leak');
  });
});
