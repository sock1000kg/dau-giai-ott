import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReferenceBotApiError, listReferenceBots, setReferenceBotEnabled, uploadReferenceBot, type ReferenceBot } from './api.ts';
import { ReferenceBotsPage } from './ReferenceBotsPage.tsx';

vi.mock('./api.ts', () => ({
  ReferenceBotApiError: class extends Error {
    readonly status: number;
    readonly code: string | null;
    constructor(status: number, code: string | null) { super('request failed'); this.status = status; this.code = code; }
  },
  listReferenceBots: vi.fn(),
  setReferenceBotEnabled: vi.fn(),
  uploadReferenceBot: vi.fn(),
}));

const bot: ReferenceBot = {
  id: 'bot-1', displayName: 'BTC first legal', archiveSha256: `sha256:${'a'.repeat(64)}`,
  manifestDigest: `sha256:${'b'.repeat(64)}`, configDigest: `sha256:${'c'.repeat(64)}`,
  policyVersion: 'P2_BASELINE_V1', enabled: false, createdAt: '2026-10-24T10:00:00.000Z',
  enabledAt: null, disabledAt: null,
};

describe('ReferenceBotsPage', () => {
  beforeEach(() => {
    vi.mocked(listReferenceBots).mockReset();
    vi.mocked(uploadReferenceBot).mockReset();
    vi.mocked(setReferenceBotEnabled).mockReset();
  });

  it('shows active and inactive catalog versions with checksum metadata', async () => {
    vi.mocked(listReferenceBots).mockResolvedValue([bot, { ...bot, id: 'bot-2', displayName: 'BTC capture', enabled: true, enabledAt: '2026-10-24T11:00:00.000Z' }]);
    render(<ReferenceBotsPage />);

    expect(await screen.findByText('BTC first legal')).toBeTruthy();
    expect(screen.getByText('Chưa kích hoạt')).toBeTruthy();
    expect(screen.getByText('Đang hoạt động')).toBeTruthy();
    expect(screen.getAllByText(`sha256:${'a'.repeat(64)}`)).toHaveLength(2);
  });

  it('uploads a selected OCI archive and refreshes the catalog', async () => {
    vi.mocked(listReferenceBots).mockResolvedValueOnce([]).mockResolvedValueOnce([bot]);
    vi.mocked(uploadReferenceBot).mockResolvedValue({ data: bot, replayed: false });
    render(<ReferenceBotsPage />);

    await screen.findByText('Chưa có bot tham chiếu nào.');
    fireEvent.change(screen.getByLabelText('Tên bot'), { target: { value: 'BTC first legal' } });
    fireEvent.change(screen.getByLabelText('Lý do tải lên'), { target: { value: 'Cung cấp cho đội luyện tập' } });
    const file = new File(['oci bytes'], 'reference.oci.tar', { type: 'application/x-tar' });
    fireEvent.change(screen.getByLabelText('OCI image archive (.tar)'), { target: { files: [file] } });
    fireEvent.submit(screen.getByLabelText('OCI image archive (.tar)').closest('form')!);

    await screen.findByText('BTC first legal');
    expect(uploadReferenceBot).toHaveBeenCalledWith(expect.objectContaining({ file, displayName: 'BTC first legal', reason: 'Cung cấp cho đội luyện tập' }));
    expect(screen.getByText('Chưa kích hoạt')).toBeTruthy();
  });

  it('requires a reason before activating a bot and updates status after confirmation', async () => {
    vi.mocked(listReferenceBots).mockResolvedValueOnce([bot]).mockResolvedValueOnce([{ ...bot, enabled: true, enabledAt: '2026-10-24T11:00:00.000Z' }]);
    vi.mocked(setReferenceBotEnabled).mockResolvedValue({ data: { ...bot, enabled: true, enabledAt: '2026-10-24T11:00:00.000Z' }, replayed: false });
    render(<ReferenceBotsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Kích hoạt' }));
    const confirm = screen.getByRole('button', { name: 'Xác nhận kích hoạt' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Lý do thay đổi'), { target: { value: 'Đã kiểm tra OCI' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(setReferenceBotEnabled).toHaveBeenCalledWith('bot-1', true, 'Đã kiểm tra OCI', expect.any(String)));
    expect(await screen.findByText('Đang hoạt động')).toBeTruthy();
  });

  it('explains a duplicate archive conflict without losing the catalog', async () => {
    vi.mocked(listReferenceBots).mockResolvedValue([bot]);
    vi.mocked(uploadReferenceBot).mockRejectedValue(new ReferenceBotApiError(409, 'REFERENCE_BOT_ARCHIVE_EXISTS'));
    render(<ReferenceBotsPage />);

    expect(await screen.findByText('BTC first legal')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Tên bot'), { target: { value: 'Copy' } });
    fireEvent.change(screen.getByLabelText('Lý do tải lên'), { target: { value: 'Test duplicate' } });
    fireEvent.change(screen.getByLabelText('OCI image archive (.tar)'), { target: { files: [new File(['oci'], 'duplicate.oci.tar')] } });
    fireEvent.submit(screen.getByLabelText('OCI image archive (.tar)').closest('form')!);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/archive này đã có trong danh sách/i)).toBeTruthy();
  });
});
