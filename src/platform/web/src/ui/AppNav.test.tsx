import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppNav } from './AppNav.tsx';

const noop = () => Promise.resolve();

function links() {
  return screen.getAllByRole('link').filter((link) => link.closest('.ui-appnav-links') !== null);
}

describe('AppNav', () => {
  it('renders exactly the BTC link set', () => {
    render(<AppNav role="BTC_ADMIN" pathname="/" onLogout={noop} />);
    expect(links().map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Tổng quan', '/'], ['Đội thi', '/admin/teams'], ['Round', '/admin/rounds'],
      ['Đặc quyền', '/admin/operations'], ['Kết quả', '/admin/results'], ['Replay', '/admin/replays'],
    ]);
  });

  it('renders exactly the team link set', () => {
    render(<AppNav role="TEAM_ACCOUNT" pathname="/" onLogout={noop} />);
    expect(links().map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Tổng quan', '/'], ['Nộp bot', '/team/submissions'], ['Kết quả', '/team/results'],
    ]);
  });

  function current(role: 'BTC_ADMIN' | 'TEAM_ACCOUNT', pathname: string) {
    const { unmount } = render(<AppNav role={role} pathname={pathname} onLogout={noop} />);
    const result = links().filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.textContent);
    unmount();
    return result;
  }

  it('marks only the matching link as current', () => {
    expect(current('BTC_ADMIN', '/')).toEqual(['Tổng quan']);
    expect(current('BTC_ADMIN', '/admin')).toEqual(['Tổng quan']);
    expect(current('BTC_ADMIN', '/admin/rounds')).toEqual(['Round']);
    expect(current('BTC_ADMIN', '/admin/replays')).toEqual(['Replay']);
    expect(current('BTC_ADMIN', '/admin/replays/m1/view')).toEqual(['Replay']);
    expect(current('TEAM_ACCOUNT', '/team/replays/m1')).toEqual(['Kết quả']);
    expect(current('TEAM_ACCOUNT', '/team/submissions')).toEqual(['Nộp bot']);
    expect(current('TEAM_ACCOUNT', '/team/unknown')).toEqual([]);
  });

  it('calls onLogout once and shows a failure alert', async () => {
    const onLogout = vi.fn().mockRejectedValue(new Error('x'));
    render(<AppNav role="BTC_ADMIN" pathname="/" onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Không thể đăng xuất lúc này. Vui lòng thử lại.');
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('shows the role badge and a skip link to #main', () => {
    render(<AppNav role="TEAM_ACCOUNT" pathname="/" onLogout={noop} />);
    expect(screen.getByText('Đội thi', { selector: '.ui-badge' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bỏ qua điều hướng' }).getAttribute('href')).toBe('#main');
  });

  it('toggles the mobile menu with a button and closes on Escape', async () => {
    render(<AppNav role="BTC_ADMIN" pathname="/" onLogout={noop} />);
    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(toggle, { key: 'Escape' });
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
  });
});
