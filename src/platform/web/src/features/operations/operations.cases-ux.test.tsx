import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cases, failedMatchId, openConsole, response } from './operations.testkit.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

const caseId = '00000000-0000-4000-8000-0000000000aa';
const otherId = '99999999-0000-4000-8000-0000000000bb';
const summary = { id: caseId, kind: 'ANOMALY', status: 'OPEN', teamId: null, matchId: failedMatchId, submissionId: null, openedAt: '2026-10-18T00:00:00Z', decidedAt: null };
const other = { ...summary, id: otherId, kind: 'DUPLICATE' };
const detail = { ...summary, events: [{ seq: 1, eventType: 'OPENED', reason: 'first', decision: null, createdAt: '2026-10-18T01:00:00Z' }] };

/** Makes GET /cases/<id> fail while `state.failing` is true; everything else goes to the testkit router. */
function failCaseDetail() {
  const state = { failing: false };
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
    if (state.failing && /\/operations\/cases\/[0-9a-f-]+$/.test(String(input))) return Promise.resolve(response(500, { error: { code: 'INTERNAL_ERROR' } }));
    return real(input as RequestInfo, init);
  });
  return state;
}

const openCases = () => openConsole({ cases: () => response(200, { data: { items: [summary, other] } }), caseDetail: detail });
const viewButton = (id8: string) => screen.findByRole('button', { name: new RegExp(`^Xem ${id8}`) });

describe('case detail UX', () => {
  it('marks the chosen row, shows the detail and moves focus to its heading', async () => {
    await openCases();
    fireEvent.click(await viewButton('00000000'));
    const article = await screen.findByRole('article', { name: 'Chi tiết hồ sơ' });
    const heading = within(article).getByRole('heading', { level: 3 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute('tabindex')).toBe('-1');
    const rows = cases().getAllByRole('row').slice(1);
    expect(rows.filter((row) => row.getAttribute('aria-current') === 'true')).toHaveLength(1);
    expect(rows[0]!.getAttribute('aria-current')).toBe('true');
    expect(rows[0]!.className).toContain('ops-row--selected');
    expect(rows[1]!.getAttribute('aria-current')).toBeNull();
  });

  it('scrolls the detail heading into view when it opens', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      await openCases();
      fireEvent.click(await viewButton('00000000'));
      await screen.findByRole('article', { name: 'Chi tiết hồ sơ' });
      await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'nearest' }));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('shows a status while loading and disables only that row’s button', async () => {
    let release: (value: Response) => void = () => undefined;
    await openCases();
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => (/\/operations\/cases\/[0-9a-f-]+$/.test(String(input))
      ? new Promise<Response>((resolve) => { release = resolve; })
      : real(input as RequestInfo, init)));
    const first = await viewButton('00000000');
    const second = await viewButton('99999999');
    fireEvent.click(first);
    expect((await screen.findByText('Đang tải hồ sơ…')).closest('[role="status"]')).toBeTruthy();
    expect(first.hasAttribute('disabled')).toBe(true);
    expect(second.hasAttribute('disabled')).toBe(false);
    release(response(200, { data: detail }));
    await screen.findByRole('article', { name: 'Chi tiết hồ sơ' });
    expect(screen.queryByText('Đang tải hồ sơ…')).toBeNull();
    expect(first.hasAttribute('disabled')).toBe(false);
  });

  it('shows a failure inside the detail area with retry and keeps the previous detail', async () => {
    await openCases();
    const state = failCaseDetail();
    fireEvent.click(await viewButton('00000000'));
    await screen.findByRole('article', { name: 'Chi tiết hồ sơ' });
    state.failing = true;
    fireEvent.click(await viewButton('99999999'));
    const area = within(screen.getByTestId('case-detail-area'));
    const alert = await area.findByRole('alert');
    expect(alert.textContent).toMatch(/Không thể hoàn tất/);
    expect(area.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(area.getByRole('article', { name: 'Chi tiết hồ sơ' })).toBeTruthy();
    expect(cases().queryAllByRole('alert')).toHaveLength(1);
    state.failing = false;
    fireEvent.click(area.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(area.queryByRole('alert')).toBeNull());
    expect(area.getByRole('article', { name: 'Chi tiết hồ sơ' })).toBeTruthy();
  });

  it('shows a first-load failure inside the detail area, not above the table', async () => {
    await openCases();
    const state = failCaseDetail();
    state.failing = true;
    fireEvent.click(await viewButton('00000000'));
    const area = within(await screen.findByTestId('case-detail-area'));
    expect((await area.findByRole('alert')).textContent).toMatch(/Không thể hoàn tất/);
    expect(area.queryByRole('article')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('closes the detail and returns focus to that row’s button', async () => {
    await openCases();
    fireEvent.click(await viewButton('00000000'));
    const article = await screen.findByRole('article', { name: 'Chi tiết hồ sơ' });
    fireEvent.click(within(article).getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('article', { name: 'Chi tiết hồ sơ' })).toBeNull();
    const rows = cases().getAllByRole('row').slice(1);
    expect(document.activeElement).toBe(within(rows[0]!).getByRole('button'));
    expect(rows.some((row) => row.getAttribute('aria-current') === 'true')).toBe(false);
  });

  it('does not steal focus when the list reloads for an unrelated reason', async () => {
    await openCases();
    fireEvent.click(await viewButton('00000000'));
    const article = await screen.findByRole('article', { name: 'Chi tiết hồ sơ' });
    await waitFor(() => expect(document.activeElement).toBe(within(article).getByRole('heading', { level: 3 })));
    const filter = cases().getByLabelText('Lọc theo loại');
    filter.focus();
    fireEvent.change(filter, { target: { value: 'ANOMALY' } });
    await waitFor(() => expect(cases().getAllByRole('row').length).toBeGreaterThan(1));
    expect(document.activeElement).toBe(filter);
  });
});
