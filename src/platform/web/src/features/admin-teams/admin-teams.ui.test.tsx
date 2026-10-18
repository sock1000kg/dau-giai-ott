import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

function json(status: number, data?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
    text: async () => JSON.stringify(data),
    blob: async () => new Blob([JSON.stringify(data)]),
  } as unknown as Response;
}

function csv(text: string, filename: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/csv', 'content-disposition': `attachment; filename="${filename}"` }),
    text: async () => text,
    blob: async () => new Blob([text], { type: 'text/csv' }),
  } as unknown as Response;
}

const admin = () => json(200, { data: { role: 'BTC_ADMIN' } });
const teams = [
  { id: 't-1', name: 'Alpha', representativeEmail: 'a@example.com' },
  { id: 't-2', name: 'Beta', representativeEmail: null },
];

function open(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const item of responses) fetchMock.mockResolvedValueOnce(item);
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/admin/teams');
  render(<App />);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('admin teams UI', () => {
  it('renders the three named cards, create help and counter', async () => {
    open(admin(), json(200, { data: teams }));
    expect(await screen.findByRole('heading', { name: 'Tạo đội mới' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /cấp tài khoản hàng loạt/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Danh sách đội' })).toBeTruthy();
    const input = screen.getByLabelText('Tên đội');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(/tối đa 100 ký tự/i)).toBeTruthy();
    expect(screen.getByText('0/100')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Gamma' } });
    expect(screen.getByText('5/100')).toBeTruthy();
    expect(screen.getByRole('link', { name: /về khu vực btc/i }).getAttribute('href')).toBe('/admin');
  });

  it('shows name-taken at the field with an alert and marks it invalid', async () => {
    open(admin(), json(200, { data: [] }), json(409, { error: { code: 'TEAM_NAME_TAKEN', message: 'x' } }));
    fireEvent.change(await screen.findByLabelText('Tên đội'), { target: { value: 'Alpha' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));
    expect((await screen.findByRole('alert')).textContent).toBe('Tên đội đã tồn tại.');
    const input = screen.getByLabelText('Tên đội');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')?.split(' ').pop() ?? '')?.textContent).toBe('Tên đội đã tồn tại.');
  });

  it('creating hides the create form and shows the credential card', async () => {
    open(admin(), json(200, { data: [] }), json(201, { data: { id: 'n', name: 'Zeta', credential: { username: 'zeta-1', password: 'zeta-secret' } } }));
    fireEvent.change(await screen.findByLabelText('Tên đội'), { target: { value: 'Zeta' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));
    expect(await screen.findByText('zeta-secret')).toBeTruthy();
    expect(screen.queryByRole('form', { name: /tạo đội/i })).toBeNull();
    expect(screen.getByRole('region', { name: /thông tin đăng nhập tạo một lần/i })).toBeTruthy();
    expect(screen.getByText(/chỉ hiển thị một lần/i)).toBeTruthy();
  });

  it('renders the team table with caption, per-row labels and selection count', async () => {
    const fetchMock = open(admin(), json(200, { data: teams }), csv('x', 'reset.csv'));
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const table = await screen.findByRole('table', { name: 'Danh sách đội thi' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('Đã chọn 0/2')).toBeTruthy();
    const bulk = screen.getByRole('button', { name: /cấp lại mật khẩu hàng loạt/i });
    expect(bulk.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('Chọn đội Alpha'));
    expect(screen.getByText('Đã chọn 1/2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Chọn tất cả'));
    expect(screen.getByText('Đã chọn 2/2')).toBeTruthy();
    expect((screen.getByLabelText('Chọn đội Beta') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Chọn tất cả'));
    expect(screen.getByText('Đã chọn 0/2')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Chọn tất cả'));
    fireEvent.click(bulk);
    expect(window.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/admin/teams/bulk-reset');
  });

  it('shows the empty state, error state and disables refresh while loading', async () => {
    let resolveList: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(admin())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveList = resolve; }))
      .mockResolvedValueOnce(json(500, { error: { code: 'INTERNAL_ERROR' } }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);
    const refresh = await screen.findByRole('button', { name: 'Làm mới' });
    expect(refresh.hasAttribute('disabled')).toBe(true);
    resolveList?.(json(200, { data: [] }));
    expect(await screen.findByText(/chưa có đội nào/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('bulk import: labelled file input with format help and an error table with badges', async () => {
    open(admin(), json(200, { data: [] }), json(422, { error: { code: 'CSV_INVALID', errors: [{ row: 2, column: 'email', code: 'EMAIL_INVALID' }, { row: 0, code: 'CSV_EMPTY' }] } }));
    const input = await screen.findByLabelText(/tải lên danh sách đội/i);
    expect(screen.getByText(/team_name,representative_email/)).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.change(input, { target: { files: [new File(['a'], 't.csv', { type: 'text/csv' })] } });
    fireEvent.click(screen.getByRole('button', { name: /nhập danh sách/i }));
    const table = await screen.findByRole('table', { name: /bảng lỗi csv/i });
    expect(within(table).getByText('EMAIL_INVALID').className).toContain('ui-badge');
    expect(within(table).getByText('Toàn tệp')).toBeTruthy();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('security: credentials leave the DOM on dismiss and pagehide and never reach web storage', async () => {
    open(admin(), json(200, { data: [] }),
      json(201, { data: { id: 'a', name: 'One', credential: { username: 'one-1', password: 'one-secret' } } }),
      json(201, { data: { id: 'b', name: 'Two', credential: { username: 'two-1', password: 'two-secret' } } }));
    fireEvent.change(await screen.findByLabelText('Tên đội'), { target: { value: 'One' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));
    expect(await screen.findByText('one-secret')).toBeTruthy();
    const dump = () => JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(dump()).not.toMatch(/one-secret|one-1/);
    fireEvent.click(screen.getByRole('button', { name: /đã lưu thông tin/i }));
    await waitFor(() => expect(document.body.textContent).not.toContain('one-secret'));

    fireEvent.change(screen.getByLabelText('Tên đội'), { target: { value: 'Two' } });
    fireEvent.submit(screen.getByRole('form', { name: /tạo đội/i }));
    expect(await screen.findByText('two-secret')).toBeTruthy();
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(() => expect(document.body.textContent).not.toContain('two-secret'));
    expect(document.body.textContent).not.toContain('two-1');
    expect(dump()).not.toMatch(/two-secret|two-1/);
  });
});
