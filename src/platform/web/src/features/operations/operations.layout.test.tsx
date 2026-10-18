import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alpha, audit, cases, doneMatchId, failedMatchId, gets, openConsole, posts, priv, response, submissionId } from './operations.testkit.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

const caseId = '00000000-0000-4000-8000-0000000000aa';
const summary = { id: caseId, kind: 'ANOMALY', status: 'OPEN', teamId: null, matchId: failedMatchId, submissionId: null, openedAt: '2026-10-18T00:00:00Z', decidedAt: null };
const REASON = /Lý do \(bắt buộc, tối đa 500/;

describe('page structure and a11y', () => {
  it('renders four named cards, each with a description', async () => {
    await openConsole();
    for (const name of ['Thao tác đặc quyền', 'Hồ sơ vụ việc', 'Nhật ký audit', 'Can thiệp hàng đợi (công khai)']) {
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

describe('cases', () => {
  it('shows the bordered table with an empty state', async () => {
    await openConsole();
    expect(await cases().findByText('Chưa có hồ sơ nào')).toBeTruthy();
    expect(cases().getByRole('table', { name: 'Danh sách hồ sơ' }).className).toBe('ui-table');
    expect(cases().getByRole('table').closest('.ui-table-scroll')).toBeTruthy();
  });

  it('resolves subjects and sends kind/status filters', async () => {
    const api = await openConsole({ cases: () => response(200, { data: { items: [summary] }, pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 } }) });
    expect((await cases().findByText(/Trận ROUND_1 · Game 2/)).textContent).toContain('Trận');
    fireEvent.change(cases().getByLabelText('Lọc theo loại'), { target: { value: 'APPEAL' } });
    await waitFor(() => expect(gets(api.calls, '/api/v1/admin/operations/cases').some(({ url }) => url.includes('kind=APPEAL'))).toBe(true));
    fireEvent.change(cases().getByLabelText('Lọc theo trạng thái'), { target: { value: 'DECIDED' } });
    await waitFor(() => expect(gets(api.calls, '/api/v1/admin/operations/cases').some(({ url }) => url.includes('kind=APPEAL') && url.includes('status=DECIDED'))).toBe(true));
  });

  it.each([
    ['APPEAL', 'Chọn đội', alpha.id, 'teamId'],
    ['ANOMALY', 'Chọn trận', doneMatchId, 'matchId'],
    ['DUPLICATE', 'Mã submission (UUID)', submissionId, 'submissionId'],
  ])('opens a %s case from the picker with the right body', async (kind, label, id, field) => {
    const api = await openConsole();
    fireEvent.change(cases().getByLabelText('Loại hồ sơ'), { target: { value: kind } });
    if (label === 'Mã submission (UUID)') fireEvent.change(cases().getByLabelText(label), { target: { value: id } });
    else {
      await waitFor(() => expect(cases().getByLabelText(label).querySelectorAll('option').length).toBeGreaterThan(2 - (kind === 'APPEAL' ? 0 : 1)));
      fireEvent.change(cases().getByLabelText(label), { target: { value: id } });
    }
    fireEvent.change(cases().getByLabelText('Bằng chứng ban đầu'), { target: { value: 'ev' } });
    fireEvent.change(cases().getByLabelText('Lý do mở hồ sơ'), { target: { value: 'why' } });
    fireEvent.click(cases().getByRole('button', { name: 'Mở hồ sơ' }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(posts(api.calls)[0]!.url).toBe('/api/v1/admin/operations/cases');
    expect(JSON.parse(String(posts(api.calls)[0]!.init!.body))).toEqual({ kind, reason: 'why', [field]: id, evidence: { summary: 'ev' } });
  });

  it('orders the timeline by seq and disables only the busy control', async () => {
    let release: (value: Response) => void = () => undefined;
    const api = await openConsole({
      cases: () => response(200, { data: { items: [summary] } }),
      caseDetail: { ...summary, events: [
        { seq: 2, eventType: 'EVIDENCE_ADDED', reason: 'second', decision: null, createdAt: '2026-10-18T02:00:00Z' },
        { seq: 1, eventType: 'OPENED', reason: 'first', decision: null, createdAt: '2026-10-18T01:00:00Z' },
      ] },
      post: () => new Promise<Response>((resolve) => { release = resolve; }),
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Xem 00000000/ }));
    const detail = within(await screen.findByRole('article', { name: 'Chi tiết hồ sơ' }));
    const items = detail.getAllByRole('listitem').map((node) => node.textContent ?? '');
    expect(items[0]).toContain('1. OPENED — first');
    expect(items[1]).toContain('2. EVIDENCE_ADDED — second');

    fireEvent.change(detail.getByLabelText('Lý do (bắt buộc)'), { target: { value: 'why' } });
    fireEvent.change(detail.getByLabelText('Bằng chứng (tóm tắt)'), { target: { value: 'ev' } });
    fireEvent.click(detail.getByRole('button', { name: 'Thêm bằng chứng' }));
    await waitFor(() => expect(detail.getByRole('button', { name: 'Thêm bằng chứng' }).hasAttribute('disabled')).toBe(true));
    expect(detail.getByRole('button', { name: 'Đổi trạng thái' }).hasAttribute('disabled')).toBe(false);
    expect(detail.getByRole('button', { name: 'Ghi quyết định' }).hasAttribute('disabled')).toBe(false);
    expect(posts(api.calls)).toHaveLength(1);
    await act(async () => { release(response(200, { data: {} })); });
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

