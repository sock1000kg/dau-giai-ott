import type { ReactNode } from 'react';

export interface PageProps {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
}

export function Page({ title, description, actions, children }: Readonly<PageProps>) {
  return (
    <main className="ui-page">
      <div className="ui-toolbar">
        <header className="ui-page-header">
          <h1>{title}</h1>
          {description !== undefined && <p>{description}</p>}
        </header>
        {actions}
      </div>
      {children}
    </main>
  );
}
