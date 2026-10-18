import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alpha, beta, failedMatchId, gets, openConsole, posts, priv, response, submissionId } from './operations.testkit.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

const REASON = /Lý do \(bắt buộc, tối đa 500/;

function setAction(kind: string) {
  fireEvent.change(priv().getByLabelText('Thao tác'), { target: { value: kind } });
}

async function review() {
  fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
  return priv().findByRole('button', { name: 'Xác nhận thực hiện' });
}

describe('privileged action pickers', () => {
  it('loads the team list once and filters it by typed text', async () => {
    const api = await openConsole();
    const select = (await priv().findByLabelText('Chọn đội')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    fireEvent.change(priv().getByLabelText('Lọc đội theo tên'), { target: { value: 'beta' } });
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual(['— Chọn đội —', `Beta Team (${beta.id.slice(0, 8)})`]);
    setAction('unsuspend');
    expect(gets(api.calls, '/api/v1/admin/teams')).toHaveLength(1);
  });

  it('shows name and short id in the confirmation and submits the selected id', async () => {
    const api = await openConsole();
    await waitFor(() => expect((priv().getByLabelText('Chọn đội') as HTMLSelectElement).options.length).toBe(3));
    fireEvent.change(priv().getByLabelText('Chọn đội'), { target: { value: beta.id } });
    fireEvent.change(priv().getByLabelText(REASON), { target: { value: 'gian lận' } });
    fireEvent.click(await review());
    const group = priv().getByRole('group', { name: 'Xác nhận thao tác' });
    expect(group.textContent).toContain('Beta Team');
    expect(group.textContent).toContain(beta.id.slice(0, 8));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(posts(api.calls)[0]!.url).toBe(`/api/v1/admin/operations/teams/${beta.id}/suspend`);
    expect(JSON.parse(String(posts(api.calls)[0]!.init!.body))).toEqual({ reason: 'gian lận' });
  });

  it.each([
    ['suspend', 'team', `/teams/${alpha.id}/suspend`, { reason: 'r' }],
    ['unsuspend', 'team', `/teams/${alpha.id}/unsuspend`, { reason: 'r' }],
    ['revoke', 'manual', `/submissions/${submissionId}/revoke`, { reason: 'r' }],
    ['cancel', 'match', `/matches/${failedMatchId}/cancel`, { reason: 'r', publicReason: 'p' }],
    ['rerun', 'match', `/matches/${failedMatchId}/rerun`, { reason: 'r', publicReason: 'p', verifiedInfraFailure: true }],
  ])('%s sends the selected id (%s)', async (kind, source, path, body) => {
    const api = await openConsole();
    setAction(kind);
    if (source === 'team') {
      await waitFor(() => expect((priv().getByLabelText('Chọn đội') as HTMLSelectElement).options.length).toBe(3));
      fireEvent.change(priv().getByLabelText('Chọn đội'), { target: { value: alpha.id } });
    } else if (source === 'match') {
      await waitFor(() => expect((priv().getByLabelText('Chọn trận') as HTMLSelectElement).options.length).toBe(2));
      fireEvent.change(priv().getByLabelText('Chọn trận'), { target: { value: failedMatchId } });
    } else {
      fireEvent.change(priv().getByLabelText('Mã submission (UUID)'), { target: { value: submissionId } });
    }
    fireEvent.change(priv().getByLabelText(REASON), { target: { value: 'r' } });
    if (kind === 'cancel' || kind === 'rerun') fireEvent.change(priv().getByLabelText(/Lý do công khai/), { target: { value: 'p' } });
    if (kind === 'rerun') fireEvent.click(priv().getByLabelText(/xác nhận đây là lỗi hạ tầng/i));
    fireEvent.click(await review());
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(posts(api.calls)[0]!.url).toBe(`/api/v1/admin/operations${path}`);
    expect(JSON.parse(String(posts(api.calls)[0]!.init!.body))).toEqual(body);
  });

  it('shows an alert with retry when the team list fails and the manual UUID still works', async () => {
    let fail = true;
    const api = await openConsole({ teams: () => (fail ? response(500, { error: { code: 'INTERNAL_ERROR' } }) : response(200, { data: [alpha] })) });
    expect((await priv().findByText(/Không tải được danh sách đội/)).closest('[role="alert"]')).toBeTruthy();
    fireEvent.change(priv().getByLabelText('Mã đội (UUID)'), { target: { value: alpha.id } });
    fireEvent.change(priv().getByLabelText(REASON), { target: { value: 'r' } });
    fireEvent.click(await review());
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(posts(api.calls)[0]!.url).toBe(`/api/v1/admin/operations/teams/${alpha.id}/suspend`);

    fail = false;
    fireEvent.click(priv().getByRole('button', { name: 'Thử lại tải danh sách đội' }));
    await waitFor(() => expect((priv().getByLabelText('Chọn đội') as HTMLSelectElement).options.length).toBe(2));
    expect(gets(api.calls, '/api/v1/admin/teams')).toHaveLength(2);
  });

  it('rejects a non-UUID manual id with a field error and never reaches the confirm step', async () => {
    const api = await openConsole();
    fireEvent.change(priv().getByLabelText('Mã đội (UUID)'), { target: { value: 'not-a-uuid' } });
    fireEvent.change(priv().getByLabelText(REASON), { target: { value: 'r' } });
    expect(priv().getByText('Mã không đúng định dạng UUID.')).toBeTruthy();
    expect(priv().getByLabelText('Mã đội (UUID)').getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    expect(await priv().findByRole('alert')).toBeTruthy();
    expect(priv().queryByRole('button', { name: 'Xác nhận thực hiện' })).toBeNull();
    expect(posts(api.calls)).toHaveLength(0);
  });
});

describe('match picker', () => {
  it('sends the team and stage filters and offers only FAILED matches (the list route omits SCHEDULED)', async () => {
    const api = await openConsole();
    setAction('rerun');
    const select = (await priv().findByLabelText('Chọn trận')) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2));
    expect(select.options[1]!.textContent).toBe(`ROUND_1 · Game 2 · Alpha Team vs Beta Team · FAILED (${failedMatchId.slice(0, 8)})`);

    fireEvent.change(priv().getByLabelText('Lọc trận theo giai đoạn'), { target: { value: 'ROUND_1' } });
    await waitFor(() => expect(gets(api.calls, '/api/v1/results/matches').some(({ url }) => url.includes('stage=ROUND_1'))).toBe(true));
    fireEvent.change(priv().getByLabelText('Lọc trận theo đội'), { target: { value: beta.id } });
    await waitFor(() => expect(gets(api.calls, '/api/v1/results/matches').some(({ url }) => url.includes('stage=ROUND_1') && url.includes(`teamId=${beta.id}`))).toBe(true));
    expect(priv().getByText(/trận SCHEDULED chưa có trong API danh sách/)).toBeTruthy();
  });

  it('builds the request from the picked match id (rerun reaches the picker path, not only the manual one)', async () => {
    const api = await openConsole();
    setAction('rerun');
    await waitFor(() => expect((priv().getByLabelText('Chọn trận') as HTMLSelectElement).options.length).toBe(2));
    fireEvent.change(priv().getByLabelText('Chọn trận'), { target: { value: failedMatchId } });
    expect((priv().getByLabelText('Mã trận (UUID)') as HTMLInputElement).value).toBe(failedMatchId);
    fireEvent.change(priv().getByLabelText(REASON), { target: { value: 'r' } });
    fireEvent.change(priv().getByLabelText(/Lý do công khai/), { target: { value: 'p' } });
    fireEvent.click(priv().getByLabelText(/xác nhận đây là lỗi hạ tầng/i));
    fireEvent.click(await review());
    expect(priv().getByRole('group', { name: 'Xác nhận thao tác' }).textContent).toContain('Alpha Team vs Beta Team');
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
  });
});

describe('confirm step', () => {
  it('ignores a second click that lands before React re-renders (in-flight guard)', async () => {
    let release: (value: Response) => void = () => undefined;
    const api = await openConsole({ post: () => new Promise<Response>((resolve) => { release = resolve; }) });
    fireEvent.change(priv().getByLabelText('Mã đội (UUID)'), { target: { value: alpha.id } });
    fireEvent.change(priv().getByLabelText(REASON), { target: { value: 'r' } });
    const confirm = await review();
    act(() => { confirm.click(); confirm.click(); });
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    release(response(200, { data: {} }));
    expect(await screen.findByText(/Đã thực hiện/)).toBeTruthy();
  });

  it('requires the infra checkbox and the public reason for rerun, and cancel also sends the public reason', async () => {
    await openConsole();
    setAction('rerun');
    fireEvent.change(priv().getByLabelText('Mã trận (UUID)'), { target: { value: failedMatchId } });
    fireEvent.change(priv().getByLabelText(REASON), { target: { value: 'r' } });
    fireEvent.change(priv().getByLabelText(/Lý do công khai/), { target: { value: 'p' } });
    fireEvent.click(priv().getByRole('button', { name: 'Xem lại thao tác' }));
    expect(await priv().findByRole('alert')).toBeTruthy();
    expect(priv().queryByRole('button', { name: 'Xác nhận thực hiện' })).toBeNull();
  });
});
