import { createHash } from 'node:crypto';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicTournamentPage } from './PublicTournamentPage.tsx';
import { formatScheduleValue, orderSchedule, scheduleLabel } from './schedule.ts';
import type { PublicSnapshot } from './snapshot.ts';

function fixture(over: Partial<PublicSnapshot> = {}): PublicSnapshot {
  return { schemaVersion: 1, updatedAt: new Date().toISOString(), stage: 'QUALIFICATION', round: { name: 'Week 1', status: 'RUNNING' },
    queue: [], results: [], leaderboard: [{ rank: 1, team: 'A', rating: 1500, eligible: true }],
    rules: { version: 'rules-1', engineVersion: '1.0.0', sections: [{ title: 'Ghi chú', body: 'văn bản thường' }] },
    schedule: [{ title: 'Cutoff', body: '18:00' }], announcements: [{ title: 'Thông báo BTC', body: 'Đang thi đấu' }],
    faq: [{ title: 'Nộp bot ở đâu?', body: 'Cổng đội thi' }], status: { message: 'ok', incidentEta: null }, ...over };
}
async function mount(snapshot: PublicSnapshot) {
  vi.useFakeTimers();
  const body = JSON.stringify(snapshot), sha256 = createHash('sha256').update(body).digest('hex');
  const pointer = { schemaVersion: 1, file: `snapshot-${sha256}.json`, sha256, updatedAt: snapshot.updatedAt };
  vi.stubGlobal('crypto', { subtle: { digest: async (_a: string, bytes: ArrayBuffer) => Uint8Array.from(createHash('sha256').update(new Uint8Array(bytes)).digest()).buffer } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url === '/snapshots/latest.json' ? JSON.stringify(pointer) : body)));
  window.history.replaceState({}, '', '/public');
  render(<PublicTournamentPage />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); });

describe('public page: leaderboard link', () => {
  it('links to the full leaderboard from inside the leaderboard section', async () => {
    await mount(fixture());
    const section = document.getElementById('leaderboard') as HTMLElement;
    expect(within(section).getByRole('link', { name: 'Xem bảng xếp hạng đầy đủ →' }).getAttribute('href')).toBe('/leaderboard');
  });
});

describe('public page: FAQ and announcements', () => {
  it('hides the FAQ section when it is empty', async () => {
    await mount(fixture({ faq: [] }));
    expect(screen.queryByRole('region', { name: 'FAQ' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Lịch' })).toBeTruthy();
  });
  it('renders the FAQ when it has items', async () => {
    await mount(fixture());
    expect(within(screen.getByRole('region', { name: 'FAQ' })).getByText('Nộp bot ở đâu?')).toBeTruthy();
  });
  it('says there are no announcements instead of an empty section', async () => {
    await mount(fixture({ announcements: [] }));
    const region = screen.getByRole('region', { name: 'Thông báo' });
    expect(within(region).getByText('Chưa có thông báo.')).toBeTruthy();
    expect(region.querySelector('article')).toBeNull();
  });
});

describe('public page: schedule', () => {
  it('uses friendly labels, Vietnam time and map order; unknown keys stay raw after known ones', async () => {
    await mount(fixture({ schedule: [
      { title: 'Cutoff', body: '18:00' },
      { title: 'appealEndsAt', body: '2026-10-21T05:00:00.000Z' },
      { title: 'runMaxHours', body: '48' },
      { title: 'submissionOpensAt', body: '2026-10-14T07:00:00.000Z' },
    ] }));
    const region = screen.getByRole('region', { name: 'Lịch' });
    const entries = Array.from(region.querySelectorAll('article')).map((article) => [article.querySelector('h3')?.textContent, article.querySelector('p')?.textContent]);
    expect(entries).toEqual([
      ['Mở nộp bài', '14:00 14/10/2026'],
      ['Thời lượng chạy tối đa (giờ)', '48'],
      ['Hết hạn khiếu nại', '12:00 21/10/2026'],
      ['Cutoff', '18:00'],
    ]);
  });
  it('helper functions: labels, formatting and ordering', () => {
    expect(scheduleLabel('graceEndsAt')).toBe('Hết thời gian ân hạn');
    expect(scheduleLabel('toString')).toBe('toString');
    expect(formatScheduleValue('2026-10-17T16:59:00.000Z')).toBe('23:59 17/10/2026');
    expect(formatScheduleValue('not a date')).toBe('not a date');
    expect(formatScheduleValue('2026-13-45T99:99')).toBe('2026-13-45T99:99');
    expect(orderSchedule([{ title: 'x' }, { title: 'runStartsAt' }, { title: 'submissionOpensAt' }, { title: 'y' }]).map((row) => row.title)).toEqual(['submissionOpensAt', 'runStartsAt', 'x', 'y']);
  });
});

describe('public page: rules body', () => {
  const rules = (body: string) => fixture({ rules: { version: 'rules-1', engineVersion: '1.0.0', sections: [{ title: 'Mục', body }] } });
  const region = () => screen.getByRole('region', { name: 'Luật hiện tại' });

  it('keeps plain text as a paragraph', async () => {
    await mount(rules('map-v1, checksum abc'));
    expect(region().querySelector('[data-structured]')).toBeNull();
    expect(within(region()).getByText('map-v1, checksum abc').tagName).toBe('P');
  });
  it('renders a JSON object as key–value pairs, nested objects included', async () => {
    await mount(rules(JSON.stringify({ startupMs: 5000, perTurn: { mode: 'FIXED', fixedMs: 3000 } })));
    const body = region().querySelector('[data-structured]') as HTMLElement;
    expect(body.textContent).not.toContain('{');
    const terms = Array.from(body.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(terms).toEqual(['startupMs', 'perTurn', 'mode', 'fixedMs']);
    expect(body.querySelector('dl dl')).not.toBeNull();
    expect(within(body).getByText('5000')).toBeTruthy();
  });
  it('renders a JSON array of objects as a list of key–value groups', async () => {
    await mount(rules(JSON.stringify([{ mapId: 'map-1', checksum: 'aa' }, { mapId: 'map-2', checksum: 'bb' }])));
    const body = region().querySelector('[data-structured]') as HTMLElement;
    expect(body.querySelectorAll(':scope > ul > li').length).toBe(2);
    expect(within(body).getByText('map-2')).toBeTruthy();
  });
  it('falls back to the raw string for invalid JSON and for depth above 4', async () => {
    await mount(rules('{"a": 1,'));
    expect(region().querySelector('[data-structured]')).toBeNull();
    expect(within(region()).getByText('{"a": 1,')).toBeTruthy();
    cleanup();
    const deep = JSON.stringify({ a: { b: { c: { d: { e: 1 } } } } });
    await mount(rules(deep));
    expect(region().querySelector('[data-structured]')).toBeNull();
    expect(within(region()).getByText(deep)).toBeTruthy();
  });
});
