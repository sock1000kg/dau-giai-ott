import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Alert, Button, Field, Input, Table } from './index.ts';

describe('Field', () => {
  it('links label, help and error to the control and marks it invalid', () => {
    render(<Field label="Tên đội" help="Tối đa 40 ký tự" error="Bắt buộc" required><Input /></Field>);
    const input = screen.getByLabelText('Tên đội');
    const describedBy = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(describedBy).toHaveLength(2);
    expect(document.getElementById(describedBy[0]!)?.textContent).toBe('Tối đa 40 ký tự');
    expect(document.getElementById(describedBy[1]!)?.textContent).toBe('Bắt buộc');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((input as HTMLInputElement).required).toBe(true);
  });

  it('omits aria attributes when there is no help or error', () => {
    render(<Field label="Mã"><Input /></Field>);
    const input = screen.getByLabelText('Mã');
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('Table', () => {
  it('renders caption and column headers with scope', () => {
    render(<Table caption="Danh sách" columns={[{ key: 'a', header: 'Tên', render: (row: { a: string }) => row.a }]} rows={[{ a: 'x' }]} rowKey={(row) => row.a} emptyMessage="Trống" />);
    expect(screen.getByText('Danh sách').tagName).toBe('CAPTION');
    expect(screen.getByRole('columnheader', { name: 'Tên' }).getAttribute('scope')).toBe('col');
    expect(screen.getByRole('cell', { name: 'x' })).toBeTruthy();
  });

  it('shows the empty state when there are no rows', () => {
    render(<Table caption="Danh sách" columns={[{ key: 'a', header: 'Tên', render: () => null }]} rows={[]} rowKey={() => 'k'} emptyMessage="Chưa có dữ liệu" />);
    expect(screen.getByText('Chưa có dữ liệu')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('Alert', () => {
  it.each([['danger', 'alert'], ['warning', 'alert'], ['info', 'status'], ['success', 'status']] as const)('maps %s to role %s', (tone, role) => {
    render(<Alert tone={tone}>nội dung</Alert>);
    expect(screen.getByRole(role).textContent).toBe('nội dung');
  });
});

describe('Button', () => {
  it('calls onClick once per click when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Lưu</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and ignores clicks while loading', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Lưu</Button>);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Lưu' });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('respects the disabled prop', () => {
    render(<Button disabled>Lưu</Button>);
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true);
  });
});
