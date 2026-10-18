import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoundCatalog } from './api.ts';
import { RoundAdminPage } from './RoundAdminPage.tsx';
import { RoundRuleForm } from './RoundRuleForm.tsx';
import type { RoundRuleSetRulesV1 } from './rules-form.ts';
import { id1, installPageMock, round, ruleSet } from './test-support.ts';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

const mapA = { mapId: 'map-a', version: 1, checksum: 'a'.repeat(64), width: 11, height: 9 };
const mapB = { mapId: 'map-b', version: 2, checksum: 'b'.repeat(64), width: 13, height: 13 };
const catalog: RoundCatalog = { engineVersions: ['1.0.0', '1.1.0'], maps: [mapA, mapB], faultPolicyVersions: ['P2_BASELINE_V1', 'P3_STRICT_V1'] };

function validRules(): RoundRuleSetRulesV1 {
  return {
    schemaVersion: 'ott.round-rules.v1', engineVersion: '1.0.0',
    mapSet: [{ mapId: 'map-a', checksum: mapA.checksum }],
    maxTurns: 200, faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000, perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 } },
    resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
    schedule: { submissionOpensAt: '2026-10-14T07:00:00.000Z', submissionDeadlineAt: '2026-10-17T16:59:00.000Z', graceEndsAt: '2026-10-18T05:00:00.000Z', runStartsAt: '2026-10-18T07:00:00.000Z', runMaxHours: 48, appealEndsAt: '2026-10-21T05:00:00.000Z' },
    testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE'] },
  };
}

function renderForm(prefill: RoundRuleSetRulesV1 | null = validRules(), cat: RoundCatalog | null = catalog) {
  return render(<RoundRuleForm stage="QUALIFICATION" prefill={prefill} locked={null} catalog={cat} initialTeamCount={8} onSaved={() => {}} />);
}

