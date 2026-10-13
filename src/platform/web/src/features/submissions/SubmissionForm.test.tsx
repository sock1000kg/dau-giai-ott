import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubmissionApiError, type TeamSubmission } from './api.ts';
import { SubmissionForm } from './SubmissionForm.tsx';

const api = vi.hoisted(() => ({ listSubmissions: vi.fn(), uploadSubmission: vi.fn() }));
vi.mock('./api.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api.ts')>()), ...api }));

const row: TeamSubmission = { id: 'sub-1', status: 'PREFLIGHT', archiveSha256: `sha256:${'a'.repeat(64)}`, createdAt: '2026-10-13T00:00:00.000Z' };
const page = (items: readonly TeamSubmission[], current = 1, totalPages = 1) => ({ items, pagination: { page: current, pageSize: 20, totalItems: items.length + totalPages - 1, totalPages } });

afterEach(() => { vi.clearAllMocks(); });

describe('team submission portal', () => {
  it('shows the current team submissions and status', async () => {
    api.listSubmissions.mockResolvedValue(page([row]));
    render(<SubmissionForm />);

    expect(await screen.findByText('Chờ kiểm tra bot')).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(row.createdAt);
    expect(api.listSubmissions).toHaveBeenCalledOnce();
  });

  it('shows loading and an explicit empty state', async () => {
    let resolveList: ((rows: readonly TeamSubmission[]) => void) | undefined;
    api.listSubmissions.mockImplementation(() => new Promise((resolve) => { resolveList = (rows) => resolve(page(rows)); }));
    render(<SubmissionForm />);

    expect(screen.getByRole('status').textContent).toMatch(/đang tải trạng thái/i);
    if (resolveList === undefined) throw new Error('submission list request was not started');
    resolveList([]);
    expect(await screen.findByText(/chưa có submission nào/i)).toBeTruthy();
  });

  it('rejects empty, non-tar and over-limit files before upload', async () => {
    api.listSubmissions.mockResolvedValue(page([]));
    render(<SubmissionForm />);
    const input = screen.getByLabelText(/oci image archive/i) as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File([], 'empty.tar')] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/không được để trống/i);
    fireEvent.change(input, { target: { files: [new File(['archive'], 'bot.zip')] } });
    expect(screen.getByRole('alert').textContent).toMatch(/đuôi \.tar/i);
    expect(input.value).toBe('');
    const oversized = new File(['archive'], 'large.tar');
    Object.defineProperty(oversized, 'size', { value: 256 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByRole('alert').textContent).toMatch(/vượt quá giới hạn/i);
    expect(api.uploadSubmission).not.toHaveBeenCalled();
  });

  it('uploads only the archive, reports progress and refreshes status once', async () => {
    api.listSubmissions.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([row]));
    let finishUpload: ((submission: TeamSubmission) => void) | undefined;
    api.uploadSubmission.mockImplementation((_file: File, progress: (loaded: number, total: number) => void) => {
      progress(50, 100);
      return new Promise((resolve) => { finishUpload = resolve; });
    });
    render(<SubmissionForm />);
    const file = new File(['oci archive'], 'bot.oci.tar', { type: 'application/x-tar' });
    const input = screen.getByLabelText(/oci image archive/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bot' }));
    fireEvent.submit(screen.getByRole('button', { name: /đang nộp/i }).closest('form')!);

    expect(screen.getByText(/đang tải archive: 50%/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /đang nộp/i }).hasAttribute('disabled')).toBe(true);
    expect(api.uploadSubmission).toHaveBeenCalledWith(file, expect.any(Function));
    expect(api.uploadSubmission).toHaveBeenCalledOnce();
    if (finishUpload === undefined) throw new Error('upload request was not started');
    finishUpload(row);

    expect(await screen.findByText(/đã nhận submission/i)).toBeTruthy();
    expect(input.value).toBe('');
    expect(await screen.findByText('Chờ kiểm tra bot')).toBeTruthy();
    expect(api.listSubmissions).toHaveBeenCalledTimes(2);
  });

  it('uses stable server error codes and supports retry after a forbidden response', async () => {
    api.listSubmissions.mockRejectedValueOnce(new SubmissionApiError(403, 'FORBIDDEN')).mockResolvedValueOnce(page([]));
    render(<SubmissionForm />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/không có quyền/i);
    fireEvent.click(screen.getByRole('button', { name: /thử lại/i }));
    expect(await screen.findByText(/chưa có submission nào/i)).toBeTruthy();
  });

  it('does not expose arbitrary backend messages on upload failure', async () => {
    api.listSubmissions.mockResolvedValue(page([]));
    api.uploadSubmission.mockRejectedValue(new SubmissionApiError(400, 'OCI_LAYOUT_INVALID'));
    render(<SubmissionForm />);
    fireEvent.change(screen.getByLabelText(/oci image archive/i), { target: { files: [new File(['x'], 'bot.tar')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bot' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/OCI_LAYOUT_INVALID/);
    expect(screen.getByRole('alert').textContent).not.toMatch(/password|stack|internal/i);
  });

  it('pages through the server-owned submission history', async () => {
    api.listSubmissions.mockResolvedValueOnce(page([row], 1, 2)).mockResolvedValueOnce(page([], 2, 2));
    render(<SubmissionForm />);
    expect(await screen.findByText(/trang 1 \/ 2/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /trang sau/i }));
    expect(await screen.findByText(/trang 2 \/ 2/i)).toBeTruthy();
    expect(api.listSubmissions).toHaveBeenLastCalledWith(2, 20);
  });
});
