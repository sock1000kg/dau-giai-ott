import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResultBundleImportSection } from './ResultBundleImportSection.tsx';
import { ResultBundleKeysSection } from './ResultBundleKeysSection.tsx';

const SAMPLE_PUBLIC_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiW5e48I72jXF4p102u3z8V9g2w6qY1s3x4z5t6u7v8w=
-----END PUBLIC KEY-----`;

const SAMPLE_PRIVATE_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIP...
-----END PRIVATE KEY-----`;

const KNOWN_FINGERPRINT = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('ResultBundle Web Sections', () => {
  beforeEach(() => {
    // Stub SubtleCrypto for browser environment if needed
    if (!globalThis.crypto?.subtle) {
      const subtleMock = {
        digest: vi.fn(async (_alg: string, _data: BufferSource) => new Uint8Array(32).buffer),
      };
      vi.stubGlobal('crypto', { ...globalThis.crypto, subtle: subtleMock });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('ResultBundleKeysSection', () => {
    it('renders keys table with status and bundle counts', async () => {
      const keysList = [
        {
          keyId: 'key-active',
          fingerprint: '1111222233334444555566667777888899990000111122223333444455556666',
          algorithm: 'Ed25519',
          allowlistedAt: '2026-10-24T08:00:00Z',
          revokedAt: null,
          bundleCount: 3,
        },
        {
          keyId: 'key-revoked',
          fingerprint: 'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999',
          algorithm: 'Ed25519',
          allowlistedAt: '2026-10-20T08:00:00Z',
          revokedAt: '2026-10-22T08:00:00Z',
          bundleCount: 1,
        },
      ];

      const fetchMock = vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === '/api/v1/admin/result-bundles/keys') {
          return { ok: true, json: async () => ({ data: keysList }) } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<ResultBundleKeysSection />);
      expect(screen.getByText('Khóa công khai ResultBundle')).toBeTruthy();

      expect(await screen.findByText('key-active')).toBeTruthy();
      expect(screen.getByText('key-revoked')).toBeTruthy();

      expect(screen.getByText('Hoạt động')).toBeTruthy();
      expect(screen.getByText('Đã thu hồi')).toBeTruthy();

      // Only active key has "Thu hồi" button
      const rows = screen.getAllByRole('row');
      // header + 2 rows = 3 rows
      expect(rows).toHaveLength(3);
      const activeRow = rows[1]!;
      expect(within(activeRow).getByRole('button', { name: 'Thu hồi' })).toBeTruthy();

      const revokedRow = rows[2]!;
      expect(within(revokedRow).queryByRole('button', { name: 'Thu hồi' })).toBeNull();
    });

    it('rejects input containing "PRIVATE" on client before sending', async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) } as Response));
      vi.stubGlobal('fetch', fetchMock);

      render(<ResultBundleKeysSection />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      fetchMock.mockClear();

      const pemInput = screen.getByLabelText(/Khóa công khai Ed25519/i);
      fireEvent.change(pemInput, { target: { value: SAMPLE_PRIVATE_PEM } });

      // Live preview displays private key error immediately
      expect(await screen.findByText(/Khóa riêng \(PRIVATE KEY\) không được phép/i)).toBeTruthy();

      // Attempt submit
      fireEvent.change(screen.getByLabelText(/Mã nhận diện khóa/i), { target: { value: 'forbidden-key' } });
      fireEvent.change(screen.getByLabelText(/Nhập lại vân tay xác nhận/i), { target: { value: 'abc' } });
      fireEvent.change(screen.getByLabelText(/Lý do đăng ký/i), { target: { value: 'test reason' } });

      fireEvent.click(screen.getByRole('button', { name: 'Đăng ký khóa' }));

      // Fetch was NEVER called with POST
      const postCalls = fetchMock.mock.calls.filter((call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'POST');
      expect(postCalls).toHaveLength(0);
    });

    it('handles FINGERPRINT_MISMATCH error from server with clear Vietnamese text', async () => {
      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/admin/result-bundles/keys' && init?.method === 'POST') {
          return {
            ok: false,
            status: 422,
            json: async () => ({ error: { code: 'FINGERPRINT_MISMATCH' } }),
          } as Response;
        }
        if (url === '/api/v1/admin/result-bundles/keys') {
          return { ok: true, json: async () => ({ data: [] }) } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<ResultBundleKeysSection />);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      fireEvent.change(screen.getByLabelText(/Mã nhận diện khóa/i), { target: { value: 'key-test' } });
      fireEvent.change(screen.getByLabelText(/Khóa công khai Ed25519/i), { target: { value: SAMPLE_PUBLIC_PEM } });
      fireEvent.change(screen.getByLabelText(/Nhập lại vân tay xác nhận/i), { target: { value: 'wrong-fingerprint' } });
      fireEvent.change(screen.getByLabelText(/Lý do đăng ký/i), { target: { value: 'Setup key' } });

      fireEvent.click(screen.getByRole('button', { name: 'Đăng ký khóa' }));

      expect(await screen.findByText(/Mã vân tay xác nhận không khớp với vân tay tính từ khóa công khai/i)).toBeTruthy();
    });

    it('revokes an active key with confirmation dialog and reason', async () => {
      const initialKeys = [
        {
          keyId: 'key-to-revoke',
          fingerprint: '1111',
          algorithm: 'Ed25519',
          allowlistedAt: '2026-10-24T08:00:00Z',
          revokedAt: null,
          bundleCount: 0,
        },
      ];

      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/v1/admin/result-bundles/keys/key-to-revoke/revoke' && init?.method === 'POST') {
          return { ok: true, json: async () => ({ data: { keyId: 'key-to-revoke', revokedAt: '2026-10-24T09:00:00Z' } }) } as Response;
        }
        if (url === '/api/v1/admin/result-bundles/keys') {
          return { ok: true, json: async () => ({ data: initialKeys }) } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<ResultBundleKeysSection />);
      await screen.findByText('key-to-revoke');

      // Click "Thu hồi"
      fireEvent.click(screen.getByRole('button', { name: 'Thu hồi' }));

      // Confirm dialog appears
      const confirmGroup = screen.getByRole('group', { name: /Xác nhận thu hồi khóa/i });
      expect(confirmGroup).toBeTruthy();

      // Enter reason and confirm
      fireEvent.change(within(confirmGroup).getByLabelText(/Lý do thu hồi/i), {
        target: { value: 'Khóa bị hỏng thiết bị' },
      });
      fireEvent.click(within(confirmGroup).getByRole('button', { name: 'Xác nhận thu hồi khóa' }));

      expect(await screen.findByText(/Đã thu hồi khóa key-to-revoke/i)).toBeTruthy();
    });
  });

  describe('ResultBundleImportSection', () => {
    it('refuses file larger than 257 MB immediately without reading', async () => {
      render(<ResultBundleImportSection />);
      const fileInput = document.getElementById('bundle-file-input') as HTMLInputElement;

      const oversizedFile = new File(['x'.repeat(100)], 'huge.json', { type: 'application/json' });
      Object.defineProperty(oversizedFile, 'size', { value: 258 * 1024 * 1024 });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [oversizedFile] } });
      });

      expect(await screen.findByText(/Kích thước tệp vượt quá giới hạn tối đa cho phép của hệ thống \(257 MB\)/i)).toBeTruthy();
    });

    it('shows size warning when file is larger than 20 MB', async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            bundleId: 'bundle-big-01',
            bundleVersion: 1,
            keyId: 'k1',
            fingerprint: KNOWN_FINGERPRINT,
            artifacts: 20,
            valid: true,
          },
        }),
      } as Response));
      vi.stubGlobal('fetch', fetchMock);

      render(<ResultBundleImportSection />);
      const fileInput = document.getElementById('bundle-file-input') as HTMLInputElement;

      const bigFile = new File([JSON.stringify({ manifest: {}, signature: 's', artifacts: [] })], 'big.json', {
        type: 'application/json',
      });
      Object.defineProperty(bigFile, 'size', { value: 25 * 1024 * 1024 });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [bigFile] } });
      });

      expect(await screen.findByText(/Cảnh báo: Tệp có kích thước lớn \(25\.0 MB\)/i)).toBeTruthy();
    });

    it('runs dry-run on file select, previews metadata, and publishes on click', async () => {
      let isDryRun = false;
      const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/v1/admin/result-bundles?dryRun=true')) {
          isDryRun = true;
          return {
            ok: true,
            json: async () => ({
              data: {
                bundleId: 'bundle-test-2026',
                bundleVersion: 1,
                keyId: 'finals-key-1',
                fingerprint: KNOWN_FINGERPRINT,
                artifacts: 18,
                valid: true,
              },
            }),
          } as Response;
        }
        if (url === '/api/v1/admin/result-bundles' && init?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({
              data: {
                bundleId: 'bundle-test-2026',
                bundleVersion: 1,
                keyId: 'finals-key-1',
                manifestSha256: '999988887777',
                importedAt: '2026-10-24T08:30:00Z',
                status: 'VERIFIED',
                replayed: false,
              },
            }),
          } as Response;
        }
        return { ok: false, status: 404 } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      render(<ResultBundleImportSection />);
      const fileInput = document.getElementById('bundle-file-input') as HTMLInputElement;

      const validBundleJson = JSON.stringify({
        manifest: { bundleId: 'bundle-test-2026', bundleVersion: 1, keyId: 'finals-key-1' },
        signature: 'valid-sig',
        artifacts: [{ path: 'bracket.json', payloadBase64: 'e30=' }],
      });
      const validFile = new File([validBundleJson], 'bundle.json', { type: 'application/json' });

      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [validFile] } });
      });

      // Dry-run preview displays
      expect(await screen.findByText('bundle-test-2026')).toBeTruthy();
      expect(screen.getByText('v1')).toBeTruthy();
      expect(screen.getByText('finals-key-1')).toBeTruthy();
      expect(screen.getByText('18 tệp')).toBeTruthy();
      expect(screen.getByText('SẴN SÀNG CÔNG BỐ')).toBeTruthy();

      // Big publish button is enabled
      const publishBtn = screen.getByRole('button', { name: 'Công bố ResultBundle' });
      expect(publishBtn).toBeTruthy();
      expect(publishBtn.hasAttribute('disabled')).toBe(false);

      // Click publish
      await act(async () => {
        fireEvent.click(publishBtn);
      });

      // Verified banner appears
      expect(await screen.findByText(/Công bố ResultBundle thành công!/i)).toBeTruthy();
      expect(screen.getByText('VERIFIED')).toBeTruthy();
      expect(screen.getByText('999988887777')).toBeTruthy();
    });

    it('shows exact Vietnamese reasons when dry-run rejects bundle', async () => {
      const errorCases = [
        { code: 'RESULT_BUNDLE_SIGNATURE_INVALID', expected: /Chữ ký Ed25519 không hợp lệ/i },
        { code: 'RESULT_BUNDLE_KEY_UNKNOWN', expected: /Khóa ký không nằm trong danh sách được phép hoặc đã bị thu hồi/i },
        { code: 'RESULT_BUNDLE_ARTIFACT_TAMPERED', expected: /Dữ liệu tệp đính kèm không khớp với mã hash SHA-256/i },
        { code: 'RESULT_BUNDLE_ARTIFACT_MISSING', expected: /Thiếu tệp đính kèm đã được khai báo/i },
        { code: 'RESULT_BUNDLE_ARTIFACT_UNLISTED', expected: /Gói bundle chứa tệp không có trong danh mục/i },
        { code: 'RESULT_BUNDLE_ARTIFACT_INVALID', expected: /Dữ liệu tệp đính kèm không đúng schema hoặc vi phạm cấu trúc giải đấu/i },
        { code: 'RESULT_BUNDLE_VERSION_CONFLICT', expected: /Phiên bản bundle này đã tồn tại với nội dung khác/i },
      ];

      for (const { code, expected } of errorCases) {
        const fetchMock = vi.fn(async () => ({
          ok: false,
          status: 422,
          json: async () => ({ error: { code } }),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);

        const { unmount } = render(<ResultBundleImportSection />);
        const fileInput = document.getElementById('bundle-file-input') as HTMLInputElement;

        const file = new File(['{}'], 'test.json', { type: 'application/json' });
        await act(async () => {
          fireEvent.change(fileInput, { target: { files: [file] } });
        });

        expect(await screen.findByText(expected)).toBeTruthy();
        // Publish button should NOT exist
        expect(screen.queryByRole('button', { name: 'Công bố ResultBundle' })).toBeNull();
        unmount();
      }
    });
  });
});
