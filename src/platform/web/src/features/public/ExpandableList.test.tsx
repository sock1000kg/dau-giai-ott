import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExpandableList } from './ExpandableList.tsx';

const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
function list(items: number[], extra: { scrollMaxHeight?: number } = {}) {
  return <ExpandableList items={items} initial={10} step={20} label="Danh sách thử" emptyText="Trống." listTag="ul" summary={`${items.length} mục`}
    renderItem={(n) => <li key={n}>item {n}</li>} {...extra} />;
}
const shown = () => screen.queryAllByRole('listitem').length;
afterEach(cleanup);

describe('ExpandableList', () => {
  it('shows `initial` items, reveals `step` more and updates the remaining count', () => {
    render(list(nums(50)));
    expect(shown()).toBe(10);
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm (40 còn lại)' }));
    expect(shown()).toBe(30);
    expect(screen.getByRole('button', { name: 'Xem thêm (20 còn lại)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm (20 còn lại)' }));
    expect(shown()).toBe(50);
    expect(screen.queryByRole('button', { name: /Xem thêm/ })).toBeNull();
  });

  it('collapses back to `initial` with Thu gọn', () => {
    render(list(nums(50)));
    expect(screen.queryByRole('button', { name: 'Thu gọn' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Xem thêm/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn' }));
    expect(shown()).toBe(10);
    expect(screen.queryByRole('button', { name: 'Thu gọn' })).toBeNull();
  });

  it('has no buttons when items fit in `initial`, and shows the empty text for no items', () => {
    render(list(nums(10)));
    expect(shown()).toBe(10);
    expect(screen.queryAllByRole('button').length).toBe(0);
    cleanup();
    render(list([]));
    expect(screen.getByText('Trống.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('wires aria-expanded and aria-controls to the list id', () => {
    render(list(nums(50)));
    const more = screen.getByRole('button', { name: /Xem thêm/ });
    const id = screen.getByRole('list').id;
    expect(id).not.toBe('');
    expect(more.getAttribute('aria-controls')).toBe(id);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    const less = screen.getByRole('button', { name: 'Thu gọn' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    expect(less.getAttribute('aria-controls')).toBe(id);
    expect(screen.getByRole('button', { name: /Xem thêm/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('clamps when items shrink and keeps state when replaced by a same or longer array', () => {
    const { rerender } = render(list(nums(50)));
    fireEvent.click(screen.getByRole('button', { name: /Xem thêm/ }));
    expect(shown()).toBe(30);
    rerender(list(nums(50)));
    expect(shown()).toBe(30);
    rerender(list(nums(60)));
    expect(shown()).toBe(30);
    expect(screen.getByRole('button', { name: 'Xem thêm (30 còn lại)' })).toBeTruthy();
    rerender(list(nums(15)));
    expect(shown()).toBe(15);
    expect(screen.queryByRole('button', { name: /Xem thêm/ })).toBeNull();
    rerender(list(nums(8)));
    expect(shown()).toBe(8);
    expect(screen.queryAllByRole('button').length).toBe(0);
  });

  it('keeps focus on a button after clicking', () => {
    render(list(nums(25)));
    const more = screen.getByRole('button', { name: /Xem thêm/ });
    more.focus();
    fireEvent.click(more);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Thu gọn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Xem thêm/ }));
  });

  it('wraps the list in a focusable labelled region only when a max height is given', () => {
    render(list(nums(5), { scrollMaxHeight: 480 }));
    const region = screen.getByRole('region', { name: 'Danh sách thử' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.style.maxHeight).toBe('480px');
    cleanup();
    render(list(nums(5)));
    expect(screen.queryByRole('region')).toBeNull();
  });
});
