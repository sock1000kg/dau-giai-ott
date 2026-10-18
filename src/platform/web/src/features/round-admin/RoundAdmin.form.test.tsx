import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIELD_HELP, fieldIdFromDomId } from './field-help.ts';
import { RoundRuleForm } from './RoundRuleForm.tsx';
import type { RoundRuleSetRulesV1 } from './rules-form.ts';

function response(status: number, data?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function validRules(): RoundRuleSetRulesV1 {
  return {
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
    testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE', 'OWN_SUBMISSION'] },
  };
}

function renderNew(prefill: RoundRuleSetRulesV1 | null = validRules()) {
  return render(
    <RoundRuleForm stage="QUALIFICATION" prefill={prefill} locked={null} initialTeamCount={8} onSaved={() => {}} />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RoundAdmin rule form', () => {
  it('covers timing, resource, game, schedule and test-run fields with labels', () => {
    renderNew();
    for (const label of [
      /startup \(ms\)/i, /tổng thời gian\/bot\/trận/i, /wall-clock\/trận/i, /thời gian mỗi lượt/i,
      /bộ nhớ \(mib\)/i, /cpu \(millicpu\)/i, /pids/i, /tmpfs/i, /archive \(mib\)/i, /unpacked \(mib\)/i, /số layer tối đa/i,
      /engine version/i, /số lượt tối đa/i, /fault policy version/i, /map id #1/i, /checksum #1/i,
      /mở nộp bài/i, /hạn nộp bài/i, /kết thúc gia hạn/i, /bắt đầu chạy/i, /khung chạy tối đa/i, /kết thúc khiếu nại/i,
      /quota test run/i, /số đội \(t\)/i, /đồng thời \(c\)/i, /lý do thay đổi/i,
    ]) {
      expect(screen.getByLabelText(label), String(label)).toBeTruthy();
    }
    expect(screen.getByLabelText('BTC_REFERENCE')).toBeTruthy();
    expect(screen.getByLabelText('OWN_SUBMISSION')).toBeTruthy();
    const legends = Array.from(document.querySelectorAll('legend')).map((element) => element.textContent ?? '');
    for (const expected of ['Thời gian', 'Tài nguyên', 'Luật game', 'Lịch (giờ Việt Nam, Asia/Ho_Chi_Minh)', 'Test run', 'Ước tính worst-case']) {
      expect(legends, expected).toContain(expected);
    }
  });

  it('toggles dynamic per-turn fields and prefills approved defaults', () => {
    render(<RoundRuleForm stage="QUALIFICATION" prefill={null} locked={null} initialTeamCount={0} onSaved={() => {}} />);
    expect((screen.getByLabelText(/startup \(ms\)/i) as HTMLInputElement).value).toBe('5000');
    expect((screen.getByLabelText(/archive \(mib\)/i) as HTMLInputElement).value).toBe('512');
    expect((screen.getByLabelText(/quota test run/i) as HTMLInputElement).value).toBe('2');
    expect((screen.getByLabelText(/khung chạy tối đa/i) as HTMLInputElement).value).toBe('48');
    expect((screen.getByLabelText(/bộ nhớ \(mib\)/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/engine version/i) as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText(/^base \(ms\)$/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/thời gian mỗi lượt/i), { target: { value: 'FIXED' } });
    expect(screen.queryByLabelText(/^base \(ms\)$/i)).toBeNull();
    expect(screen.getByLabelText(/cố định mỗi lượt/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/thời gian mỗi lượt/i), { target: { value: 'DYNAMIC' } });
    expect(screen.getByLabelText(/^base \(ms\)$/i)).toBeTruthy();
  });

  it('adds and removes map rows within the 1 to 16 limit', () => {
    renderNew();
    expect(screen.getByLabelText(/map id #1/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /thêm map/i }));
    expect(screen.getByLabelText(/map id #2/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /xóa map #2/i }));
    expect(screen.queryByLabelText(/map id #2/i)).toBeNull();
  });

  it('maps server validation details to fields and lists unknown paths in a summary', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(400, {
      error: {
        code: 'RULE_SET_INVALID',
        message: 'Invalid rule set',
        details: [
          { path: 'timeControl.startupMs', code: 'OUT_OF_RANGE' },
          { path: 'mysteryField', code: 'UNKNOWN_FIELD' },
        ],
      },
    }));
    vi.stubGlobal('fetch', fetchMock);
    renderNew();
    fireEvent.change(screen.getByLabelText(/lý do thay đổi/i), { target: { value: 'Điều chỉnh thời gian' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu phiên bản mới/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const startup = screen.getByLabelText(/startup \(ms\)/i);
    expect(startup.getAttribute('aria-invalid')).toBe('true');
    const describedBy = startup.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const describedText = (describedBy as string).split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(describedText).toMatch(/máy chủ từ chối/i);
    expect(screen.getByRole('alert').textContent).toContain('mysteryField');
  });

  it('shows a saved version and short sha after a successful save', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(201, { data: { id: 'rs-3', version: 3, rulesSha256: `${'c'.repeat(8)}${'d'.repeat(56)}` } }));
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn();
    render(<RoundRuleForm stage="QUALIFICATION" prefill={validRules()} locked={null} initialTeamCount={8} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/lý do thay đổi/i), { target: { value: 'Điều chỉnh thời gian' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu phiên bản mới/i }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Đã lưu phiên bản 3');
    expect(screen.getByRole('status').textContent).toContain('c'.repeat(8));
    expect(onSaved).toHaveBeenCalledWith({ id: 'rs-3', version: 3, rulesSha256: expect.any(String) });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ tournamentStage: 'QUALIFICATION', reason: 'Điều chỉnh thời gian' });
  });

  it('renders the locked rule set read-only without a save button', () => {
    const rules = validRules();
    render(
      <RoundRuleForm stage="QUALIFICATION" prefill={null} locked={{ version: 2, rulesSha256: `${'e'.repeat(64)}`, rules }} initialTeamCount={8} onSaved={() => {}} />,
    );
    expect(screen.getByText(/bộ luật đã khóa/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /lưu phiên bản mới/i })).toBeNull();
    const enabledInputs = Array.from(document.querySelectorAll('input, select, textarea')).filter(
      (element) => !(element as HTMLInputElement).disabled,
    );
    expect(enabledInputs).toHaveLength(0);
    expect((screen.getByLabelText(/engine version/i) as HTMLInputElement).value).toBe('1.0.0');
  });

  it('blocks saving while the estimate exceeds the window until acknowledged', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(201, { data: { id: 'rs-4', version: 4, rulesSha256: 'f'.repeat(64) } }));
    vi.stubGlobal('fetch', fetchMock);
    renderNew();
    expect(screen.getByText(/8 trận, 2 đợt/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/số đội \(t\)/i), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText(/đồng thời \(c\)/i), { target: { value: '1' } });
    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toMatch(/vượt khung chạy round/i);
    const save = screen.getByRole('button', { name: /lưu phiên bản mới/i });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText(/lý do thay đổi/i), { target: { value: 'Mở rộng quy mô' } });
    fireEvent.click(screen.getByLabelText(/tôi xác nhận ước tính vượt khung chạy round/i));
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('RoundAdmin field help', () => {
  function formControls(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('input[id^="rr-"], select[id^="rr-"], textarea[id^="rr-"]'));
  }

  it('covers every rendered control with a FIELD_HELP entry wired through aria-describedby', () => {
    const { rerender } = renderNew(validRules());
    const check = () => {
      for (const control of formControls()) {
        const key = fieldIdFromDomId(control.id);
        expect(Object.keys(FIELD_HELP), control.id).toContain(key);
        const ids = (control.getAttribute('aria-describedby') ?? '').split(' ');
        expect(ids, control.id).toContain(`${control.id}-help`);
        expect(document.getElementById(`${control.id}-help`)?.textContent, control.id).toBe((FIELD_HELP as Record<string, string>)[key]);
      }
    };
    check();
    fireEvent.change(screen.getByLabelText(/thời gian mỗi lượt/i), { target: { value: 'FIXED' } });
    check();
    expect(formControls().length).toBeGreaterThan(25);
    rerender(<RoundRuleForm stage="QUALIFICATION" prefill={validRules()} locked={null} initialTeamCount={8} onSaved={() => {}} />);
  });

  it('keeps both the help id and the error id when a field is invalid', () => {
    renderNew(null);
    fireEvent.change(screen.getByLabelText(/lý do thay đổi/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /lưu phiên bản mới/i }));
    const memory = screen.getByLabelText(/bộ nhớ \(mib\)/i);
    const tokens = (memory.getAttribute('aria-describedby') ?? '').split(' ');
    expect(tokens).toEqual(['rr-memoryMiB-help', 'rr-memoryMiB-error']);
    expect(document.getElementById('rr-memoryMiB-error')).toBeTruthy();
  });
});
