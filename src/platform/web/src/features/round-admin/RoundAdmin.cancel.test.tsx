import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { selectCurrentLockedRound } from './current-rule-set.ts';
import { round } from './test-support.ts';

const ROUND_ID = '00000000-0000-4000-8000-000000000001';
const RULE_SET_ID = '00000000-0000-4000-8000-000000000002';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function roundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUND_ID, tournamentStage: 'QUALIFICATION', roundNumber: 3, status: 'SUBMISSION_OPEN', ruleSetId: RULE_SET_ID,
    scheduleRoundId: null, pausedAt: null, createdAt: '2026-10-14T00:00:00.000Z', allowedActions: ['close', 'cancel'], ...overrides,
  };
}

const ruleSet = {
  id: RULE_SET_ID, version: 2, rulesSha256: 'b'.repeat(64), reason: 'v2', createdAt: '2026-10-14T00:00:00.000Z',
};

function installApi(rounds: Record<string, unknown>[], onCancel?: (init: RequestInit | undefined) => Response) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
    const path = String(url);
    calls.push({ url: path, init });
    if (path.startsWith('/api/v1/auth/')) return response(200, { data: { role: 'BTC_ADMIN' } });
    if (path.startsWith('/api/v1/admin/round-rule-sets?')) return response(200, { data: { items: [ruleSet] } });
    if (path.startsWith('/api/v1/admin/round-rule-sets/')) return response(404, { error: { code: 'RULE_SET_NOT_FOUND', message: 'nope' } });
    if (path.startsWith('/api/v1/admin/rounds?')) return response(200, { data: { items: rounds } });
    if (path === `/api/v1/admin/rounds/${ROUND_ID}/cancel` && init?.method === 'POST') {
      return onCancel ? onCancel(init) : response(200, { data: roundRow({ status: 'CANCELLED', allowedActions: [] }) });
    }
    if (path === `/api/v1/admin/rounds/${ROUND_ID}`) return response(200, { data: rounds[0] });
    throw new Error(`unmocked request: ${path}`);
  }));
  return calls;
}

async function openOperations() {
  window.history.replaceState({}, '', '/admin/rounds');
  render(<App />);
  const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
  await screen.findByRole('heading', { name: 'Round 3' });
  return operations;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('RoundAdmin auto-publish (loop 101)', () => {
  it('has no "Công bố" button; a legacy RATED round is offered the check button instead', async () => {
    installApi([roundRow({ status: 'RATED', allowedActions: ['reconcile'] })]);
    const operations = await openOperations();
    expect(within(operations).getByText('Đã xếp hạng')).toBeTruthy();
    expect(within(operations).getByRole('button', { name: 'Kiểm tra và chốt kết quả round' })).toBeTruthy();
    expect(within(operations).queryByRole('button', { name: /công bố/i })).toBeNull();
  });

  it('never renders a publish button even if a stale server still sends it', async () => {
    installApi([roundRow({ status: 'RATED', allowedActions: ['publish', 'reconcile'] })]);
    const operations = await openOperations();
    expect(within(operations).queryByRole('button', { name: /công bố/i })).toBeNull();
  });

  it('labels PUBLISHED as Đã công bố without any action button', async () => {
    installApi([roundRow({ status: 'PUBLISHED', allowedActions: [] })]);
    const operations = await openOperations();
    expect(within(operations).getByText('Đã công bố')).toBeTruthy();
    expect(within(operations).queryAllByRole('button').map((button) => button.textContent)).not.toContain('Công bố…');
  });
});

describe('RoundAdmin cancel round (loop 101)', () => {
  it('offers Hủy vòng for the allowed statuses and not for the others', async () => {
    for (const [status, allowedActions, expected] of [
      ['DRAFT_RULES', ['open', 'cancel'], true],
      ['SUBMISSION_OPEN', ['close', 'cancel'], true],
      ['SUBMISSION_CLOSED', ['start', 'cancel'], true],
      ['RUNNING', ['pause', 'reconcile'], false],
    ] as const) {
      installApi([roundRow({ status, allowedActions: [...allowedActions] })]);
      const operations = await openOperations();
      expect(within(operations).queryByRole('button', { name: 'Hủy vòng…' }) !== null).toBe(expected);
      document.body.innerHTML = '';
    }
  });

  it('requires a reason of at least 3 characters, shows the warning and posts the cancel', async () => {
    const calls = installApi([roundRow()]);
    const operations = await openOperations();
    fireEvent.click(within(operations).getByRole('button', { name: 'Hủy vòng…' }));
    const dialog = await screen.findByRole('form', { name: 'Xác nhận hủy vòng' });
    expect(within(dialog).getByText('Vòng sẽ bị hủy. Các bản nộp của đội được giữ nguyên.')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Xác nhận hủy vòng' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Lý do'), { target: { value: 'ab' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Lý do'), { target: { value: 'mở nhầm vòng' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    const row = (await within(operations).findByRole('heading', { name: 'Round 3' })).closest('li')!;
    await waitFor(() => expect(within(row).getByText('Đã hủy')).toBeTruthy());
    expect(within(row).getByRole('status').textContent).toBe('Đã áp dụng thao tác.');
    const post = calls.find((call) => call.url.endsWith('/cancel'));
    expect(JSON.parse(String(post?.init?.body))).toEqual({ reason: 'mở nhầm vòng' });
    expect(screen.queryByRole('form', { name: 'Xác nhận hủy vòng' })).toBeNull();
    expect(within(operations).queryByRole('button', { name: 'Hủy vòng…' })).toBeNull();
  });

  it('explains ROUND_NOT_CANCELLABLE and keeps the dialog open', async () => {
    installApi([roundRow()], () => response(409, { error: { code: 'ROUND_NOT_CANCELLABLE', message: 'x', details: { status: 'RUNNING' } } }));
    const operations = await openOperations();
    fireEvent.click(within(operations).getByRole('button', { name: 'Hủy vòng…' }));
    const dialog = await screen.findByRole('form', { name: 'Xác nhận hủy vòng' });
    fireEvent.change(within(dialog).getByLabelText('Lý do'), { target: { value: 'quá muộn' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xác nhận hủy vòng' }));
    await waitFor(() => expect(within(operations).getByRole('alert').textContent).toContain('Không thể hủy vòng: vòng đã bắt đầu hoặc đã kết thúc.'));
    expect(screen.getByRole('form', { name: 'Xác nhận hủy vòng' })).toBeTruthy();
  });

  it('renders a CANCELLED round in the list without actions', async () => {
    installApi([roundRow({ status: 'CANCELLED', allowedActions: [] })]);
    const operations = await openOperations();
    expect(within(operations).getByText('Đã hủy')).toBeTruthy();
    expect(within(operations).queryAllByRole('button').map((button) => button.textContent)).not.toContain('Hủy vòng…');
  });

  it('does not treat a cancelled round as the current locked rule set', () => {
    const cancelled = round({ roundNumber: 3, status: 'CANCELLED', ruleSetId: RULE_SET_ID });
    const earlier = round({ roundNumber: 2, status: 'PUBLISHED', ruleSetId: 'older' });
    expect(selectCurrentLockedRound([earlier, cancelled])?.roundNumber).toBe(2);
    expect(selectCurrentLockedRound([cancelled])).toBeNull();
  });
});
