import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function roundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    tournamentStage: 'QUALIFICATION',
    roundNumber: 3,
    status: 'DRAFT_RULES',
    ruleSetId: null,
    scheduleRoundId: null,
    pausedAt: null,
    createdAt: '2026-10-14T00:00:00.000Z',
    allowedActions: ['open'],
    ...overrides,
  };
}

function ruleSetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    version: 2,
    rulesSha256: 'b'.repeat(64),
    reason: 'second version',
    createdAt: '2026-10-14T00:00:00.000Z',
    tournamentStage: 'QUALIFICATION',
    rules: {
      schemaVersion: 'ott.round-rules.v1',
      engineVersion: '1.0.0',
      mapSet: [{ mapId: 'map-v1', checksum: 'a'.repeat(64) }],
      maxTurns: 200,
      faultPolicyVersion: 'P2_BASELINE_V1',
      timeControl: { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000, perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 } },
      resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
      schedule: {
        submissionOpensAt: '2026-10-14T07:00:00.000Z',
        submissionDeadlineAt: '2026-10-17T16:59:00.000Z',
        graceEndsAt: '2026-10-18T05:00:00.000Z',
        runStartsAt: '2026-10-18T07:00:00.000Z',
        runMaxHours: 48,
        appealEndsAt: '2026-10-21T05:00:00.000Z',
      },
      testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE'] },
    },
    ...overrides,
  };
}

interface ApiState {
  rounds: Record<string, unknown>[];
  ruleSets: Record<string, unknown>[];
  teams: Record<string, unknown>[];
  onTransition?: (roundId: string, action: string, init: RequestInit | undefined) => Response | null;
}

