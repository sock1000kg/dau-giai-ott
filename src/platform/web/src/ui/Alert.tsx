import type { ReactNode } from 'react';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  readonly tone?: AlertTone;
  readonly children: ReactNode;
}

export function Alert({ tone = 'info', children }: Readonly<AlertProps>) {
  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status';
  return <div role={role} className={`ui-alert ui-alert--${tone}`}>{children}</div>;
}

export function Badge({ children, accent = false }: Readonly<{ children: ReactNode; accent?: boolean }>) {
  return <span className={accent ? 'ui-badge ui-badge--accent' : 'ui-badge'}>{children}</span>;
}
