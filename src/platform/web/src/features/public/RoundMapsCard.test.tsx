import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoundMapsCard } from './RoundMapsCard.tsx';
import type { PublicSnapshot } from './snapshot.ts';

const sampleRules = (sections: PublicSnapshot['rules']['sections'] = []): PublicSnapshot['rules'] => ({
  version: '1',
  engineVersion: '1.0.0',
  sections,
});

describe('RoundMapsCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders clear empty state when no maps are available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no endpoint')));
    render(<RoundMapsCard rules={sampleRules()} />);
    expect(await screen.findByText('Chưa công bố bản đồ.')).toBeTruthy();
  });

  it('uses snapshot "Bàn cờ đã khóa" fallback when endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no endpoint')));
    const mapDef = {
      mapId: 'default',
      version: 1,
      checksum: 'a'.repeat(64),
      width: 9,
      height: 9,
      obstacles: [],
      spawns: [{ id: 'X-ROCK-1', owner: 'X', type: 'ROCK', position: { col: 0, row: 3 } }],
      goals: { X: { col: 8, row: 8 }, O: { col: 0, row: 0 } },
    };
    const rules = sampleRules([
      { title: 'Bàn cờ đã khóa', body: JSON.stringify([mapDef]) },
    ]);

    render(<RoundMapsCard rules={rules} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'default' })).toBeTruthy();
    expect(screen.getByText('Phiên bản 1')).toBeTruthy();

    const downloadLink = screen.getByRole('link', { name: 'Tải bản đồ (.json)' });
    expect(downloadLink.getAttribute('href')).toBe(`/api/v1/public/maps/default?checksum=${'a'.repeat(64)}`);
    expect(downloadLink.getAttribute('download')).toBe('default.json');

    const preview = screen.getByRole('region', { name: 'Bàn cờ default' });
    expect(preview).toBeTruthy();
  });

  it('loads maps from /api/v1/public/rounds/current/maps when available', async () => {
    const mapData = {
      mapId: 'arena-v1',
      version: 2,
      checksum: 'b'.repeat(64),
      definition: {
        width: 5,
        height: 5,
        obstacles: [{ col: 2, row: 2 }],
        spawns: [],
        goals: {},
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ maps: [mapData] }),
      }),
    );

    render(<RoundMapsCard rules={sampleRules()} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'arena-v1' })).toBeTruthy();
    expect(screen.getByText('Phiên bản 2')).toBeTruthy();
  });

  it('handles unregistered maps without rendering preview or download link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no endpoint')));
    const unregisteredMap = {
      mapId: 'custom-unregistered',
      checksum: 'd'.repeat(64),
      error: 'không có định nghĩa trong danh mục',
    };
    const rules = sampleRules([
      { title: 'Bàn cờ đã khóa', body: JSON.stringify([unregisteredMap]) },
    ]);

    render(<RoundMapsCard rules={rules} />);
    expect(await screen.findByText('không có định nghĩa trong danh mục')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Tải bản đồ (.json)' })).toBeNull();
    expect(screen.queryByRole('region', { name: /Bàn cờ/ })).toBeNull();
  });
});
