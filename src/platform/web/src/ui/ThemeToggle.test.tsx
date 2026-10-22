import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle.tsx';
import { THEME_STORAGE_KEY } from './theme.ts';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
});
afterEach(() => vi.unstubAllGlobals());

describe('ThemeToggle', () => {
  it('exposes the selected mode and changes/persists it with a keyboard button', async () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(toggle, { key: 'Enter' });
    fireEvent.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chuyển sang giao diện tối' }).getAttribute('aria-pressed')).toBe('false'));
  });

  it('syncs a change made by another control or tab', async () => {
    render(<ThemeToggle />);
    document.documentElement.dataset.theme = 'light';
    document.dispatchEvent(new CustomEvent('ott-theme-change'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chuyển sang giao diện tối' }).getAttribute('aria-pressed')).toBe('false'));
  });
});
