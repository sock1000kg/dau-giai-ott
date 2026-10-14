import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

beforeAll(() => {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  if (typeof File !== 'undefined' && !File.prototype.text) {
    File.prototype.text = function () {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }
});

function jsonResponse(status: number, data?: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    json: async () => data,
    text: async () => JSON.stringify(data),
    blob: async () => new Blob([JSON.stringify(data)], { type: 'application/json' }),
  } as unknown as Response;
}

function csvResponse(status: number, csvText: string, filename: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'x-batch-id': 'mock-batch-id',
    }),
    text: async () => csvText,
    blob: async () => new Blob([csvText], { type: 'text/csv; charset=utf-8' }),
  } as unknown as Response;
}

function adminSession() {
  return jsonResponse(200, { data: { role: 'BTC_ADMIN' } });
}

beforeEach(() => {
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('BTC bulk team provisioning and bulk reset', () => {
  it('import success triggers one download and revokes URL, with no password text in document.body', async () => {
    const csvContent = '\uFEFFteam_name,representative_email,username,password\r\nTeam Alpha,alpha@example.com,alpha-user,super-secret-password-123\r\n';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(csvResponse(200, csvContent, 'team-credentials-20261014T160000Z.csv'))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ id: 't-1', name: 'Team Alpha', representativeEmail: 'alpha@example.com' }] }));

    vi.stubGlobal('fetch', fetchMock);

    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    const createObjectURL = vi.fn(() => {
      const url = `blob:http://localhost/${Math.random()}`;
      createdUrls.push(url);
      return url;
    });
    const revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /nhập danh sách đội từ csv|cấp tài khoản hàng loạt/i })).toBeTruthy();

    const file = new File(['team_name,representative_email\nTeam Alpha,alpha@example.com\n'], 'teams.csv', { type: 'text/csv' });
    const fileInput = screen.getByLabelText(/tải lên danh sách đội/i);
    fireEvent.change(fileInput, { target: { files: [file] } });

    const importButton = screen.getByRole('button', { name: /nhập danh sách/i });
    expect(importButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledOnce();
    });
    expect(createdUrls).toEqual(revokedUrls);

    // Verify warning notice and filename
    expect(await screen.findByText(/đã tải file team-credentials-20261014T160000Z\.csv — xóa file sau khi gửi/i)).toBeTruthy();

    // Verify plaintext password does NOT enter document.body
    expect(document.body.textContent).not.toContain('super-secret-password-123');
    expect(document.body.textContent).not.toContain('alpha-user');
  });

  it('renders row-error table on CSV validation failure (400)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(400, {
        error: {
          code: 'CSV_INVALID',
          message: 'CSV validation failed',
          errors: [
            { row: 1, column: 'team_name', code: 'TEAM_NAME_INVALID' },
            { row: 2, column: 'representative_email', code: 'EMAIL_INVALID' },
            { row: 3, column: 'representative_email', code: 'DUPLICATE_EMAIL', relatedRow: 1 },
          ],
        },
      }));

    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByText(/chưa có đội nào/i)).toBeTruthy();

    const file = new File(['bad csv'], 'bad.csv', { type: 'text/csv' });
    const fileInput = screen.getByLabelText(/tải lên danh sách đội/i);
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /nhập danh sách/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('table', { name: /bảng lỗi csv/i })).toBeTruthy();
    expect(screen.getByText('TEAM_NAME_INVALID')).toBeTruthy();
    expect(screen.getByText('EMAIL_INVALID')).toBeTruthy();
    expect(screen.getByText('DUPLICATE_EMAIL')).toBeTruthy();
    expect(screen.getByText(/trùng với dòng 1/i)).toBeTruthy();
  });

  it('disables import button during request to prevent duplicate clicks', async () => {
    let resolveImport!: (value: Response) => void;
    const pendingImport = new Promise<Response>((resolve) => {
      resolveImport = resolve;
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockImplementationOnce(() => pendingImport)
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });

    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByText(/chưa có đội nào/i)).toBeTruthy();

    const file = new File(['valid csv'], 'valid.csv', { type: 'text/csv' });
    const fileInput = screen.getByLabelText(/tải lên danh sách đội/i);
    fireEvent.change(fileInput, { target: { files: [file] } });

    const importButton = screen.getByRole('button', { name: /nhập danh sách/i });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(importButton.hasAttribute('disabled')).toBe(true);
      expect(importButton.textContent).toMatch(/đang nhập/i);
    });

    if (resolveImport) {
      resolveImport(csvResponse(200, 'header\nrow\n', 'credentials.csv'));
    }
    await waitFor(() => {
      expect(screen.queryByText(/đang nhập/i)).toBeNull();
    });
  });

  it('shows 403 message when operator lacks BTC_ADMIN permission', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } }));

    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByText(/chưa có đội nào/i)).toBeTruthy();

    const file = new File(['data'], 'teams.csv', { type: 'text/csv' });
    const fileInput = screen.getByLabelText(/tải lên danh sách đội/i);
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /nhập danh sách/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/không có quyền/i);
  });

  it('shows representativeEmail (or "—") in BTC team list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [
          { id: 't-1', name: 'Team With Email', representativeEmail: 'rep@example.com' },
          { id: 't-2', name: 'Team Without Email', representativeEmail: null },
        ],
      }));

    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByText('Team With Email')).toBeTruthy();
    expect(screen.getByText('rep@example.com')).toBeTruthy();
    expect(screen.getByText('Team Without Email')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('bulk reset requires confirmation and sends selected IDs', async () => {
    const csvContent = 'team_name,representative_email,username,password\r\nTeam 1,rep1@example.com,user1,reset-pass-1\r\nTeam 2,rep2@example.com,user2,reset-pass-2\r\n';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [
          { id: 't-1', name: 'Team 1', representativeEmail: 'rep1@example.com' },
          { id: 't-2', name: 'Team 2', representativeEmail: 'rep2@example.com' },
        ],
      }))
      .mockResolvedValueOnce(csvResponse(200, csvContent, 'team-credentials-reset.csv'));

    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn(() => 'blob:mock-reset');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByText('Team 1')).toBeTruthy();

    // Select all teams
    const selectAllCheckbox = screen.getByLabelText(/chọn tất cả/i);
    fireEvent.click(selectAllCheckbox);

    const bulkResetButton = screen.getByRole('button', { name: /cấp lại mật khẩu hàng loạt/i });
    expect(bulkResetButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(bulkResetButton);

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 đội đã chọn'));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledOnce();
    });

    // Check fetch body
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/admin/teams/bulk-reset');
    const resetBody = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);
    expect(resetBody).toEqual({ teamIds: ['t-1', 't-2'] });

    // Verify warning notice
    expect(await screen.findByText(/đã tải file team-credentials-reset\.csv — xóa file sau khi gửi/i)).toBeTruthy();

    // Never render plaintext passwords into DOM
    expect(document.body.textContent).not.toContain('reset-pass-1');
    expect(document.body.textContent).not.toContain('reset-pass-2');
  });

  it('cancels bulk reset when operator rejects confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(jsonResponse(200, {
        data: [{ id: 't-1', name: 'Team 1', representativeEmail: 'rep1@example.com' }],
      }));

    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    window.history.replaceState({}, '', '/admin/teams');
    render(<App />);

    expect(await screen.findByText('Team 1')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/chọn tất cả/i));
    fireEvent.click(screen.getByRole('button', { name: /cấp lại mật khẩu hàng loạt/i }));

    expect(window.confirm).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2); // Only session + list
  });
});
