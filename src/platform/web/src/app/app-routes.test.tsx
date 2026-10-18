import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkNavCurrent, checkPage } from '../test/a11y-checks.ts';
import { installRouteFetch, type TestRole } from '../test/route-fixtures.ts';
import { App } from './App.tsx';

interface Case {
  readonly role: TestRole;
  readonly path: string;
  /** Text of the page's single h1. */
  readonly h1: string | RegExp;
  /** Nav link that must be marked current (authenticated pages only). */
  readonly nav?: string;
  /** Access-denied pages: no nav link may be marked current. */
  readonly denied?: true;
  /** Text of the main content that proves the data finished loading. */
  readonly ready?: string | RegExp;
}

const MATRIX: readonly Case[] = [
  { role: 'ANONYMOUS', path: '/', h1: /đăng nhập/i },
  { role: 'ANONYMOUS', path: '/leaderboard', h1: /bảng xếp hạng/i, ready: 'Alpha Team' },
  { role: 'ANONYMOUS', path: '/public', h1: /Giải đấu OTT/, ready: 'Worker recovery' },
  { role: 'ANONYMOUS', path: '/admin/teams', h1: /đăng nhập/i },
  { role: 'BTC_ADMIN', path: '/', h1: 'Khu vực BTC', nav: 'Tổng quan' },
  { role: 'BTC_ADMIN', path: '/admin/teams', h1: /đội thi/i, nav: 'Đội thi' },
  { role: 'BTC_ADMIN', path: '/admin/rounds', h1: /round/i, nav: 'Round' },
  { role: 'BTC_ADMIN', path: '/admin/operations', h1: 'Vận hành đặc quyền', nav: 'Đặc quyền', ready: 'Danh sách hồ sơ' },
  { role: 'BTC_ADMIN', path: '/admin/results', h1: /kết quả/i, nav: 'Kết quả', ready: 'Đã chốt' },
  { role: 'BTC_ADMIN', path: '/admin/replays', h1: /replay/i, nav: 'Replay', ready: /Alpha Team/ },
  { role: 'TEAM_ACCOUNT', path: '/', h1: 'Cổng đội thi', nav: 'Tổng quan' },
  { role: 'TEAM_ACCOUNT', path: '/team/submissions', h1: /nộp bot/i, nav: 'Nộp bot' },
  { role: 'TEAM_ACCOUNT', path: '/team/results', h1: /kết quả/i, nav: 'Kết quả', ready: 'Đã chốt' },
  { role: 'TEAM_ACCOUNT', path: '/admin/rounds', h1: 'Không có quyền truy cập', denied: true },
  { role: 'BTC_ADMIN', path: '/team/submissions', h1: 'Không có quyền truy cập', denied: true },
];

let errors: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  errors = [vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined)];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('routed app: structure, accessibility and console cleanliness', () => {
  it.each(MATRIX)('$role $path', async ({ role, path, h1, nav, ready, denied }) => {
    const api = installRouteFetch(role);
    window.history.replaceState({}, '', path);
    render(<App />);

    const heading = await screen.findByRole('heading', { level: 1, name: h1 });
    expect(heading).toBeTruthy();
    if (ready !== undefined) await screen.findAllByText(ready);
    // Let in-flight loads settle so state updates do not land after the checks.
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());

    expect(checkPage(document)).toEqual([]);
    if (role !== 'ANONYMOUS') {
      const { problems, current } = checkNavCurrent(document);
      if (denied === true) expect(current).toBeNull();
      else expect(problems).toEqual([]);
      if (nav !== undefined) expect(current).toBe(nav);
    }
    expect(api.unhandled).toEqual([]);
    expect(errors.flatMap((spy) => spy.mock.calls.map((call: unknown[]) => call.map(String).join(' ')))).toEqual([]);
  });

  it('rejects an unhandled request loudly in the router', async () => {
    const api = installRouteFetch('ANONYMOUS');
    const response = await fetch('/api/v1/not-a-route');
    expect(response.status).toBe(404);
    expect(api.unhandled).toEqual(['GET /api/v1/not-a-route']);
  });
});
