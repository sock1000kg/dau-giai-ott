import type { ElementType, ReactNode } from 'react';

export interface CardProps {
  readonly as?: ElementType;
  readonly title?: string;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function Card({ as: Tag = 'section', title, children, className }: Readonly<CardProps>) {
  return (
    <Tag className={className === undefined ? 'ui-card' : `ui-card ${className}`}>
      {title !== undefined && <h2>{title}</h2>}
      {children}
    </Tag>
  );
}
