import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectCurrentLockedRound } from './current-rule-set.ts';
import { RoundAdminPage } from './RoundAdminPage.tsx';
import { id1, id2, installPageMock, round, ruleSet } from './test-support.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('current rule set selection', () => {
  it('picks the highest roundNumber among locked rounds regardless of list order', () => {
    const rounds = [
      round({ roundNumber: 1, status: 'RATED', ruleSetId: id1 }),
      round({ roundNumber: 3, status: 'DRAFT_RULES', ruleSetId: id2 }),
      round({ roundNumber: 2, status: 'RUNNING', ruleSetId: id2 }),
      round({ roundNumber: 4, status: 'SUBMISSION_OPEN', ruleSetId: null }),
    ];
    expect(selectCurrentLockedRound(rounds)?.roundNumber).toBe(2);
    expect(selectCurrentLockedRound([...rounds].reverse())?.roundNumber).toBe(2);
    expect(selectCurrentLockedRound([round({ roundNumber: 1 })])).toBeNull();
  });
});

describe('RoundAdminPage layout', () => {
  it('renders current rules and the new-version editor as two regions', async () => {
    installPageMock({
      rounds: [round({ roundNumber: 1, status: 'RATED', ruleSetId: id1 }), round({ roundNumber: 2, status: 'RUNNING', ruleSetId: id2 })],
      ruleSets: [ruleSet(id1, 1, '1.0.0'), ruleSet(id2, 2, '2.0.0')],
    });
    render(<RoundAdminPage />);
    const current = await screen.findByRole('region', { name: 'Bộ luật hiện hành' });
    const editor = screen.getByRole('region', { name: 'Phiên bản bộ luật mới' });
    expect(current).not.toBe(editor);
    expect(within(current).getByText(/phiên bản 2, sha 22222222/i)).toBeTruthy();
    expect((within(current).getByLabelText(/engine version/i) as HTMLInputElement).value).toBe('2.0.0');
    expect((within(editor).getByLabelText(/engine version/i) as HTMLInputElement).value).toBe('2.0.0');
  });

  it('never reuses a DOM id between the current-rules form and the editor', async () => {
    installPageMock({ rounds: [round({ roundNumber: 1, status: 'RATED', ruleSetId: id1 })], ruleSets: [ruleSet(id1, 1, '1.0.0')] });
    render(<RoundAdminPage />);
    await screen.findByRole('region', { name: 'Bộ luật hiện hành' });
    const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id);
    expect(ids.length).toBeGreaterThan(50);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to the latest version read-only when no round is locked', async () => {
    installPageMock({ rounds: [round({ roundNumber: 1 })], ruleSets: [ruleSet(id1, 1, '1.0.0')] });
    render(<RoundAdminPage />);
    const current = await screen.findByRole('region', { name: 'Bộ luật hiện hành' });
    expect(within(current).getByText(/chưa có bộ luật nào được khóa/i)).toBeTruthy();
    expect((within(current).getByLabelText(/engine version/i) as HTMLInputElement).disabled).toBe(true);
  });

  it('shows the empty message when there is no rule set at all', async () => {
    installPageMock({ rounds: [], ruleSets: [] });
    render(<RoundAdminPage />);
    const current = await screen.findByRole('region', { name: 'Bộ luật hiện hành' });
    expect(within(current).getByText('Chưa có bộ luật nào được khóa')).toBeTruthy();
  });
});

describe('reconcile button', () => {
  it('is renamed and explains what it does', async () => {
    installPageMock({ rounds: [round({ roundNumber: 1, status: 'RUNNING', ruleSetId: id1, allowedActions: ['reconcile'] })], ruleSets: [ruleSet(id1, 1, '1.0.0')] });
    render(<RoundAdminPage />);
    const button = await screen.findByRole('button', { name: 'Kiểm tra và chốt kết quả round' });
    const help = document.getElementById(button.getAttribute('aria-describedby') as string);
    expect(help?.textContent).toMatch(/áp dụng Elo/);
    expect(help?.textContent).toMatch(/an toàn khi bấm lại/);
    expect(screen.queryByRole('button', { name: /đồng bộ trạng thái/i })).toBeNull();
    
  });
});
