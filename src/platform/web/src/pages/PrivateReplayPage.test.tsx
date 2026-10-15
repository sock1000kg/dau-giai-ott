// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { PrivateReplayPage } from './PrivateReplayPage.tsx';

const matchId = '00000000-0000-4000-8000-000000000001';

function validReplay() {
  return {
    schema: 'ott.spectator-replay',
    schemaVersion: 1,
    matchId,
    header: {
      format: 'ott.match-event-log',
      formatVersion: 1,
      matchId,
      protocolVersion: 1,
      engineVersion: '1.0.0',
      game: {
        engineVersion: '1.0.0',
        maxTurns: 1,
        map: {
          schemaVersion: 1,
          mapId: 'default',
          version: 1,
          checksum: 'a'.repeat(64),
          width: 9,
          height: 9,
          obstacles: [],
          spawns: [{ id: 'x-1', owner: 'X', type: 'ROCK', position: { col: 1, row: 1 } }],
          goals: { X: { col: 0, row: 0 }, O: { col: 8, row: 8 } },
        },
      },
    },
    entries: [{
      index: 1,
      input: { kind: 'skip', side: 'X', reason: 'NO_LEGAL_ACTION' },
      events: [
        { sequence: 0, revision: 1, turnId: 1, type: 'TURN_SKIPPED', side: 'X', action: null, reason: 'NO_LEGAL_ACTION' },
        { sequence: 1, revision: 1, turnId: 1, type: 'MATCH_FINISHED', side: 'X', action: null, reason: 'TURN_LIMIT' },
      ],
      revision: 1,
      stateHash: 'b'.repeat(64),
    }],
    result: { winnerSide: null, reason: 'TURN_LIMIT', turnCount: 1, forfeitedSide: null, finalStateHash: 'b'.repeat(64) },
    faults: {
      X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
      O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
    },
  };
}

function response(body: string, status = 200): Response {
  const checksum = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/vnd.ott.spectator-replay+json;version=1',
      'x-replay-sha256': checksum,
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PrivateReplayPage', () => {
  it('renders loading state and displays verified replay in player', async () => {
    const body = `${JSON.stringify(validReplay(), null, 2)}\n`;
    const fetchMock = vi.fn().mockResolvedValue(response(body));
    vi.stubGlobal('fetch', fetchMock);

    render(<PrivateReplayPage matchId={matchId} />);
    expect(screen.getByText(/REPLAY RIÊNG CỦA ĐỘI — chỉ hai đội trong trận và BTC xem được/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Đang tải');

    expect(await screen.findByRole('region', { name: /trình phát replay/i })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/replays/${matchId}`, { credentials: 'include' });
  });

  it('renders error notice and permits retry when replay is forbidden or missing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(response(`${JSON.stringify(validReplay(), null, 2)}\n`));
    vi.stubGlobal('fetch', fetchMock);

    render(<PrivateReplayPage matchId={matchId} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('không tồn tại hoặc bạn không có quyền xem');

    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('region', { name: /trình phát replay/i })).toBeTruthy();
  });

  it('displays session expired message when 401 unauthenticated', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<PrivateReplayPage matchId={matchId} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Phiên đăng nhập đã hết hạn');
  });
});
