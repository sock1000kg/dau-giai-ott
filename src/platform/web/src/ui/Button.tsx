import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: ButtonVariant;
  /** While true the button is disabled, aria-busy and ignores clicks. */
  readonly loading?: boolean;
}

export function Button({ variant = 'primary', loading = false, disabled, onClick, type = 'button', children, ...rest }: Readonly<ButtonProps>) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading || disabled === true) return;
    onClick?.(event);
  }
  return (
    <button {...rest} type={type} className={`ui-button ui-button--${variant}`} disabled={disabled === true || loading} aria-busy={loading || undefined} onClick={handleClick}>
      {children}
    </button>
  );
}

export interface LinkButtonProps {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
  readonly 'aria-label'?: string;
}

/** A real <a> styled as a button, for navigation. */
export function LinkButton({ href, variant = 'primary', children, ...rest }: Readonly<LinkButtonProps>) {
  return <a {...rest} href={href} className={`ui-button ui-button--${variant}`}>{children}</a>;
}
