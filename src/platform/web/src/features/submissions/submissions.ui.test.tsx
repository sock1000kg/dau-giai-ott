// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmissionApiError, type TeamSubmission } from './api.ts';
import { SubmissionForm } from './SubmissionForm.tsx';
import { SubmissionStatus } from './SubmissionStatus.tsx';

const api = vi.hoisted(() => ({
  listSubmissions: vi.fn(),
  uploadSubmission: vi.fn(),
  sha256File: vi.fn(),
  reserveSubmission: vi.fn(),
}));

vi.mock('./api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.ts')>()),
  ...api,
}));

const sha = `sha256:${'a'.repeat(64)}`;
const make = (id: string, status: TeamSubmission['status'], extra: Partial<TeamSubmission> = {}): TeamSubmission => ({
  id, status, archiveSha256: sha, createdAt: '2026-10-13T17:30:00.000Z', preflightPosition: null, ...extra,
});
const page = (items: readonly TeamSubmission[], current = 1, totalPages = 1, preflightQueueLength = 5) => ({
  items,
  pagination: { page: current, pageSize: 20, totalItems: items.length, totalPages },
  preflightQueueLength,
});
const tarFile = () => new File(['oci'], 'bot.tar');
const pick = (file: File) => fireEvent.change(screen.getByLabelText(/oci image archive/i), { target: { files: [file] } });

