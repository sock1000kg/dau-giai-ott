import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

const SHA = `sha256:${'ab'.repeat(32)}`;

function entry(matchId: string, state: string, stage: string, finalizedAt = '2026-10-13T08:00:00.000Z') {
  return {
    matchId, state, eventLogSha256: SHA, seriesId: `series-${matchId}`, stage, finalizedAt,
    teamX: { id: 'tx', name: `X-${matchId}` }, teamO: { id: 'to', name: `O-${matchId}` },
  };
}

function catalog(items: unknown[], pagination = { page: 1, pageSize: 25, total: items.length, totalPages: 1 }) {
  return { data: { items, pagination } };
}

const adminSession = () => response(200, { data: { role: 'BTC_ADMIN' } });

function open(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const item of responses) fetchMock.mockResolvedValueOnce(item);
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState({}, '', '/admin/replays');
  render(<App />);
  return fetchMock;
}

let showModal: ReturnType<typeof vi.fn>;

beforeEach(() => {
  showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, writable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, writable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('replay admin UI: frame and table', () => {
  it('shows the summary, legend and one row per match with state badge text', async () => {
    open(adminSession(), response(200, catalog([
      entry('m-private', 'PRIVATE', 'FINALS'),
      entry('m-staged', 'STAGED', 'FINALS'),
      entry('m-published', 'PUBLISHED', 'FINALS'),
      entry('m-qual', 'PRIVATE', 'QUALIFICATION'),
    ])));
    expect(await screen.findByText('4 trận đủ điều kiện')).toBeTruthy();
    expect(screen.getByText(/Riêng tư → Đang chờ duyệt → Đã công bố/)).toBeTruthy();
    expect(screen.getByText('BTC · SAU KHI TRẬN KẾT THÚC')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Danh sách trận đã kết thúc' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(within(rows[1]!).getByText('Riêng tư')).toBeTruthy();
    expect(within(rows[2]!).getByText('Đang chờ duyệt')).toBeTruthy();
    expect(within(rows[3]!).getByText('Đã công bố')).toBeTruthy();
    expect(within(rows[4]!).getByText('Riêng tư')).toBeTruthy();
  });

  it('formats the finish time in Vietnam time and truncates hash and match id with full values in title', async () => {
    const longId = '0123456789abcdef-long-match-id';
    open(adminSession(), response(200, catalog([entry(longId, 'PRIVATE', 'FINALS', '2026-10-13T08:00:00.000Z')])));
    const time = await screen.findByText('15:00 13/10/2026');
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe('2026-10-13T08:00:00.000Z');
    const hash = screen.getByText(`${SHA.slice(0, 23)}…`);
    expect(hash.getAttribute('title')).toBe(SHA);
    const id = screen.getByText('01234567…ch-id'.replace('ch-id', longId.slice(-6)));
    expect(id.getAttribute('title')).toBe(longId);
  });

  it('crosses the date boundary in Vietnam time', async () => {
    open(adminSession(), response(200, catalog([entry('m1', 'PRIVATE', 'FINALS', '2026-10-13T20:30:00.000Z')])));
    expect(await screen.findByText('03:30 14/10/2026')).toBeTruthy();
  });
});

describe('replay admin UI: publication controls', () => {
  it('offers the right button per state and a note for non-FINALS and PUBLISHED rows', async () => {
    open(adminSession(), response(200, catalog([
      entry('m-private', 'PRIVATE', 'FINALS'),
      entry('m-staged', 'STAGED', 'FINALS'),
      entry('m-published', 'PUBLISHED', 'FINALS'),
      entry('m-qual', 'STAGED', 'QUALIFICATION'),
    ])));
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByRole('button', { name: 'Đưa vào duyệt' })).toBeTruthy();
    expect(within(rows[2]!).getByRole('button', { name: 'Công bố replay' })).toBeTruthy();
    expect(within(rows[2]!).queryByRole('button', { name: 'Đưa vào duyệt' })).toBeNull();
    expect(within(rows[3]!).getByText('Replay đã công khai')).toBeTruthy();
    expect(within(rows[3]!).queryAllByRole('button')).toHaveLength(0);
    expect(within(rows[4]!).getByText('Vòng loại: replay riêng tư — không công khai')).toBeTruthy();
    expect(within(rows[4]!).queryAllByRole('button')).toHaveLength(0);
  });

  it('disables every row button while a transition is in flight', async () => {
    let resolveTransition: ((value: Response) => void) | undefined;
    const fetchMock = open(adminSession(), response(200, catalog([entry('m1', 'PRIVATE', 'FINALS'), entry('m2', 'STAGED', 'FINALS')])));
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveTransition = resolve; }));
    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào duyệt' }));
    fireEvent.change(screen.getByLabelText(/lý do/i), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đưa vào duyệt' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Công bố replay' }).hasAttribute('disabled')).toBe(true));
    expect(screen.getByRole('button', { name: 'Đưa vào duyệt' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Làm mới' }).hasAttribute('disabled')).toBe(true);
    fetchMock.mockResolvedValueOnce(response(200, catalog([entry('m1', 'STAGED', 'FINALS')])));
    resolveTransition?.(response(200, { data: { matchId: 'm1', state: 'STAGED' } }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Công bố replay' }).hasAttribute('disabled')).toBe(false));
  });
});

describe('replay admin UI: confirmation dialog', () => {
  it('opens a modal per action with its title, focuses the reason and requires text', async () => {
    open(adminSession(), response(200, catalog([entry('m1', 'PRIVATE', 'FINALS')])));
    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào duyệt' }));
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Đưa replay vào duyệt?' })).toBeTruthy();
    const reason = screen.getByLabelText(/lý do/i) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(reason);
    expect(reason.maxLength).toBe(500);
    const confirm = screen.getByRole('button', { name: 'Xác nhận đưa vào duyệt' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(reason, { target: { value: '   ' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('3/500')).toBeTruthy();
    fireEvent.change(reason, { target: { value: 'Đã kiểm tra' } });
    expect(screen.getByText('11/500')).toBeTruthy();
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('uses the publish title for STAGED rows', async () => {
    open(adminSession(), response(200, catalog([entry('m1', 'STAGED', 'FINALS')])));
    fireEvent.click(await screen.findByRole('button', { name: 'Công bố replay' }));
    expect(screen.getByRole('heading', { name: 'Công bố replay?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xác nhận công bố' })).toBeTruthy();
  });

  it('keeps the idempotency key across a failed submit and issues a new one on re-open', async () => {
    let n = 0;
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `key-${++n}` as `${string}-${string}-${string}-${string}-${string}`);
    const fetchMock = open(
      adminSession(), response(200, catalog([entry('m1', 'PRIVATE', 'FINALS')])),
      response(500, {}), response(500, {}),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Đưa vào duyệt' }));
    const reason = screen.getByLabelText(/lý do/i);
    fireEvent.change(reason, { target: { value: 'a' } });
    fireEvent.change(reason, { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đưa vào duyệt' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đưa vào duyệt' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/stage'))).toHaveLength(2));
    const keys = fetchMock.mock.calls.slice(2).map((call) => new Headers(call[1]?.headers).get('idempotency-key'));
    expect(keys).toEqual(['key-1', 'key-1']);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đưa vào duyệt' }));
    expect(n).toBe(2);
  });

  it('closes on Cancel and Escape and returns focus to the trigger', async () => {
    open(adminSession(), response(200, catalog([entry('m1', 'PRIVATE', 'FINALS')])));
    const trigger = await screen.findByRole('button', { name: 'Đưa vào duyệt' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.queryByRole('form', { name: 'Xác nhận phát hành replay' })).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('replay admin UI: states', () => {
  it('shows loading, empty and error states with the existing texts', async () => {
    let resolveCatalog: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(adminSession())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveCatalog = resolve; }))
      .mockResolvedValueOnce(response(500, {}));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/replays');
    render(<App />);
    expect((await screen.findByText('Đang tải danh sách replay…')).getAttribute('role')).toBe('status');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveCatalog?.(response(200, catalog([])));
    expect(await screen.findByText('Chưa có replay đủ điều kiện phát hành.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBeTruthy();
  });

  it('paginates with disabled bounds', async () => {
    const fetchMock = open(
      adminSession(),
      response(200, catalog([entry('m1', 'PRIVATE', 'FINALS')], { page: 1, pageSize: 25, total: 30, totalPages: 2 })),
      response(200, catalog([entry('m2', 'PRIVATE', 'FINALS')], { page: 2, pageSize: 25, total: 30, totalPages: 2 })),
    );
    const nav = await screen.findByRole('navigation', { name: 'Phân trang replay' });
    expect(await within(nav).findByText((_, node) => node?.tagName === 'SPAN' && node.textContent === 'Trang 1 / 2')).toBeTruthy();
    expect(within(nav).getByRole('button', { name: 'Trang trước' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(nav).getByRole('button', { name: 'Trang sau' }));
    expect(await within(nav).findByText((_, node) => node?.tagName === 'SPAN' && node.textContent === 'Trang 2 / 2')).toBeTruthy();
    await waitFor(() => expect(within(nav).getByRole('button', { name: 'Trang sau' }).hasAttribute('disabled')).toBe(true));
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('page=2');
  });
});