const select = (label: RegExp | string) => screen.getByLabelText(label) as HTMLSelectElement;
const optionTexts = (el: HTMLSelectElement) => Array.from(el.options).map((option) => option.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('catalog mode pickers', () => {
  it('renders engine, fault policy and map controls as selects with catalog options', () => {
    renderForm();
    const engine = select(/engine version/i);
    expect(engine.tagName).toBe('SELECT');
    expect(engine.className).toContain('ui-select');
    expect(optionTexts(engine)).toEqual(['— Chọn engine —', '1.0.0', '1.1.0']);
    expect(optionTexts(select(/fault policy version/i))).toEqual(['— Chọn fault policy —', 'P2_BASELINE_V1', 'P3_STRICT_V1']);
    const mapSelect = select(/map id #1/i);
    expect(mapSelect.tagName).toBe('SELECT');
    expect(optionTexts(mapSelect)).toEqual(['— Chọn map —', 'map-a · v1 · 11×9', 'map-b · v2 · 13×13']);
    expect(mapSelect.value).toBe('map-a');
  });

  it('keeps the label/describedby wiring and the checksum field read-only with a title', () => {
    renderForm();
    const engine = select(/engine version/i);
    expect(engine.getAttribute('aria-describedby')).toBe(`${engine.id}-help`);
    expect(document.getElementById(`${engine.id}-help`)?.textContent).toMatch(/danh mục/);
    const checksum = screen.getByLabelText(/checksum #1/i) as HTMLInputElement;
    expect(checksum.readOnly).toBe(true);
    expect(checksum.value).toBe(mapA.checksum);
    expect(checksum.title).toBe(mapA.checksum);
  });

  it('choosing a map sets mapId and checksum and saves exactly the catalog entry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(201, { data: { id: 'rs', version: 3, rulesSha256: 'c'.repeat(64) } }));
    vi.stubGlobal('fetch', fetchMock);
    renderForm();
    fireEvent.change(select(/map id #1/i), { target: { value: 'map-b' } });
    expect((screen.getByLabelText(/checksum #1/i) as HTMLInputElement).value).toBe(mapB.checksum);
    fireEvent.change(select(/engine version/i), { target: { value: '1.1.0' } });
    fireEvent.change(select(/fault policy version/i), { target: { value: 'P3_STRICT_V1' } });
    fireEvent.change(screen.getByLabelText(/lý do thay đổi/i), { target: { value: 'Đổi map' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu phiên bản mới/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.rules.mapSet).toEqual([{ mapId: 'map-b', checksum: mapB.checksum }]);
    expect(body.rules.engineVersion).toBe('1.1.0');
    expect(body.rules.faultPolicyVersion).toBe('P3_STRICT_V1');
  });

  it('disables maps already chosen in other rows and disables adding past the catalog size', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /thêm map/i }));
    const second = select(/map id #2/i);
    const optionA = Array.from(second.options).find((option) => option.value === 'map-a');
    expect(optionA?.disabled).toBe(true);
    expect(Array.from(second.options).find((option) => option.value === 'map-b')?.disabled).toBe(false);
    const first = select(/map id #1/i);
    expect(Array.from(first.options).find((option) => option.value === 'map-a')?.disabled).toBe(false);
    fireEvent.change(second, { target: { value: 'map-b' } });
    const add = screen.getByRole('button', { name: /thêm map/i }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('Đã dùng hết bản đồ trong danh mục');
    expect(Array.from(first.options).find((option) => option.value === 'map-b')?.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /xóa map #2/i }));
    expect(screen.queryByLabelText(/map id #2/i)).toBeNull();
    expect((screen.getByRole('button', { name: /thêm map/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps an unknown stored engine, fault policy and map selectable and selected', () => {
    const rules = { ...validRules(), engineVersion: '0.9.0', faultPolicyVersion: 'OLD_POLICY', mapSet: [{ mapId: 'map-old', checksum: 'f'.repeat(64) }] };
    renderForm(rules);
    const engine = select(/engine version/i);
    expect(optionTexts(engine)[1]).toBe('0.9.0 (không còn trong danh mục)');
    expect(engine.value).toBe('0.9.0');
    expect(select(/fault policy version/i).value).toBe('OLD_POLICY');
    expect(optionTexts(select(/fault policy version/i))[1]).toBe('OLD_POLICY (không còn trong danh mục)');
    const mapSelect = select(/map id #1/i);
    expect(optionTexts(mapSelect)[1]).toBe('map-old (không còn trong danh mục)');
    expect(mapSelect.selectedOptions[0]?.textContent).toBe('map-old (không còn trong danh mục)');
    expect((screen.getByLabelText(/checksum #1/i) as HTMLInputElement).value).toBe('f'.repeat(64));
  });

  it('treats a known mapId with a different checksum as stale instead of rewriting it', () => {
    renderForm({ ...validRules(), mapSet: [{ mapId: 'map-a', checksum: 'e'.repeat(64) }] });
    expect(select(/map id #1/i).selectedOptions[0]?.textContent).toBe('map-a (không còn trong danh mục)');
    expect((screen.getByLabelText(/checksum #1/i) as HTMLInputElement).value).toBe('e'.repeat(64));
  });

  it('still reports the required-field errors when nothing is chosen', () => {
    renderForm(null);
    expect(select(/engine version/i).value).toBe('');
    expect(select(/map id #1/i).value).toBe('');
    fireEvent.change(screen.getByLabelText(/lý do thay đổi/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu phiên bản mới/i }));
    expect(document.getElementById('rr-engineVersion-error')?.textContent).toBe('Bắt buộc nhập.');
    expect(document.getElementById('rr-faultPolicyVersion-error')?.textContent).toBe('Bắt buộc nhập.');
  });

  it('keeps plain text inputs for a locked form even when a catalog is supplied', () => {
    render(<RoundRuleForm stage="QUALIFICATION" prefill={null} locked={{ version: 1, rulesSha256: '1'.repeat(64), rules: validRules() }} catalog={catalog} initialTeamCount={8} onSaved={() => {}} />);
    expect(screen.getByLabelText(/engine version/i).tagName).toBe('INPUT');
    expect(screen.getByLabelText(/map id #1/i).tagName).toBe('INPUT');
    expect((screen.getByLabelText(/checksum #1/i) as HTMLInputElement).readOnly).toBe(false);
  });
});

describe('server error messages for catalog codes', () => {
  async function submitWith(details: { path: string; code: string }[]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(400, { error: { code: 'RULE_SET_INVALID', details } })));
    renderForm();
    fireEvent.change(screen.getByLabelText(/lý do thay đổi/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu phiên bản mới/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  }
  const text = (id: string) => document.getElementById(id)?.textContent;

  it('places each new code on its field with the Vietnamese message', async () => {
    await submitWith([
      { path: 'engineVersion', code: 'UNKNOWN_ENGINE_VERSION' },
      { path: 'faultPolicyVersion', code: 'UNKNOWN_FAULT_POLICY' },
      { path: 'mapSet[0].mapId', code: 'UNKNOWN_MAP' },
      { path: 'mapSet[0].checksum', code: 'UNKNOWN_MAP' },
      { path: 'maxTurns', code: 'MAX_TURNS_EXCEEDS_RUNNER_LIMIT' },
    ]);
    expect(text('rr-engineVersion-error')).toBe('Engine không có trong danh mục.');
    expect(text('rr-faultPolicyVersion-error')).toBe('Fault policy không có trong danh mục.');
    expect(text('rr-mapId-0-error')).toBe('Bản đồ hoặc checksum không có trong danh mục.');
    expect(text('rr-checksum-0-error')).toBe('Bản đồ hoặc checksum không có trong danh mục.');
    expect(text('rr-maxTurns-error')).toBe('Số lượt tối đa vượt giới hạn của bộ chạy trận (200).');
  });

  it('maps the per-turn limit code onto the per-turn field', async () => {
    await submitWith([{ path: 'timeControl.perTurn.maxMs', code: 'TURN_LIMIT_EXCEEDS_RUNNER_LIMIT' }]);
    expect(text('rr-maxMs-error')).toBe('Thời gian mỗi lượt vượt giới hạn của bộ chạy trận (3000 ms).');
  });

  it('keeps the generic message for other codes', async () => {
    await submitWith([{ path: 'timeControl.startupMs', code: 'OUT_OF_RANGE' }]);
    expect(text('rr-startupMs-error')).toBe('Máy chủ từ chối: OUT_OF_RANGE.');
  });
});

describe('RoundAdminPage catalog loading', () => {
  const state = () => ({ rounds: [round({ roundNumber: 1, status: 'RATED', ruleSetId: id1 })], ruleSets: [ruleSet(id1, 1, '1.0.0')] });

  it('renders selects in the editor when the catalog loads', async () => {
    installPageMock({ ...state(), catalog });
    render(<RoundAdminPage />);
    const editor = await screen.findByRole('region', { name: 'Phiên bản bộ luật mới' });
    expect(within(editor).getByLabelText(/engine version/i).tagName).toBe('SELECT');
    expect(within(editor).getByLabelText(/map id #1/i).tagName).toBe('SELECT');
    expect(screen.queryByText(/^Không tải được danh mục/)).toBeNull();
    const current = screen.getByRole('region', { name: 'Bộ luật hiện hành' });
    expect(within(current).getByLabelText(/engine version/i).tagName).toBe('INPUT');
  });

  it.each([[500], [404]])('falls back to text inputs with a warning when the catalog returns %i', async (status) => {
    installPageMock({ ...state(), catalog: {}, catalogStatus: status });
    render(<RoundAdminPage />);
    const editor = await screen.findByRole('region', { name: 'Phiên bản bộ luật mới' });
    expect(within(editor).getByLabelText(/engine version/i).tagName).toBe('INPUT');
    expect(within(editor).getByText('Không tải được danh mục engine/bản đồ/fault policy — đang dùng ô nhập tay.')).toBeTruthy();
    expect(within(editor).getByRole('button', { name: 'Thử tải lại danh mục' })).toBeTruthy();
  });

  it('falls back when the catalog payload is malformed', async () => {
    installPageMock({ ...state(), catalog: { engineVersions: 'x' } });
    render(<RoundAdminPage />);
    const editor = await screen.findByRole('region', { name: 'Phiên bản bộ luật mới' });
    expect(within(editor).getByLabelText(/engine version/i).tagName).toBe('INPUT');
    expect(within(editor).getByRole('alert').textContent).toContain('đang dùng ô nhập tay');
  });

  it('retry refetches only the catalog and switches to selects', async () => {
    const data = state() as ReturnType<typeof state> & { catalog?: unknown; catalogStatus?: number };
    data.catalog = {};
    data.catalogStatus = 500;
    const mock = installPageMock(data);
    render(<RoundAdminPage />);
    const editor = await screen.findByRole('region', { name: 'Phiên bản bộ luật mới' });
    fireEvent.change(within(editor).getByLabelText(/engine version/i), { target: { value: '1.0.0' } });
    const before = mock.requested.length;
    expect(mock.catalogCalls.length).toBe(1);
    data.catalog = catalog;
    delete data.catalogStatus;
    fireEvent.click(within(editor).getByRole('button', { name: 'Thử tải lại danh mục' }));
    await waitFor(() => expect(within(editor).getByLabelText(/engine version/i).tagName).toBe('SELECT'));
    expect(mock.requested.slice(before)).toEqual(['/api/v1/admin/rounds/catalog']);
    expect(mock.catalogCalls.length).toBe(2);
    expect(screen.queryByText(/^Không tải được danh mục/)).toBeNull();
  });
});
