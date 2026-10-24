import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { RoundOperations } from './RoundOperations.tsx';

function readRoundAdminCss(): string {
  const local = resolve(process.cwd(), 'src/features/round-admin/round-admin.css');
  if (existsSync(local)) return readFileSync(local, 'utf-8');
  const fromRoot = resolve(process.cwd(), 'src/platform/web/src/features/round-admin/round-admin.css');
  return readFileSync(fromRoot, 'utf-8');
}

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
  listError?: boolean;
}

function installApiMock(state: ApiState) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
    const path = String(url);
    calls.push({ url: path, init });
    if (path.startsWith('/api/v1/auth/')) return response(200, { data: { role: 'BTC_ADMIN' } });
    if (state.listError && path.startsWith('/api/v1/admin/rounds?tournamentStage=')) {
      return response(500, { error: { code: 'INTERNAL_ERROR', message: 'internal' } });
    }
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

let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView | undefined;

beforeEach(() => {
  originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
});

afterEach(() => {
  if (originalScrollIntoView !== undefined) {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState({}, '', '/');
});

const OPEN_RULE_SET_ID = '00000000-0000-4000-8000-000000000002';

async function attemptClose(errorBody: unknown) {
  const open = roundRow({ status: 'SUBMISSION_OPEN', ruleSetId: null, allowedActions: ['close'] });
  installApiMock({
    rounds: [open],
    ruleSets: [ruleSetRow()],
    teams: [],
    onTransition: () => response(409, errorBody),
  });
  window.history.replaceState({}, '', '/admin/rounds');
  render(<App />);
  const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
  await screen.findByRole('heading', { name: 'Round 3' });
  fireEvent.click(within(operations).getByRole('button', { name: /đóng nộp bài/i }));
  fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Đóng nộp bài' } });
  fireEvent.click(screen.getByRole('button', { name: /xác nhận đóng nộp bài/i }));
}

describe('RoundAdmin close errors and UX improvements (loop 104)', () => {
  it('shows pre-click hint and disabled close button before grace time, enables button after grace passes with 15s timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-10-18T04:30:00.000Z'));

    installApiMock({
      rounds: [roundRow({ id: 'round-1', status: 'SUBMISSION_OPEN', ruleSetId: OPEN_RULE_SET_ID, allowedActions: ['close'] })],
      ruleSets: [ruleSetRow({ rules: { ...ruleSetRow().rules, schedule: { ...ruleSetRow().rules.schedule, graceEndsAt: '2026-10-18T05:00:00.000Z' } } })],
      teams: [],
    });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);

    expect(await screen.findByText(/chỉ đóng được sau .*12:00:00 18\/10\/2026 \(giờ việt nam\)/i)).toBeTruthy();
    const button = screen.getByRole('button', { name: /đóng nộp bài/i });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('round-close-hint-round-1');

    // Advance by 31 minutes (crossing 05:00:00.000Z) via 15s intervals
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    });

    expect(button.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/chỉ đóng được sau/i)).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps the close button enabled and omits hint when the rule set cannot be loaded', async () => {
    installApiMock({
      rounds: [roundRow({ status: 'SUBMISSION_OPEN', ruleSetId: '00000000-0000-4000-8000-0000000000ff', allowedActions: ['close'] })],
      ruleSets: [ruleSetRow()],
      teams: [],
    });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    const button = await screen.findByRole('button', { name: /đóng nộp bài/i });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/chỉ đóng được sau/i)).toBeNull();
  });

  it('renders close error inside the pressed round li and not in the top alert, with two rounds and error on the second only', async () => {
    const scrollSpy = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollSpy;

    const round1 = roundRow({ id: 'round-1', roundNumber: 1, status: 'SUBMISSION_OPEN', ruleSetId: null, allowedActions: ['close'] });
    const round2 = roundRow({ id: 'round-2', roundNumber: 2, status: 'SUBMISSION_OPEN', ruleSetId: null, allowedActions: ['close'] });

    installApiMock({
      rounds: [round2, round1],
      ruleSets: [ruleSetRow()],
      teams: [],
      onTransition: (roundId) => {
        if (roundId === 'round-2') {
          return response(409, {
            error: {
              code: 'ROUND_GRACE_NOT_ENDED',
              message: 'x',
              details: { graceEndsAt: '2026-10-18T05:00:00.000Z', retryAfterSeconds: 60 },
            },
          });
        }
        return null;
      },
    });

    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);

    const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
    const row2 = await within(operations).findByRole('heading', { name: 'Round 2' }).then((h) => h.closest('li')!);
    const row1 = within(operations).getByRole('heading', { name: 'Round 1' }).closest('li')!;
    expect(row2).toBeTruthy();
    expect(row1).toBeTruthy();

    fireEvent.click(within(row2).getByRole('button', { name: /đóng nộp bài/i }));
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Đóng nộp bài round 2' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận đóng nộp bài/i }));

    const errorMsg = await within(row2).findByText(/chưa thể đóng nộp bài: thời gian ân hạn kết thúc lúc .*12:00:00 18\/10\/2026/i);
    expect(errorMsg).toBeTruthy();
    expect(within(row2).getByRole('alert')).toBeTruthy();

    // Round 1 must NOT have any alert
    expect(within(row1).queryByRole('alert')).toBeNull();

    // Inside RoundOperations, the only alert is within row2 (no top-level alert)
    const opAlerts = within(operations).getAllByRole('alert');
    expect(opAlerts).toHaveLength(1);
    expect(row2.contains(opAlerts[0]!)).toBe(true);

    // ScrollIntoView was invoked
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });

    // Opening another action dialog clears the error
    fireEvent.click(within(row2).getByRole('button', { name: /đóng nộp bài/i }));
    expect(within(row2).queryByRole('alert')).toBeNull();
  });

  it('does not leak scrollIntoView stub onto HTMLElement prototype', () => {
    if (originalScrollIntoView) {
      expect(HTMLElement.prototype.scrollIntoView).toBe(originalScrollIntoView);
    } else {
      expect((HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView).toBeUndefined();
    }
  });

  it('renders success message inside the pressed round li and not in round 1 or top-level status, with two rounds and action on round 2', async () => {
    const round1 = roundRow({ id: 'round-1', roundNumber: 1, status: 'SUBMISSION_OPEN', ruleSetId: null, allowedActions: ['close'] });
    const round2 = roundRow({ id: 'round-2', roundNumber: 2, status: 'SUBMISSION_OPEN', ruleSetId: null, allowedActions: ['close'] });

    installApiMock({
      rounds: [round2, round1],
      ruleSets: [ruleSetRow()],
      teams: [],
      onTransition: (roundId) => {
        if (roundId === 'round-2') {
          return response(200, { data: roundRow({ id: 'round-2', roundNumber: 2, status: 'SUBMISSION_CLOSED', allowedActions: ['start'] }) });
        }
        return null;
      },
    });

    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);

    const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
    const row2 = await within(operations).findByRole('heading', { name: 'Round 2' }).then((h) => h.closest('li')!);
    const row1 = within(operations).getByRole('heading', { name: 'Round 1' }).closest('li')!;

    fireEvent.click(within(row2).getByRole('button', { name: /đóng nộp bài/i }));
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Đóng nộp bài round 2' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận đóng nộp bài/i }));

    const statusMsg = await within(row2).findByText('Đã áp dụng thao tác.');
    expect(statusMsg).toBeTruthy();
    expect(within(row2).getByRole('status').textContent).toBe('Đã áp dụng thao tác.');

    // Round 1 must NOT have any status message
    expect(within(row1).queryByRole('status')).toBeNull();

    // Top section must NOT have a status element
    expect(operations.querySelector(':scope > [role="status"]')).toBeNull();
  });

  it('shows "đã tải lại" message visible in the affected round after reload on state conflict', async () => {
    const round1 = roundRow({ id: 'round-1', roundNumber: 1, status: 'SUBMISSION_OPEN', ruleSetId: null, allowedActions: ['open'] });
    const round2 = roundRow({ id: 'round-2', roundNumber: 2, status: 'DRAFT_RULES', ruleSetId: null, allowedActions: ['open'] });
    const updatedRound2 = roundRow({ id: 'round-2', roundNumber: 2, status: 'SUBMISSION_OPEN', allowedActions: ['close'] });

    installApiMock({
      rounds: [round2, round1],
      ruleSets: [ruleSetRow()],
      teams: [],
      onTransition: (roundId) => {
        if (roundId === 'round-2') {
          return response(409, { error: { code: 'ROUND_TRANSITION_INVALID', message: 'stale' } });
        }
        return null;
      },
    });

    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);

    const operations = await screen.findByLabelText('Vận hành round', { selector: 'section' });
    const row2 = await within(operations).findByRole('heading', { name: 'Round 2' }).then((h) => h.closest('li')!);
    const row1 = within(operations).getByRole('heading', { name: 'Round 1' }).closest('li')!;

    fireEvent.click(within(row2).getByRole('button', { name: /mở nộp bài/i }));
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'Mở round 2' } });
    fireEvent.click(screen.getByRole('button', { name: /xác nhận mở nộp bài/i }));

    const staleMsg = await within(row2).findByText(/trạng thái đã thay đổi ở nơi khác — đã tải lại/i);
    expect(staleMsg).toBeTruthy();
    expect(within(row2).getByRole('status').textContent).toMatch(/trạng thái đã thay đổi ở nơi khác — đã tải lại/i);

    // Round 1 must NOT have any status message
    expect(within(row1).queryByRole('status')).toBeNull();

    // Top section must NOT have a status element
    expect(operations.querySelector(':scope > [role="status"]')).toBeNull();
  });

  it('shows list-load error in the top box with no retry button', async () => {
    installApiMock({
      rounds: [],
      ruleSets: [],
      teams: [],
      listError: true,
    });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/không thể tải dữ liệu round/i)).toBeTruthy();
    expect(within(alert).queryByRole('button', { name: /thử lại/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /thử lại/i })).toBeNull();

    // Also verify standalone RoundOperations component top error box
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    render(<RoundOperations stage="QUALIFICATION" />);
    const opAlert = await screen.findByRole('alert');
    expect(within(opAlert).getByText(/không thể hoàn tất thao tác round/i)).toBeTruthy();
    expect(within(opAlert).queryByRole('button', { name: /thử lại/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Làm mới' })).toBeTruthy();
  });

  it('round list has role="region", tabindex 0, accessible name and bounded scroll CSS', async () => {
    installApiMock({
      rounds: [roundRow({ id: 'round-1', status: 'DRAFT_RULES' })],
      ruleSets: [ruleSetRow()],
      teams: [],
    });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);

    const listRegion = await screen.findByRole('region', { name: 'Danh sách round, cuộn được' });
    expect(listRegion.getAttribute('tabindex')).toBe('0');
    expect(listRegion.className).toContain('round-list-region');

    const css = readRoundAdminCss();
    expect(css).toMatch(/max-height:\s*min\(70vh,\s*640px\)/);
    expect(css).toMatch(/overflow-y:\s*auto/);
    expect(css).toMatch(/overscroll-behavior:\s*contain/);
    expect(css).toMatch(/scrollbar-width:\s*thin/);
    expect(css).toMatch(/\.round-list-region/);
    expect(css).toMatch(/\.rule-set-list-region/);
  });

  it('explains ROUND_GRACE_NOT_ENDED with the Vietnam time', async () => {
    await attemptClose({ error: { code: 'ROUND_GRACE_NOT_ENDED', message: 'x', details: { graceEndsAt: '2026-10-18T05:00:00.000Z', retryAfterSeconds: 60 } } });
    expect(await screen.findByText(/chưa thể đóng nộp bài: thời gian ân hạn kết thúc lúc .*12:00:00 18\/10\/2026/i)).toBeTruthy();
  });

  it('explains ROUND_NOT_OPEN', async () => {
    await attemptClose({ error: { code: 'ROUND_NOT_OPEN', message: 'x', details: { status: 'DRAFT_RULES' } } });
    expect(await screen.findByText(/round hiện không ở trạng thái đang mở nộp bài/i)).toBeTruthy();
  });

  it('explains ROUND_RULE_SET_MISSING', async () => {
    await attemptClose({ error: { code: 'ROUND_RULE_SET_MISSING', message: 'x', details: {} } });
    expect(await screen.findByText(/round chưa khóa bộ luật hợp lệ/i)).toBeTruthy();
  });
});
