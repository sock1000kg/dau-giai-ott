import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cases, failedMatchId, openConsole, response } from './operations.testkit.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

const caseId = '00000000-0000-4000-8000-0000000000aa';
const summary = { id: caseId, kind: 'ANOMALY', status: 'OPEN', teamId: null, matchId: failedMatchId, submissionId: null, openedAt: '2026-10-18T00:00:00Z', decidedAt: null };

describe('case kinds in Vietnamese', () => {
  it('labels the kind selector options in Vietnamese while values stay the enum', async () => {
    await openConsole();
    const select = cases().getByLabelText('Loại hồ sơ') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => [option.value, option.textContent])).toEqual([
      ['ANOMALY', 'Bất thường'], ['DUPLICATE', 'Nghi trùng bot'], ['APPEAL', 'Khiếu nại'],
    ]);
  });

  it('explains each kind under the selector and updates when it changes', async () => {
    await openConsole();
    const select = cases().getByLabelText('Loại hồ sơ');
    const help = () => document.getElementById(select.getAttribute('aria-describedby') as string)?.textContent;
    expect(help()).toBe('BTC ghi nhận trận hoặc hành vi cần xem xét.');
    fireEvent.change(select, { target: { value: 'APPEAL' } });
    expect(help()).toBe('Đội gửi khiếu nại kết quả hoặc xử lý.');
    fireEvent.change(select, { target: { value: 'DUPLICATE' } });
    expect(help()).toBe('BTC ghi nhận khi nghi ngờ một bot nộp trùng hoặc sao chép bot khác.');
  });

  it('shows the Vietnamese name in the Loại column and detail heading, keeping the enum in title', async () => {
    await openConsole({ cases: () => response(200, { data: { items: [summary] }, pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }) });
    const table = await cases().findByRole('table', { name: 'Danh sách hồ sơ' });
    const badge = await within(table).findByText('Bất thường');
    expect(badge.closest('[title="ANOMALY"]')).not.toBeNull();
    expect(within(table).queryByText('ANOMALY')).toBeNull();
    const filter = cases().getByLabelText('Lọc theo loại') as HTMLSelectElement;
    expect(Array.from(filter.options).map((option) => option.textContent)).toEqual(['Tất cả loại', 'Bất thường', 'Nghi trùng bot', 'Khiếu nại']);
    await waitFor(() => expect(filter.value).toBe(''));
  });
});