beforeEach(() => {
  api.sha256File.mockResolvedValue(sha);
  api.reserveSubmission.mockResolvedValue({ id: 'res-1', archiveSha256: sha, roundId: 'r', reservedAt: '2026-10-13T00:00:00.000Z', graceEndsAt: '2026-10-21T00:00:00.000Z', status: 'RESERVED' });
  api.uploadSubmission.mockResolvedValue(make('s', 'UPLOADED'));
  api.listSubmissions.mockResolvedValue(page([]));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('submission page frame', () => {
  it('has both named cards in a two-column layout and the process list', async () => {
    const { container } = render(<SubmissionForm />);
    expect(screen.getByRole('heading', { level: 1, name: 'Nộp bot dự thi' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Tải OCI archive' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Các bot đã nộp' })).toBeTruthy();
    expect(container.querySelector('.submissions-layout')?.querySelectorAll(':scope > .ui-card').length).toBe(2);
    const steps = screen.getByRole('list', { name: 'Quy trình' });
    expect(within(steps).getAllByRole('listitem').length).toBe(4);
    await screen.findByText('Đội chưa có submission nào.');
  });
});

describe('upload card', () => {
  it('shows name/size and the ready badge, hides them when cleared; submit disabled without a file', async () => {
    render(<SubmissionForm />);
    await screen.findByText('Đội chưa có submission nào.');
    const submit = screen.getByRole('button', { name: 'Nộp bot' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.queryByText('Sẵn sàng')).toBeNull();
    pick(tarFile());
    expect(screen.getByText(/bot\.tar · 0\.0 MiB/)).toBeTruthy();
    expect(screen.getByText('Sẵn sàng')).toBeTruthy();
    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/oci image archive/i), { target: { files: [] } });
    expect(screen.queryByText('Sẵn sàng')).toBeNull();
    expect(submit.disabled).toBe(true);
  });

  it('shows progress while uploading, disables submit and input, and uploads once on double click', async () => {
    let finish: ((s: TeamSubmission) => void) | undefined;
    api.uploadSubmission.mockImplementation((_f: File, _r: string, onProgress: (l: number, t: number) => void) => {
      onProgress(25, 100);
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<SubmissionForm />);
    pick(tarFile());
    const submit = screen.getByRole('button', { name: 'Nộp bot' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(await screen.findByText('Đang tải archive: 25%')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Tiến trình tải archive' });
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect((screen.getByRole('button', { name: 'Đang nộp…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/oci image archive/i) as HTMLInputElement).disabled).toBe(true);
    expect(api.uploadSubmission).toHaveBeenCalledOnce();
    finish?.(make('s', 'UPLOADED'));
    const ok = await screen.findByText(/Đã nhận submission/);
    expect(ok.getAttribute('role')).toBe('status');
    expect(ok.className).toContain('ui-alert--success');
  });

  it.each<[number, string | null, RegExp]>([
    [401, null, /phiên đăng nhập đã hết hạn/i],
    [403, 'SUBMISSION_DEADLINE_PASSED', /đã quá hạn nộp bot/i],
    [403, 'RESERVATION_REQUIRED', /cần có mã giữ chỗ hợp lệ/i],
    [403, 'RESERVATION_INVALID', /mã giữ chỗ không hợp lệ/i],
    [403, 'SUBMISSION_CLOSED', /đã đóng hoàn toàn/i],
    [403, null, /không có quyền nộp bot/i],
    [409, 'SUBMISSION_NOT_OPEN', /chưa đến thời gian nộp bot/i],
    [409, 'RESERVATION_HASH_MISMATCH', /không khớp với sha-256/i],
    [409, 'OTHER', /Máy chủ từ chối yêu cầu \(OTHER\)/],
    [429, 'UPLOAD_BUSY', /đang bận xử lý/i],
    [0, null, /không kết nối được máy chủ/i],
    [400, 'ARCHIVE_TOO_LARGE', /vượt quá giới hạn 256 MiB/i],
    [500, null, /không thể hoàn tất yêu cầu/i],
  ])('renders danger alert for %i %s', async (status, code, message) => {
    api.uploadSubmission.mockRejectedValueOnce(new SubmissionApiError(status, code));
    render(<SubmissionForm />);
    pick(tarFile());
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bot' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(message);
    expect(alert.className).toContain('ui-alert--danger');
  });
});

const noop = () => undefined;
const status = (rows: readonly TeamSubmission[], over: Partial<Parameters<typeof SubmissionStatus>[0]> = {}) => (
  <SubmissionStatus submissions={rows} loading={false} error={null} onRetry={noop} onPageChange={noop} preflightQueueLength={7}
    pagination={{ page: 1, pageSize: 20, totalItems: rows.length, totalPages: 1 }} {...over} />
);

describe('history table', () => {
  const labels: [TeamSubmission['status'], string][] = [
    ['UPLOADED', 'Đã tải lên'], ['INSPECTING', 'Đang kiểm tra'], ['INVALID', 'Không hợp lệ'], ['PREFLIGHT', 'Chờ kiểm tra bot'],
    ['VALID', 'Bot hợp lệ'], ['ACTIVE', 'Đang sử dụng'], ['SUPERSEDED', 'Đã thay thế'], ['REVOKED', 'Đã thu hồi'],
  ];

  it('renders one row per status with its label badge and the table name', () => {
    render(status(labels.map(([s], i) => make(`id${i}`, s))));
    const table = screen.getByRole('table', { name: 'Danh sách submission của đội' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.length).toBe(8);
    labels.forEach(([, label], i) => {
      const badge = within(rows[i]!).getByText(label);
      expect(badge.className).toContain('ui-badge');
    });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Thời điểm', 'Trạng thái', 'Vị trí preflight']);
  });

  it('shows preflight position only for PREFLIGHT', () => {
    render(status([make('a', 'PREFLIGHT', { preflightPosition: 2 }), make('b', 'ACTIVE', { preflightPosition: 1 })]));
    expect(screen.getAllByText(/Vị trí preflight: /).length).toBe(1);
    expect(screen.getByText('Vị trí preflight: 2 / 7')).toBeTruthy();
  });

  it('formats the date in Asia/Ho_Chi_Minh', () => {
    render(status([make('a', 'ACTIVE')]));
    const time = document.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-10-13T17:30:00.000Z');
    expect(time?.textContent).toBe(new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(new Date('2026-10-13T17:30:00.000Z')));
    expect(time?.textContent).toMatch(/00:30/);
    expect(time?.textContent).toMatch(/14\/10\/2026|14\/10\/26/);
  });

  it('shows loading, error with retry, and empty states', () => {
    const retry = vi.fn();
    const { rerender } = render(status([], { loading: true }));
    expect(screen.getByRole('status').textContent).toBe('Đang tải trạng thái submission…');
    rerender(status([], { error: 'Lỗi tải', onRetry: retry }));
    expect(screen.getByRole('alert').textContent).toContain('Lỗi tải');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(status([]));
    expect(screen.getByRole('status').textContent).toBe('Đội chưa có submission nào.');
  });

  it('disables pagination at the edges and reports page changes', () => {
    const change = vi.fn();
    const rows = [make('a', 'ACTIVE')];
    const { rerender } = render(status(rows, { onPageChange: change, pagination: { page: 1, pageSize: 20, totalItems: 30, totalPages: 2 } }));
    expect((screen.getByRole('button', { name: 'Trang trước' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(change).toHaveBeenCalledWith(2);
    rerender(status(rows, { onPageChange: change, pagination: { page: 2, pageSize: 20, totalItems: 30, totalPages: 2 } }));
    expect((screen.getByRole('button', { name: 'Trang sau' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(change).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('navigation', { name: 'Phân trang submission' }).textContent).toContain('Trang 2 / 2 · 30 submission');
  });
});
