import { render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../app/App.tsx';

export function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

export const alpha = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha Team', representativeEmail: null };
export const beta = { id: '22222222-2222-4222-8222-222222222222', name: 'Beta Team', representativeEmail: null };
export const failedMatchId = '33333333-3333-4333-8333-333333333333';
export const doneMatchId = '44444444-4444-4444-8444-444444444444';
export const submissionId = '55555555-5555-4555-8555-555555555555';

export const failedMatch = { matchId: failedMatchId, seriesId: 's1', stage: 'ROUND_1', gameNumber: 2, status: 'FAILED', teams: { x: { id: alpha.id, name: alpha.name }, o: { id: beta.id, name: beta.name } } };
export const doneMatch = { matchId: doneMatchId, seriesId: 's2', stage: 'FINAL', gameNumber: 1, status: 'FINALIZED', teams: { x: { id: beta.id, name: beta.name }, o: { id: alpha.id, name: alpha.name } } };

export interface Call { readonly url: string; readonly init: RequestInit | undefined }

export interface Options {
  teams?: () => Response;
  matches?: (url: string) => Response;
  cases?: (url: string) => Response;
  audit?: (url: string) => Response;
  post?: (url: string, init: RequestInit) => Response | Promise<Response>;
  caseDetail?: unknown;
}

export function install(options: Options = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('/api/v1/auth/')) return response(200, { data: { role: 'BTC_ADMIN' } });
    if (url === '/api/v1/admin/teams') return options.teams?.() ?? response(200, { data: [alpha, beta] });
    if (url.startsWith('/api/v1/results/matches')) {
      return options.matches?.(url) ?? response(200, { data: { items: [failedMatch, doneMatch], pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 } } });
    }
    if (init?.method === 'POST') return options.post ? options.post(url, init) : response(200, { data: {} });
    if (url.startsWith('/api/v1/admin/operations/cases/')) return response(200, { data: options.caseDetail });
    if (url.startsWith('/api/v1/admin/operations/cases')) return options.cases?.(url) ?? response(200, { data: { items: [] } });
    if (url.startsWith('/api/v1/admin/operations/audit')) return options.audit?.(url) ?? response(200, { data: { items: [] } });
    if (url === '/api/v1/public/queue-overrides') return response(200, { data: { items: [] } });
    throw new Error(`unmocked request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const posts = (calls: readonly Call[]) => calls.filter(({ init }) => init?.method === 'POST');
export const gets = (calls: readonly Call[], prefix: string) => calls.filter(({ url, init }) => init?.method === undefined && url.startsWith(prefix));

export async function openConsole(options: Options = {}) {
  const api = install(options);
  window.history.replaceState({}, '', '/admin/operations');
  render(<App />);
  await screen.findByRole('heading', { name: 'Vận hành đặc quyền' });
  return api;
}

export const region = (name: string) => within(screen.getByRole('region', { name }));
export const priv = () => region('Thao tác đặc quyền');
export const cases = () => region('Hồ sơ vụ việc');
export const audit = () => region('Nhật ký audit');
