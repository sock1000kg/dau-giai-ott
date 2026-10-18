import { cloneElement, useId, type ReactElement } from 'react';

export interface FieldProps {
  readonly label: string;
  readonly help?: string;
  readonly error?: string;
  readonly required?: boolean;
  /** Single form control (Input/Select/textarea); Field injects id, aria-describedby, aria-invalid and required. */
  readonly children: ReactElement<Record<string, unknown>>;
}

export function Field({ label, help, error, required, children }: Readonly<FieldProps>) {
  const base = useId();
  const controlId = (children.props.id as string | undefined) ?? `${base}-control`;
  const helpId = `${base}-help`;
  const errorId = `${base}-error`;
  const describedBy = [help !== undefined ? helpId : null, error !== undefined ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="ui-field">
      <label htmlFor={controlId}>{label}</label>
      {cloneElement(children, {
        id: controlId,
        required: required === true ? true : children.props.required,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error !== undefined ? true : undefined,
      })}
      {help !== undefined && <p id={helpId} className="ui-field-help">{help}</p>}
      {error !== undefined && <p id={errorId} className="ui-field-error">{error}</p>}
    </div>
  );
}
