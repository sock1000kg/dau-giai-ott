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

const OPEN_RULE_SET_ID = '00000000-0000-4000-8000-000000000002';

async function attemptClose(errorBody: unknown) {
  const open = roundRow({ status: 'SUBMISSION_OPEN', ruleSetId: OPEN_RULE_SET_ID, allowedActions: ['close'] });
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

describe('RoundAdmin close errors (loop 87)', () => {
  it('shows the grace end time next to the close button of an open round', async () => {
    installApiMock({
      rounds: [roundRow({ status: 'SUBMISSION_OPEN', ruleSetId: OPEN_RULE_SET_ID, allowedActions: ['close'] })],
      ruleSets: [ruleSetRow()],
      teams: [],
    });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    expect(await screen.findByText(/chỉ đóng được sau khi hết ân hạn: .*12:00:00 18\/10\/2026/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /đóng nộp bài/i }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps the close button enabled when the rule set cannot be loaded', async () => {
    installApiMock({
      rounds: [roundRow({ status: 'SUBMISSION_OPEN', ruleSetId: '00000000-0000-4000-8000-0000000000ff', allowedActions: ['close'] })],
      ruleSets: [ruleSetRow()],
      teams: [],
    });
    window.history.replaceState({}, '', '/admin/rounds');
    render(<App />);
    const button = await screen.findByRole('button', { name: /đóng nộp bài/i });
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/chỉ đóng được sau khi hết ân hạn/i)).toBeNull();
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
