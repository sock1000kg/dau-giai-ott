// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { LeaderboardPage } from './LeaderboardPage.tsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/'); });

describe('leaderboard wording', () => {
  it('explains rankings in plain Vietnamese and drops the developer-speak note', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } } }) }));
    render(<LeaderboardPage />);
    await screen.findByText('Chưa có dữ liệu bảng xếp hạng cho vòng đấu này.');
    expect(screen.getByText('Thứ hạng và Elo do hệ thống giải đấu tính từ kết quả đã chốt. Các đội bằng điểm được giữ cùng hạng; thứ tự cuối cùng khi chọn đội vào chung kết sẽ được công bố riêng.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/tie-break|trên trình duyệt|BTC cần quyết định/);
  });

  it('header leaderboard link is /leaderboard on every public page', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    for (const path of ['/leaderboard', '/public', '/']) {
      window.history.replaceState({}, '', path);
      const { unmount } = render(<App />);
      expect(screen.getByRole('link', { name: 'Bảng xếp hạng' }).getAttribute('href'), path).toBe('/leaderboard');
      unmount();
    }
  });
});