function installApiMock(state: ApiState) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
    const path = String(url);
    calls.push({ url: path, init });
    if (path.startsWith('/api/v1/auth/')) return response(200, { data: { role: 'BTC_ADMIN' } });
    if (path.startsWith('/api/v1/admin/round-rule-sets?tournamentStage=')) {
      return response(200, { data: { items: state.ruleSets.map(({ rules, ...summary }) => summary) } });
    }
    const detailMatch = /^\/api\/v1\/admin\/round-rule-sets\/([^/]+)$/.exec(path);
    if (detailMatch) {
      const found = state.ruleSets.find((entry) => entry.id === detailMatch[1]);
      return found ? response(200, { data: found }) : response(404, { error: { code: 'RULE_SET_NOT_FOUND', message: 'nope' } });
    }
    if (path.startsWith('/api/v1/admin/rounds?tournamentStage=')) return response(200, { data: { items: state.rounds } });
    const roundMatch = /^\/api\/v1\/admin\/rounds\/([^/]+)(?:\/([a-z]+))?$/.exec(path);
    if (roundMatch && (init?.method ?? 'GET') === 'GET' && roundMatch[1]) {
      const wanted = roundMatch[1];
      const found = state.rounds.find((entry) => entry.id === wanted);
      return found ? response(200, { data: found }) : response(404, { error: { code: 'ROUND_NOT_FOUND', message: 'nope' } });
    }
    if (roundMatch && init?.method === 'POST' && roundMatch[1] && roundMatch[2]) {
      const custom = state.onTransition?.(roundMatch[1], roundMatch[2], init);
      if (custom) return custom;
      const wanted = roundMatch[1];
      const found = state.rounds.find((entry) => entry.id === wanted);
      return found ? response(200, { data: found }) : response(404, { error: { code: 'ROUND_NOT_FOUND', message: 'nope' } });
    }
    if (path === '/api/v1/admin/rounds' && init?.method === 'POST') {
      const created = roundRow({ id: '00000000-0000-4000-8000-000000000009', roundNumber: state.rounds.length + 1 });
      state.rounds.unshift(created);
      return response(201, { data: created });
    }
    if (path === '/api/v1/admin/teams') return response(200, { data: state.teams });
    throw new Error(`unmocked request: ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('RoundAdmin operations console', () => {
  it('renders action buttons only from server allowedActions', async () => {
    installApiMock({ rounds: [roundRow()], ruleSets: [ruleSetRow()], teams: [{ id: 'team-1' }] });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /vận hành round/i })).toBeTruthy();
    const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
    await screen.findByRole('heading', { name: 'Round 3' });
    expect(within(operations).getByRole('button', { name: /mở nộp bài/i })).toBeTruthy();
    expect(within(operations).queryByRole('button', { name: /đóng nộp bài/i })).toBeNull();
    expect(within(operations).queryByRole('button', { name: /bắt đầu round/i })).toBeNull();
    expect(within(operations).queryByRole('button', { name: /tạm dừng/i })).toBeNull();
  });

  it('refetches and reconciles buttons after a 409 transition conflict', async () => {
    const closed = roundRow({ status: 'SUBMISSION_CLOSED', ruleSetId: '00000000-0000-4000-8000-000000000002', allowedActions: ['start'] });
    const running = roundRow({ status: 'RUNNING', ruleSetId: '00000000-0000-4000-8000-000000000002', allowedActions: ['pause', 'reconcile'] });
    const api = installApiMock({
      rounds: [closed],
      ruleSets: [ruleSetRow()],
      teams: [{ id: 'team-1' }],
      onTransition: () => response(409, { error: { code: 'ROUND_TRANSITION_INVALID', message: 'stale' } }),
    });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
    await screen.findByRole('heading', { name: 'Round 3' });
    // Server state advances elsewhere before the refetch happens.
    api.fetchMock.mockImplementation(async (url: unknown, init?: RequestInit): Promise<Response> => {
      const path = String(url);
      if (path.startsWith('/api/v1/auth/')) return response(200, { data: { role: 'BTC_ADMIN' } });
      if (path.includes('/start')) return response(409, { error: { code: 'ROUND_TRANSITION_INVALID', message: 'stale' } });
      if (path.endsWith('/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001')) return response(200, { data: running });
      if (path.startsWith('/api/v1/admin/rounds?tournamentStage=')) return response(200, { data: { items: [running] } });
      if (path.startsWith('/api/v1/admin/round-rule-sets?tournamentStage=')) return response(200, { data: { items: [] } });
      if (path === '/api/v1/admin/teams') return response(200, { data: [{ id: 'team-1' }] });
      if (path.startsWith('/api/v1/admin/round-rule-sets/')) return response(200, { data: ruleSetRow() });
      throw new Error(`unmocked request: ${path}`);
    });
    fireEvent.click(within(operations).getByRole('button', { name: /bắt đầu round/i }));
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Chạy round 3' } });
    fireEvent.change(screen.getByLabelText(/nhập số round/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận bắt đầu/i }));
    expect(await screen.findByText(/trạng thái đã thay đổi ở nơi khác/i)).toBeTruthy();
    await waitFor(() => expect(within(operations).queryByRole('button', { name: /tạm dừng/i })).toBeTruthy());
    expect(within(operations).queryByRole('button', { name: /bắt đầu round/i })).toBeNull();
  });

  it('requires a reason and the round number before confirming start', async () => {
    installApiMock({
      rounds: [roundRow({ status: 'SUBMISSION_CLOSED', ruleSetId: '00000000-0000-4000-8000-000000000002', allowedActions: ['start'] })],
      ruleSets: [ruleSetRow()],
      teams: [{ id: 'team-1' }, { id: 'team-2' }],
    });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
    await screen.findByRole('heading', { name: 'Round 3' });
    fireEvent.click(within(operations).getByRole('button', { name: /bắt đầu round/i }));
    const confirm = screen.getByRole('button', { name: /xác nhận bắt đầu/i });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(await screen.findByText((_, element) => element?.tagName === 'P' && (element.textContent ?? '').includes('2 đội'))).toBeTruthy();
    expect(await screen.findByText((_, element) => element?.tagName === 'P' && (element.textContent ?? '').includes('worst-case'))).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Đủ điều kiện chạy' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(/nhập số round/i), { target: { value: '999' } });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(/nhập số round/i), { target: { value: '3' } });
    expect(confirm.hasAttribute('disabled')).toBe(false);
  });

  it('sends exactly one start request on double click and reuses the key on retry', async () => {
    const running = roundRow({ status: 'RUNNING', ruleSetId: '00000000-0000-4000-8000-000000000002', allowedActions: ['pause', 'reconcile'] });
    let resolveStart: ((value: Response) => void) | undefined;
    let startAttempts = 0;
    const startKeys: (string | null)[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
      const path = String(url);
      if (path.startsWith('/api/v1/auth/')) return response(200, { data: { role: 'BTC_ADMIN' } });
      if (path.startsWith('/api/v1/admin/rounds?tournamentStage=')) return response(200, { data: { items: [roundRow({ status: 'SUBMISSION_CLOSED', ruleSetId: '00000000-0000-4000-8000-000000000002', allowedActions: ['start'] })] } });
      if (path.startsWith('/api/v1/admin/round-rule-sets?tournamentStage=')) return response(200, { data: { items: [] } });
      if (path.startsWith('/api/v1/admin/round-rule-sets/')) return response(200, { data: ruleSetRow() });
      if (path === '/api/v1/admin/teams') return response(200, { data: [{ id: 'team-1' }] });
      if (path.endsWith('/start')) {
        startAttempts += 1;
        startKeys.push(new Headers(init?.headers).get('idempotency-key'));
        if (startAttempts === 1) return new Promise<Response>((resolve) => { resolveStart = resolve; });
        return response(200, { data: running });
      }
      if (path.endsWith('/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001')) return response(200, { data: running });
      throw new Error(`unmocked request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
    await within(operations).findByRole('button', { name: /bắt đầu round/i });
    fireEvent.click(within(operations).getByRole('button', { name: /bắt đầu round/i }));
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Chạy round 3' } });
    fireEvent.change(screen.getByLabelText(/nhập số round/i), { target: { value: '3' } });
    const confirm = screen.getByRole('button', { name: /xác nhận bắt đầu/i });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(startAttempts).toBe(1);
    expect(confirm.hasAttribute('disabled')).toBe(true);
    if (!resolveStart) throw new Error('start request was not started');
    resolveStart(response(200, { data: running }));
    await waitFor(() => expect(screen.getByText(/đang chạy/i)).toBeTruthy());
    expect(startKeys[0]).toBeTruthy();
  });

  it('reuses one idempotency key per confirmation and mints a new key after cancel', async () => {
    const keys: (string | null)[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
      const path = String(url);
      if (path.startsWith('/api/v1/auth/')) return response(200, { data: { role: 'BTC_ADMIN' } });
      if (path.startsWith('/api/v1/admin/rounds?tournamentStage=')) {
        return response(200, { data: { items: [roundRow({ status: 'SUBMISSION_CLOSED', ruleSetId: '00000000-0000-4000-8000-000000000002', allowedActions: ['start'] })] } });
      }
      if (path.startsWith('/api/v1/admin/round-rule-sets?tournamentStage=')) return response(200, { data: { items: [] } });
      if (path.startsWith('/api/v1/admin/round-rule-sets/')) return response(200, { data: ruleSetRow() });
      if (path === '/api/v1/admin/teams') return response(200, { data: [{ id: 'team-1' }] });
      if (path.endsWith('/start')) {
        keys.push(new Headers(init?.headers).get('idempotency-key'));
        return response(500, { error: { message: 'boom' } });
      }
      if (path.endsWith('/api/v1/admin/rounds/00000000-0000-4000-8000-000000000001')) {
        return response(200, { data: roundRow({ status: 'SUBMISSION_CLOSED', ruleSetId: '00000000-0000-4000-8000-000000000002', allowedActions: ['start'] }) });
      }
      throw new Error(`unmocked request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
    await within(operations).findByRole('button', { name: /bắt đầu round/i });
    fireEvent.click(within(operations).getByRole('button', { name: /bắt đầu round/i }));
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Lần một' } });
    fireEvent.change(screen.getByLabelText(/nhập số round/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận bắt đầu/i }));
    await waitFor(() => expect(keys).toHaveLength(1));
    // Retry from the same confirmation panel reuses the key.
    fireEvent.click(screen.getByRole('button', { name: /xác nhận bắt đầu/i }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    // Cancel discards the key; the next confirmation mints a fresh one.
    fireEvent.click(screen.getByRole('button', { name: /^hủy$/i }));
    fireEvent.click(within(operations).getByRole('button', { name: /bắt đầu round/i }));
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Lần hai' } });
    fireEvent.change(screen.getByLabelText(/nhập số round/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận bắt đầu/i }));
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).toBeTruthy();
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('denies team accounts on the round console route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { data: { role: 'TEAM_ACCOUNT', teamId: 'team-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /không có quyền truy cập/i })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
