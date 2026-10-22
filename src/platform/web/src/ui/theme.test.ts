import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeTheme, selectTheme, THEME_STORAGE_KEY } from './theme.ts';

function createMediaQuery(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const queryText = '(prefers-color-scheme: dark)';
  let matches = initial;
  const query = {
    get matches() { return matches; },
    media: queryText,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
    change(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next, media: queryText } as MediaQueryListEvent);
    },
  } as unknown as MediaQueryList & { change(matches: boolean): void };
  return query;
}

describe('theme preference', () => {
  let media: ReturnType<typeof createMediaQuery>;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    media = createMediaQuery(false);
    vi.stubGlobal('matchMedia', vi.fn(() => media));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.unstubAllGlobals();
  });

  it('follows the OS when there is no saved choice and tracks OS changes', () => {
    cleanup = initializeTheme(window, document);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');

    media.change(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('uses a saved choice over the OS preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    media.change(true);

    cleanup = initializeTheme(window, document);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persists an explicit choice and ignores later OS changes', () => {
    cleanup = initializeTheme(window, document);
    selectTheme('dark', window, document);

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    media.change(false);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('syncs another tab selection and returns to OS mode when preference is cleared', () => {
    cleanup = initializeTheme(window, document);
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');

    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: null }));
    expect(document.documentElement.dataset.theme).toBe('light');
    media.change(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores invalid stored values and supports only light and dark', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    media.change(true);
    cleanup = initializeTheme(window, document);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
