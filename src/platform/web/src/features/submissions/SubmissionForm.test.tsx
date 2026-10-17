import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubmissionApiError, type TeamSubmission } from './api.ts';
import { SubmissionForm } from './SubmissionForm.tsx';

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

const row: TeamSubmission = {
  id: 'sub-1',
  status: 'PREFLIGHT',
  archiveSha256: `sha256:${'a'.repeat(64)}`,
  createdAt: '2026-10-13T00:00:00.000Z',
  preflightPosition: 2,
};

const page = (items: readonly TeamSubmission[], current = 1, totalPages = 1, preflightQueueLength = 5) => ({
  items,
  pagination: { page: current, pageSize: 20, totalItems: items.length + totalPages - 1, totalPages },
  preflightQueueLength,
});

beforeEach(() => {
  api.sha256File.mockResolvedValue(`sha256:${'a'.repeat(64)}`);
  api.reserveSubmission.mockResolvedValue({
    id: 'res-1',
    archiveSha256: `sha256:${'a'.repeat(64)}`,
    roundId: 'round-1',
    reservedAt: '2026-10-13T00:00:00.000Z',
    graceEndsAt: '2026-10-21T00:00:00.000Z',
    status: 'RESERVED',
  });
  api.uploadSubmission.mockResolvedValue(row);
  api.listSubmissions.mockResolvedValue(page([]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('team submission portal', () => {
  it('shows the current team submissions, status, and preflight position when in PREFLIGHT', async () => {
    api.listSubmissions.mockResolvedValue(page([row], 1, 1, 5));
    render(<SubmissionForm />);

    expect(await screen.findByText('Chờ kiểm tra bot')).toBeTruthy();
    expect(await screen.findByText(/Vị trí preflight: 2 \/ 5/i)).toBeTruthy();
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(row.createdAt);
    expect(api.listSubmissions).toHaveBeenCalledOnce();
  });

  it('shows loading and an explicit empty state', async () => {
    let resolveList: ((rows: ReturnType<typeof page>) => void) | undefined;
    api.listSubmissions.mockImplementation(() => new Promise((resolve) => { resolveList = resolve; }));
    render(<SubmissionForm />);

    expect(screen.getByRole('status').textContent).toMatch(/đang tải trạng thái/i);
    if (resolveList === undefined) throw new Error('submission list request was not started');
    resolveList(page([]));
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
    expect(api.reserveSubmission).not.toHaveBeenCalled();
  });

  it('one-click flow: computes hash, reserves, uploads with progress and reservation ID, then refreshes', async () => {
    api.listSubmissions.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([row]));
    const callOrder: string[] = [];

    api.sha256File.mockImplementation(async () => {
      callOrder.push('sha256');
      return `sha256:${'a'.repeat(64)}`;
    });

    api.reserveSubmission.mockImplementation(async () => {
      callOrder.push('reserve');
      return {
        id: 'res-abc',
        archiveSha256: `sha256:${'a'.repeat(64)}`,
        roundId: 'round-1',
        reservedAt: '2026-10-13T00:00:00.000Z',
        graceEndsAt: '2026-10-21T00:00:00.000Z',
        status: 'RESERVED',
      };
    });

    let finishUpload: ((submission: TeamSubmission) => void) | undefined;
    api.uploadSubmission.mockImplementation((file: File, resId: string, progress: (loaded: number, total: number) => void) => {
      callOrder.push(`upload:${resId}`);
      progress(50, 100);
      return new Promise((resolve) => { finishUpload = resolve; });
    });

    render(<SubmissionForm />);
    const file = new File(['oci archive'], 'bot.oci.tar', { type: 'application/x-tar' });
    const input = screen.getByLabelText(/oci image archive/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bot' }));

    expect(await screen.findByText(/đang tải archive: 50%/i)).toBeTruthy();
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar.getAttribute('aria-valuenow')).toBe('50');
    expect(progressbar.getAttribute('value')).toBe('50');

    // Button is disabled while busy
    expect(screen.getByRole('button', { name: /đang nộp/i }).hasAttribute('disabled')).toBe(true);

    // Verify exact ordering: sha256 -> reserve -> upload with reservationId
    expect(callOrder).toEqual(['sha256', 'reserve', 'upload:res-abc']);

    if (finishUpload === undefined) throw new Error('upload request was not started');
    finishUpload(row);

    expect(await screen.findByText(/đã nhận submission/i)).toBeTruthy();
    expect(input.value).toBe('');
    expect(await screen.findByText('Chờ kiểm tra bot')).toBeTruthy();
    expect(api.listSubmissions).toHaveBeenCalledTimes(2);
  });

  it('same-file retry reuses reservation on failure without clearing selected file', async () => {
    api.listSubmissions.mockResolvedValue(page([]));
    api.sha256File.mockResolvedValue(`sha256:${'a'.repeat(64)}`);
    api.reserveSubmission.mockResolvedValue({
      id: 'res-idempotent',
      archiveSha256: `sha256:${'a'.repeat(64)}`,
      roundId: 'round-1',
      reservedAt: '2026-10-13T00:00:00.000Z',
      graceEndsAt: '2026-10-21T00:00:00.000Z',
      status: 'RESERVED',
    });

    // First attempt fails
    api.uploadSubmission
      .mockRejectedValueOnce(new SubmissionApiError(0, null))
      .mockResolvedValueOnce(row);

    render(<SubmissionForm />);
    const file = new File(['oci archive'], 'bot.oci.tar', { type: 'application/x-tar' });
    const input = screen.getByLabelText(/oci image archive/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Click 1: fails
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bot' }));
    expect(await screen.findByText(/không kết nối được máy chủ/i)).toBeTruthy();

    // The file is still selected!
    expect(screen.getByText(/bot\.oci\.tar/)).toBeTruthy();

    // Click 2: retries with same file, re-uses reservation
    fireEvent.click(screen.getByRole('button', { name: 'Nộp bot' }));
    expect(await screen.findByText(/đã nhận submission/i)).toBeTruthy();

    expect(api.reserveSubmission).toHaveBeenCalledTimes(2);
    expect(api.uploadSubmission).toHaveBeenCalledTimes(2);
    expect(api.uploadSubmission).toHaveBeenLastCalledWith(file, 'res-idempotent', expect.any(Function), undefined, expect.any(Function));
  });

  it('prevents double submission while upload is in progress (double-click safe)', async () => {
    api.listSubmissions.mockResolvedValue(page([]));
    let finishUpload: ((submission: TeamSubmission) => void) | undefined;
    api.uploadSubmission.mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));

    render(<SubmissionForm />);
    const file = new File(['oci archive'], 'bot.oci.tar', { type: 'application/x-tar' });
    const input = screen.getByLabelText(/oci image archive/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    const submitBtn = screen.getByRole('button', { name: 'Nộp bot' });
    fireEvent.click(submitBtn);

    // Immediately click again
    fireEvent.click(submitBtn);
    fireEvent.submit(submitBtn.closest('form')!);

    await vi.waitFor(() => expect(api.uploadSubmission).toHaveBeenCalledOnce());
    finishUpload!(row);
  });

  it('maps server error codes to localized Vietnamese messages', async () => {
    api.listSubmissions.mockResolvedValue(page([]));
    const errors: [number, string, RegExp][] = [
      [409, 'SUBMISSION_NOT_OPEN', /chưa đến thời gian nộp bot/i],
      [403, 'SUBMISSION_DEADLINE_PASSED', /đã quá hạn nộp bot/i],
      [403, 'RESERVATION_REQUIRED', /cần có mã giữ chỗ hợp lệ/i],
      [403, 'RESERVATION_INVALID', /mã giữ chỗ không hợp lệ/i],
      [409, 'RESERVATION_HASH_MISMATCH', /không khớp với sha-256 đã giữ chỗ/i],
      [403, 'SUBMISSION_CLOSED', /cổng nộp bot đã đóng hoàn toàn/i],
      [429, 'UPLOAD_BUSY', /hệ thống đang bận/i],
    ];

    for (const [status, code, expectedMsg] of errors) {
      api.uploadSubmission.mockRejectedValueOnce(new SubmissionApiError(status, code));
      const { unmount } = render(<SubmissionForm />);
      const file = new File(['x'], 'bot.tar');
      fireEvent.change(screen.getByLabelText(/oci image archive/i), { target: { files: [file] } });
      fireEvent.click(screen.getByRole('button', { name: 'Nộp bot' }));

      expect((await screen.findByRole('alert')).textContent).toMatch(expectedMsg);
      unmount();
    }
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
