import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

describe('App shell', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders an accessible login shell for an anonymous session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'UNAUTHENTICATED' } }),
    }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: /đăng nhập/i })).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('link', { name: /giải đấu ott - trang chủ/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('button', { name: 'Chuyển sang giao diện sáng' }).getAttribute('aria-pressed')).toBe('true');
  });
});
