import { createHash } from 'node:crypto';
import { createGame, DEFAULT_MAP, getGameResult, hashGameState, skipTurn } from '@ott/game-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivateReplayPage } from './PrivateReplayPage.tsx';
import { SpectatorReplayPage } from './SpectatorReplayPage.tsx';
import type { SpectatorReplayV1 } from '../features/spectator/replay-schema.ts';

const matchId = '00000000-0000-4000-8000-000000000001';

function body(): string {
  const state0 = createGame({ gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 1 });
  const t = skipTurn(state0, 'X', 'NO_LEGAL_ACTION');
  if (!t.ok) throw new Error('fixture');
  const result = getGameResult(t.state);
  if (result === null) throw new Error('fixture must be terminal');
  const replay: SpectatorReplayV1 = {
    schema: 'ott.spectator-replay', schemaVersion: 1, matchId,
    header: { format: 'ott.match-event-log', formatVersion: 1, matchId, protocolVersion: 1, engineVersion: '1.0.0', game: { engineVersion: '1.0.0', maxTurns: 1, map: DEFAULT_MAP } },
    entries: [{ index: 1, input: { kind: 'skip', side: 'X', reason: 'NO_LEGAL_ACTION' }, events: t.events, revision: t.state.revision, stateHash: hashGameState(t.state) }],
    result,
    faults: { X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null }, O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null } },
  };
  return `${JSON.stringify(replay, null, 2)}\n`;
}

function ok(): Response {
  const text = body();
  return new Response(text, { headers: { 'content-type': 'application/vnd.ott.spectator-replay+json;version=1', 'x-replay-sha256': `sha256:${createHash('sha256').update(text).digest('hex')}` } });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each([
  ['private', PrivateReplayPage, /REPLAY RIÊNG CỦA ĐỘI — chỉ hai đội trong trận và BTC xem được/, /KHÁN GIẢ/, 'không tồn tại hoặc bạn không có quyền xem'],
  ['public', SpectatorReplayPage, /KHÁN GIẢ · REPLAY CÔNG KHAI/, /REPLAY RIÊNG/, 'không tồn tại hoặc chưa được BTC công khai'],
] as const)('%s replay page', (_name, Page, eyebrow, otherEyebrow, notFound) => {
  it('shows eyebrow, h1, loading status then the player with meta text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()));
    render(<Page matchId={matchId} />);
    expect(screen.getByText(eyebrow)).toBeTruthy();
    expect(screen.queryByText(otherEyebrow)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Xem lại trận' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Đang tải và xác minh replay…');
    expect(await screen.findByRole('region', { name: /trình phát replay/i })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/Bản đồ default v1 · Engine 1\.0\.0 · 1 lượt/)).toBeTruthy();
  });

  it.each([
    [404, notFound],
    [500, 'Không thể tải replay lúc này. Vui lòng thử lại.'],
  ])('keeps the message for HTTP %s and retry refetches', async (status, message) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status })).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    render(<Page matchId={matchId} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(message);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('region', { name: /trình phát replay/i })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('SpectatorReplayPage uses bundle route when bundleId is provided or in URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    render(<SpectatorReplayPage matchId={matchId} bundleId="bundle-demo-99" />);
    expect(await screen.findByRole('region', { name: /trình phát replay/i })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/result-bundles/bundle-demo-99/replays/${matchId}`, { credentials: 'omit' });
  });

  it('SpectatorReplayPage reads ?bundle= from window.location.search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    try {
      window.history.replaceState({}, '', '/spectator/replays/00000000-0000-4000-8000-000000000001?bundle=bundle-from-url');
      render(<SpectatorReplayPage matchId={matchId} />);
      expect(await screen.findByRole('region', { name: /trình phát replay/i })).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/result-bundles/bundle-from-url/replays/${matchId}`, { credentials: 'omit' });
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });
});
