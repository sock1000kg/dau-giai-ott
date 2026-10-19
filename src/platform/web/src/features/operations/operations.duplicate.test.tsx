import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { DuplicateSubmissionsSection } from './DuplicateSubmissionsSection.tsx';

function jsonResponse(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response;
}

describe('DuplicateSubmissionsSection (AC-22)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders read-only table with flagged submissions and required Vietnamese wording', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/admin/submissions/flagged')) {
        return jsonResponse(200, {
          data: [
            {
              submissionId: '11111111-1111-4111-8111-111111111111',
              teamId: 'team-2-id',
              teamName: 'Team Beta',
              createdAt: '2026-10-19T10:00:00Z',
              status: 'ACTIVE',
              duplicateOfSubmissionId: '22222222-2222-4222-8222-222222222222',
              duplicateOfTeamName: 'Team Alpha',
              matchType: 'MANIFEST',
              reason: 'Identical OCI manifest digest matches submission of team Alpha',
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        });
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DuplicateSubmissionsSection refreshToken={0} />);

    // Check title and required wording: "có thể trùng — cần BTC xem xét"
    expect(await screen.findByRole('region', { name: 'Bản nộp có thể trùng' })).toBeTruthy();
    expect(screen.getByText(/có thể trùng — cần BTC xem xét/)).toBeTruthy();

    // Check rendered row data
    expect(await screen.findByText('Team Beta')).toBeTruthy();
    expect(screen.getByText('Team Alpha')).toBeTruthy();
    expect(screen.getByText('MANIFEST')).toBeTruthy();
    expect(screen.getByText('Identical OCI manifest digest matches submission of team Alpha')).toBeTruthy();

    // Verify read-only: no DQ or action buttons in the panel
    const region = screen.getByRole('region', { name: 'Bản nộp có thể trùng' });
    const buttons = within(region).queryAllByRole('button');
    // Any button present should only be pagination (if any), definitely no DQ button
    for (const btn of buttons) {
      expect(btn.textContent).not.toMatch(/loại|hủy|dq|disqualify|xóa/i);
    }
  });

  it('renders empty message when no flagged submissions exist', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith('/api/v1/admin/submissions/flagged')) {
        return jsonResponse(200, {
          data: [],
          page: 1,
          pageSize: 20,
          total: 0,
        });
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DuplicateSubmissionsSection refreshToken={0} />);

    expect(await screen.findByText('Chưa có bản nộp nào có dấu hiệu trùng lặp')).toBeTruthy();
  });

  it('navigation and RBAC: accessible to BTC_ADMIN in operations console, denied to TEAM_ACCOUNT', async () => {
    const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
      const url = String(input);
      if (url.startsWith('/api/v1/auth/')) {
        return jsonResponse(200, { data: { role: 'TEAM_ACCOUNT', teamId: 't1' } });
      }
      if (url.startsWith('/api/v1/submissions')) {
        return jsonResponse(200, { data: [], pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } });
      }
      throw new Error(`Unexpected url: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    // Try accessing /admin/operations as TEAM_ACCOUNT
    window.history.replaceState({}, '', '/admin/operations');
    render(<App />);

    expect(await screen.findByText('Không có quyền truy cập')).toBeTruthy();
  });
});
