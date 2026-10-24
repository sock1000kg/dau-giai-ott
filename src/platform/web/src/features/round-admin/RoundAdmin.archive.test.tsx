import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoundAdminPage } from './RoundAdminPage.tsx';
import { id1, id2, installPageMock, round, ruleSet } from './test-support.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(extra: { detailFails?: Set<string> } = {}) {
  return installPageMock({
    rounds: [round({ roundNumber: 1, status: 'RATED', ruleSetId: id1 }), round({ roundNumber: 2, status: 'RUNNING', ruleSetId: id1 }), round({ roundNumber: 3 })],
    ruleSets: [ruleSet(id1, 1, '1.0.0'), ruleSet(id2, 2, '2.0.0')],
    ...extra,
  });
}

describe('RuleSetArchive', () => {
  it('lists versions newest first with usage badges', async () => {
    setup();
    render(<RoundAdminPage />);
    const list = await screen.findByRole('region', { name: 'Danh sách phiên bản, cuộn được' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('v2');
    expect(items[0]?.textContent).toContain('Mới nhất');
    expect(items[0]?.textContent).toContain('Chưa dùng');
    expect(items[1]?.textContent).toContain('v1');
    expect(items[1]?.textContent).toContain('Đang dùng bởi Round 1, 2');
  });

  it('loads detail once for the selected id, shows engine and maps read-only, without moving focus', async () => {
    const { detailCalls } = setup();
    render(<RoundAdminPage />);
    const list = await screen.findByRole('region', { name: 'Danh sách phiên bản, cuộn được' });
    const before = detailCalls.length;
    const button = within(list).getAllByRole('button')[0] as HTMLButtonElement;
    button.focus();
    fireEvent.click(button);
    await screen.findByRole('heading', { name: 'Phiên bản v2' });
    expect(detailCalls.slice(before)).toEqual([id2]);
    const detail = document.querySelector('.rule-set-detail') as HTMLElement;
    expect(detail.textContent).toContain('2.0.0');
    expect(within(detail).getByText('map-2.0.0')).toBeTruthy();
    expect(within(detail).getByText('a'.repeat(64))).toBeTruthy();
    expect(within(detail).queryAllByRole('textbox')).toHaveLength(0);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows an error when the detail request fails and recovers on re-selecting the version', async () => {
    const fails = new Set([id2]);
    setup({ detailFails: fails });
    render(<RoundAdminPage />);
    const list = await screen.findByRole('region', { name: 'Danh sách phiên bản, cuộn được' });
    // The page prefill also requests id2; only the archive click is checked here.
    fireEvent.click(within(list).getAllByRole('button')[0] as HTMLButtonElement);
    expect(await screen.findByText(/không thể tải phiên bản bộ luật/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /thử lại/i })).toBeNull();
    fails.clear();
    fireEvent.click(within(list).getAllByRole('button')[0] as HTMLButtonElement);
    expect(await screen.findByRole('heading', { name: 'Phiên bản v2' })).toBeTruthy();
  });

  it('uses a version as the base of the editor and shows a note', async () => {
    setup();
    render(<RoundAdminPage />);
    const list = await screen.findByRole('region', { name: 'Danh sách phiên bản, cuộn được' });
    const editor = screen.getByRole('region', { name: 'Phiên bản bộ luật mới' });
    expect((within(editor).getByLabelText(/engine version/i) as HTMLInputElement).value).toBe('2.0.0');
    fireEvent.click(within(list).getAllByRole('button')[1] as HTMLButtonElement);
    await screen.findByRole('heading', { name: 'Phiên bản v1' });
    fireEvent.click(screen.getByRole('button', { name: 'Dùng làm cơ sở cho phiên bản mới' }));
    await waitFor(() => expect((within(screen.getByRole('region', { name: 'Phiên bản bộ luật mới' })).getByLabelText(/engine version/i) as HTMLInputElement).value).toBe('1.0.0'));
    expect(screen.getByText('Đang soạn dựa trên v1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại bản hiện hành' }));
    expect(screen.queryByRole('heading', { name: 'Phiên bản v1' })).toBeNull();
  });
});
