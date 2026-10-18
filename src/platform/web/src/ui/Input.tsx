import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

function join(base: string, extra?: string) {
  return extra === undefined ? base : `${base} ${extra}`;
}

export function Input({ className, ...rest }: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  return <input {...rest} className={join('ui-input', className)} />;
}

export function Textarea({ className, ...rest }: Readonly<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  return <textarea {...rest} className={join('ui-textarea', className)} />;
}
