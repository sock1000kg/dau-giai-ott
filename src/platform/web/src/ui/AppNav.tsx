import { useState, type KeyboardEvent } from 'react';
import { Alert, Badge } from './Alert.tsx';
import { Button } from './Button.tsx';
import { LOGOUT_FAILED_MESSAGE, useLogout } from './useLogout.ts';
import { ThemeToggle } from './ThemeToggle.tsx';

export type NavRole = 'BTC_ADMIN' | 'TEAM_ACCOUNT';

export interface NavItem {
  readonly label: string;
  readonly href: string;
  /** Extra path prefixes that also mark this item active. */
  readonly alsoActiveFor?: readonly string[];
}

const BTC_ITEMS: readonly NavItem[] = [
  { label: 'Tổng quan', href: '/' },
  { label: 'Đội thi', href: '/admin/teams' },
  { label: 'Round', href: '/admin/rounds' },
  { label: 'Đặc quyền', href: '/admin/operations' },
  { label: 'Kết quả', href: '/admin/results' },
  { label: 'Replay', href: '/admin/replays' },
];

const TEAM_ITEMS: readonly NavItem[] = [
  { label: 'Tổng quan', href: '/' },
  { label: 'Nộp bot', href: '/team/submissions' },
  { label: 'Kết quả', href: '/team/results', alsoActiveFor: ['/team/replays'] },
];

const HOME_PATHS = ['/', '/login', '/admin', '/team'];

export function navItemsFor(role: NavRole): readonly NavItem[] {
  return role === 'BTC_ADMIN' ? BTC_ITEMS : TEAM_ITEMS;
}

function underPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isActive(item: NavItem, pathname: string) {
  if (item.href === '/') return HOME_PATHS.includes(pathname);
  return underPrefix(pathname, item.href) || (item.alsoActiveFor ?? []).some((prefix) => underPrefix(pathname, prefix));
}

export interface AppNavProps {
  readonly role: NavRole;
  readonly pathname: string;
  readonly onLogout: () => Promise<void>;
}

export function AppNav({ role, pathname, onLogout }: Readonly<AppNavProps>) {
  const [open, setOpen] = useState(false);
  const { loggingOut, failed, logout } = useLogout(onLogout);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') setOpen(false);
  }

  return (
    <>
      <a className="ui-skip-link" href="#main">Bỏ qua điều hướng</a>
      <nav className="ui-appnav" aria-label="Điều hướng chính" data-open={open} onKeyDown={handleKeyDown}>
        <button type="button" className="ui-button ui-button--secondary ui-appnav-menu-toggle" aria-expanded={open} aria-controls="ui-appnav-links" onClick={() => setOpen((value) => !value)}>
          Menu
        </button>
        <ul id="ui-appnav-links" className="ui-appnav-links">
          {navItemsFor(role).map((item) => (
            <li key={item.href}>
              <a href={item.href} aria-current={isActive(item, pathname) ? 'page' : undefined}>{item.label}</a>
            </li>
          ))}
        </ul>
        <div className="ui-appnav-actions">
          <ThemeToggle />
          <Badge accent>{role === 'BTC_ADMIN' ? 'BTC' : 'Đội thi'}</Badge>
          <Button variant="ghost" loading={loggingOut} onClick={() => void logout()}>
            {loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </Button>
        </div>
        {failed && <Alert tone="danger">{LOGOUT_FAILED_MESSAGE}</Alert>}
      </nav>
    </>
  );
}
