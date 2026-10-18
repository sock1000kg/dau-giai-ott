import type { ReactNode } from 'react';
import { AppNav, type NavRole } from './AppNav.tsx';

export interface AppShellLayoutProps {
  readonly role: NavRole;
  readonly pathname: string;
  readonly onLogout: () => Promise<void>;
  readonly children: ReactNode;
}

/** Navigation plus the `#main` skip-link target; the wrapper never constrains page width. */
export function AppShellLayout({ role, pathname, onLogout, children }: Readonly<AppShellLayoutProps>) {
  return (
    <>
      <AppNav role={role} pathname={pathname} onLogout={onLogout} />
      <div id="main" className="ui-main">{children}</div>
    </>
  );
}
