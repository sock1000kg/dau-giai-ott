import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alpha, audit, failedMatchId, gets, openConsole, posts, priv, response } from './operations.testkit.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

const REASON = /Lý do \(bắt buộc, tối đa 500/;

describe('page structure and a11y', () => {
  it('renders four named cards, each with a description', async () => {
    await openConsole();
    for (const name of ['Thao tác đặc quyền', 'Nhật ký audit', 'Can thiệp hàng đợi (công khai)', 'Bản nộp có thể trùng']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(document.querySelectorAll('.ui-card').length).toBe(4);
  });

  it('gives every control a visible label and keeps counters live', async () => {
    await openConsole();
    for (const label of ['Thao tác', 'Chọn đội', 'Lọc đội theo tên', 'Mã đội (UUID)', REASON]) expect(priv().getByLabelText(label)).toBeTruthy();
    const reason = priv().getByLabelText(REASON);
    expect(reason.className).toContain('ui-textarea');
    expect(reason.getAttribute('maxlength')).toBe('500');
    expect(priv().getByText(/0\/500/)).toBeTruthy();
    fireEvent.change(reason, { target: { value: 'abcde' } });
    expect(priv().getByText(/5\/500/)).toBeTruthy();
    expect(reason.getAttribute('aria-describedby')).toBeTruthy();
    fireEvent.change(priv().getByLabelText('Thao tác'), { target: { value: 'cancel' } });
    fireEvent.change(priv().getByLabelText(/Lý do công khai/), { target: { value: 'ab' } });
    expect(priv().getByText(/2\/200/)).toBeTruthy();
  });

  it('moves focus into the confirm group and returns it to the review button on cancel', async () => {
    await openConsole();
    fireEvent.change(priv().getByLabelText('Mã đội (UUID)'), { target: { value: alpha.id } });
    fireEvent.change(priv().getByLabelText(REASON), { target: { value: 'r' } });
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    const group = await priv().findByRole('group', { name: 'Xác nhận thao tác' });
    await waitFor(() => expect(document.activeElement).toBe(within(group).getByRole('heading')));
    fireEvent.click(within(group).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(document.activeElement).toBe(priv().getByRole('button', { name: 'Xem lại thao tác' })));
  });
});

describe('audit and queue overrides', () => {
  it('shows an empty state for both tables', async () => {
    await openConsole();
    expect(await audit().findByText('Chưa có sự kiện audit nào')).toBeTruthy();
    expect(await screen.findByText('Chưa có can thiệp nào')).toBeTruthy();
  });

  it('builds the query string from the filters and validates them', async () => {
    const api = await openConsole();
    fireEvent.change(audit().getByLabelText('Hành động'), { target: { value: 'TEAM_SUSPENDED' } });
    fireEvent.change(audit().getByLabelText('Loại đối tượng'), { target: { value: 'TEAM' } });
    fireEvent.change(audit().getByLabelText('Mã đối tượng'), { target: { value: 'nope' } });
    fireEvent.click(audit().getByRole('button', { name: 'Lọc' }));
    expect(await audit().findByText('Mã đối tượng phải là UUID.')).toBeTruthy();
    fireEvent.change(audit().getByLabelText('Mã đối tượng'), { target: { value: alpha.id } });
    fireEvent.click(audit().getByRole('button', { name: 'Lọc' }));
    await waitFor(() => expect(gets(api.calls, '/api/v1/admin/operations/audit').map(({ url }) => url)).toContain(`/api/v1/admin/operations/audit?action=TEAM_SUSPENDED&targetType=TEAM&targetId=${alpha.id}`));
  });

  it('supports a free-text action and paginates', async () => {
    const api = await openConsole({ audit: () => response(200, { data: { items: [] }, pagination: { page: 1, pageSize: 50, totalItems: 120, totalPages: 3 } }) });
    fireEvent.change(audit().getByLabelText('Hành động'), { target: { value: '__custom' } });
    fireEvent.change(audit().getByLabelText('Hành động (nhập tay)'), { target: { value: 'custom_thing' } });
    fireEvent.click(audit().getByRole('button', { name: 'Lọc' }));
    await waitFor(() => expect(gets(api.calls, '/api/v1/admin/operations/audit').map(({ url }) => url)).toContain('/api/v1/admin/operations/audit?action=CUSTOM_THING'));
    fireEvent.click(await audit().findByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(gets(api.calls, '/api/v1/admin/operations/audit').map(({ url }) => url)).toContain('/api/v1/admin/operations/audit?action=CUSTOM_THING&page=2'));
  });

  it('shows an error state', async () => {
    await openConsole({ audit: () => response(500, { error: { code: 'INTERNAL_ERROR' } }) });
    expect((await audit().findByRole('alert')).textContent).toMatch(/Không thể hoàn tất/);
  });
});

