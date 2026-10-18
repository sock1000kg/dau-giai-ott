import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoundAdminPage } from './RoundAdminPage.tsx';
import { RoundRuleForm } from './RoundRuleForm.tsx';
import { id1, installPageMock, round, ruleSet } from './test-support.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lockedPage() {
  installPageMock({ rounds: [round({ roundNumber: 1, status: 'RATED', ruleSetId: id1 })], ruleSets: [ruleSet(id1, 1, '1.0.0')] });
  render(<RoundAdminPage />);
  return screen.findByRole('region', { name: 'Phiên bản bộ luật mới' });
}

describe('round admin stage line', () => {
  it('shows the stage as static text, not a dropdown', async () => {
    const editor = await lockedPage();
    expect(editor).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /stage/i })).toBeNull();
    expect(document.getElementById('round-admin-stage')?.tagName).not.toBe('SELECT');
    const line = document.getElementById('round-admin-stage');
    expect(line?.textContent).toContain('Stage');
    expect(line?.textContent).toContain('Vòng loại (QUALIFICATION)');
  });
});

describe('rule editor footer', () => {
  it('keeps the reason field and the confirm button outside the scroll area', async () => {
    const editor = await lockedPage();
    const reason = within(editor).getByLabelText('Lý do thay đổi');
    const submit = within(editor).getByRole('button', { name: 'Lưu phiên bản mới' });
    expect(reason.closest('.rr-scroll')).toBeNull();
    expect(submit.closest('.rr-scroll')).toBeNull();
    const footer = reason.closest('.rr-footer');
    expect(footer).not.toBeNull();
    expect(footer?.contains(submit)).toBe(true);
    expect(footer?.closest('form')).toBe(submit.closest('form'));
    const scroll = editor.querySelector('.rr-scroll');
    expect(scroll?.contains(within(editor).getByLabelText(/engine version/i))).toBe(true);
    expect(scroll?.parentElement).toBe(footer?.parentElement);
  });

  it('has exactly one scroll container in the editor card and none inside the locked form', async () => {
    const editor = await lockedPage();
    expect(editor.querySelectorAll('.rr-scroll').length).toBe(1);
    expect(editor.querySelector('.round-admin-editor-scroll')).toBeNull();
    const current = screen.getByRole('region', { name: 'Bộ luật hiện hành' });
    expect(current.querySelectorAll('.round-admin-current-scroll').length).toBe(1);
    expect(current.querySelector('.rr-scroll')).toBeNull();
  });

  it('renders no footer in locked (read-only) mode', async () => {
    await lockedPage();
    const current = screen.getByRole('region', { name: 'Bộ luật hiện hành' });
    expect(current.querySelector('.rr-footer')).toBeNull();
    expect(within(current).queryByRole('button', { name: 'Lưu phiên bản mới' })).toBeNull();
  });

  it('still submits the same payload from the footer', async () => {
    const editor = await lockedPage();
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit): Promise<Response> => {
      expect(String(url)).toBe('/api/v1/admin/round-rule-sets');
      expect(init?.method).toBe('POST');
      return { ok: true, status: 201, json: async () => ({ data: { id: 'rs-9', version: 9, rulesSha256: 'f'.repeat(64) } }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    fireEvent.change(within(editor).getByLabelText('Lý do thay đổi'), { target: { value: 'Từ footer' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Lưu phiên bản mới' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));
    const post = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/admin/round-rule-sets');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ tournamentStage: 'QUALIFICATION', reason: 'Từ footer' });
  });

  it('keeps the over-window acknowledgement in the footer and gating the button', () => {
    render(<RoundRuleForm stage="QUALIFICATION" prefill={null} locked={null} initialTeamCount={8} onSaved={() => {}} />);
    expect(screen.queryByLabelText(/tôi xác nhận ước tính vượt khung/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/số đội \(t\)/i), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText(/đồng thời \(c\)/i), { target: { value: '1' } });
    const ack = screen.getByLabelText(/tôi xác nhận ước tính vượt khung/i);
    expect(ack.closest('.rr-scroll')).toBeNull();
    expect(ack.closest('.rr-footer')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Lưu phiên bản mới' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
