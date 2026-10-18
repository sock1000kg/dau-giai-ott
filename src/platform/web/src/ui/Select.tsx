import type { SelectHTMLAttributes } from 'react';

export function Select({ className, children, ...rest }: Readonly<SelectHTMLAttributes<HTMLSelectElement>>) {
  return <select {...rest} className={className === undefined ? 'ui-select' : `ui-select ${className}`}>{children}</select>;
}
