import { createHash } from 'node:crypto';
import { createGame, DEFAULT_MAP, getGameResult, hashGameState, skipTurn } from '@ott/game-core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { ReplayPlayer } from './ReplayPlayer.tsx';
import { createReplayMoves, createReplayTimeline } from './replay-state.ts';
import { verifyReplayResponse } from './verify-replay.ts';
import type { SpectatorReplay, SpectatorReplayV1, SpectatorReplayV2 } from './replay-schema.ts';

const matchId = '00000000-0000-4000-8000-000000000001';
const fullscreenElementDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
const exitFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');

function replayBody(): string {
  const config = { gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 2 };
  let state = createGame(config);
  const entries: SpectatorReplayV1['entries'][number][] = [];
  const turns = [
    { kind: 'skip' as const, side: 'X' as const, reason: 'NO_LEGAL_ACTION' as const },
    { kind: 'skip' as const, side: 'O' as const, reason: 'NO_LEGAL_ACTION' as const },
  ];
  for (const [index, input] of turns.entries()) {
    const transition = input.kind === 'skip' ? skipTurn(state, input.side, input.reason) : null;
    if (transition === null || !transition.ok) throw new Error('fixture transition failed');
    state = transition.state;
    entries.push({ index: index + 1, input, events: transition.events, revision: state.revision, stateHash: hashGameState(state) });
  }
  const result = getGameResult(state);
  if (result === null) throw new Error('fixture must be terminal');
  const replay: SpectatorReplayV1 = {
    schema: 'ott.spectator-replay', schemaVersion: 1, matchId,
    header: { format: 'ott.match-event-log', formatVersion: 1, matchId, protocolVersion: 1, engineVersion: '1.0.0', game: { engineVersion: '1.0.0', maxTurns: 2, map: DEFAULT_MAP } },
    entries,
    result,
    faults: { X: { recoverableTotal: 1, recoverableConsecutive: 0, lastErrorCode: 'BOT_TIMEOUT' }, O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null } },
  };
  return `${JSON.stringify(replay, null, 2)}\n`;
}

function replayV2Fixture(): SpectatorReplayV2 {
  const v1 = JSON.parse(replayBody()) as SpectatorReplayV1;
  return {
    ...v1,
    schemaVersion: 2,
    header: {
      ...v1.header,
      formatVersion: 2,
      protocolVersion: 2,
      limits: {
        timeControl: {
          startupMs: 2000,
          totalBotBudgetMs: 30000,
          matchWallClockMs: 60000,
          perTurn: { mode: 'FIXED', fixedMs: 1000 },
        },
      },
    },
    timing: [
      {
        turnId: 1,
        side: 'X',
        turnLimitMs: 1000,
        deadlineMs: 1000,
        remainingBeforeMs: 30000,
        wallElapsedBeforeMs: 0,
        elapsedMs: 120,
        timedOut: false,
        chargedMs: 120,
        remainingAfterMs: 29880,
        exhaustion: null,
      },
      {
        turnId: 2,
        side: 'O',
        turnLimitMs: 1000,
        deadlineMs: 1000,
        remainingBeforeMs: 30000,
        wallElapsedBeforeMs: 120,
        elapsedMs: 250,
        timedOut: false,
        chargedMs: 250,
        remainingAfterMs: 29750,
        exhaustion: null,
      },
    ],
  };
}

function publicResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'application/vnd.ott.spectator-replay+json;version=1',
      'x-replay-sha256': `sha256:${createHash('sha256').update(body).digest('hex')}`,
    },
  });
}

function v2Response(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'application/vnd.ott.spectator-replay+json;version=2',
      'x-replay-sha256': `sha256:${createHash('sha256').update(body).digest('hex')}`,
    },
  });
}

async function verifiedReplay(): Promise<SpectatorReplayV1> {
  return verifyReplayResponse(publicResponse(replayBody())) as Promise<SpectatorReplayV1>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (fullscreenElementDescriptor) Object.defineProperty(document, 'fullscreenElement', fullscreenElementDescriptor);
  else Reflect.deleteProperty(document, 'fullscreenElement');
  if (exitFullscreenDescriptor) Object.defineProperty(document, 'exitFullscreen', exitFullscreenDescriptor);
  else Reflect.deleteProperty(document, 'exitFullscreen');
  window.history.replaceState({}, '', '/');
});

describe('spectator replay player', () => {
  it('rejects an unsupported historical engine even when its transport checksum is correct', async () => {
    const future = JSON.parse(replayBody());
    future.header.engineVersion = '99.0.0'; future.header.game.engineVersion = '99.0.0';
    await expect(verifyReplayResponse(publicResponse(JSON.stringify(future)))).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' });
  });
  it('does not reconstruct an unknown engine with the current event adapter', async () => {
    const replay = await verifiedReplay();
    expect(() => createReplayTimeline({ ...replay, header: { ...replay.header, engineVersion: '99.0.0',
      game: { ...replay.header.game, engineVersion: '99.0.0' } } })).toThrow();
  });
  it('seeks each move to the end of its recorded entry and supports keyboard navigation', async () => {
    render(<ReplayPlayer replay={await verifiedReplay()} />);
    const moves = screen.getByRole('region', { name: /danh sách nước đi/i });
    const buttons = Array.from(moves.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    expect(screen.getByText(/sự kiện 1 \/ 3/i)).toBeTruthy();
    expect(buttons[0]!.getAttribute('aria-current')).toBe('step');
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]);
    expect(screen.getByText(/sự kiện 3 \/ 3/i)).toBeTruthy();
    expect(buttons[1]!.getAttribute('aria-current')).toBe('step');
    fireEvent.keyDown(buttons[1]!, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.change(screen.getByRole('slider', { name: /chọn sự kiện/i }), { target: { value: '2' } });
    expect(buttons[1]!.getAttribute('aria-current')).toBe('step');
  });
  it('builds repeatable board frames from the recorded events', async () => {
    const replay = await verifiedReplay();
    const first = createReplayTimeline(replay);
    const second = createReplayTimeline(replay);
    expect(first.events.map((item) => item.event.sequence)).toEqual([0, 2, 3]);
    expect(first.frames).toHaveLength(first.events.length + 1);
    expect(first.frames).toEqual(second.frames);
    expect(first.frames.at(-1)?.finished).toBe(true);
  });

  it('opens presentation mode and starts playback from the fullscreen button', async () => {
    render(<ReplayPlayer replay={await verifiedReplay()} />);
    const player = screen.getByRole('region', { name: 'Trình phát replay' });
    const requestFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(player, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    fireEvent.click(screen.getByRole('button', { name: /sự kiện tiếp theo/i }));
    expect(screen.getByText(/sự kiện 1 \/ 3/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trình chiếu toàn màn hình' }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(await screen.findByText('Đang phát · 1x')).toBeTruthy();
    expect(screen.getByText(/sự kiện 1 \/ 3/i)).toBeTruthy();
    expect(screen.getByText(/trận này không có nước đi hợp lệ/i)).toBeTruthy();
  });

  it('restarts a finished replay when entering presentation mode', async () => {
    render(<ReplayPlayer replay={await verifiedReplay()} />);
    const player = screen.getByRole('region', { name: 'Trình phát replay' });
    const requestFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(player, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    fireEvent.change(screen.getByRole('slider', { name: /chọn sự kiện/i }), { target: { value: '3' } });
    expect(screen.getByText(/đã hết replay/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trình chiếu toàn màn hình' }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(await screen.findByText('Đang phát · 1x')).toBeTruthy();
    expect(screen.getByRole('slider', { name: /chọn sự kiện/i })).toHaveProperty('value', '0');
  });

  it('syncs the fullscreen button when the browser exits through Escape', async () => {
    render(<ReplayPlayer replay={await verifiedReplay()} />);
    const player = screen.getByRole('region', { name: 'Trình phát replay' });
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = player;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    Object.defineProperty(player, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });

    fireEvent.click(screen.getByRole('button', { name: 'Trình chiếu toàn màn hình' }));
    expect(await screen.findByRole('button', { name: 'Thoát toàn màn hình' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thoát toàn màn hình' }));
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Trình chiếu toàn màn hình' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Trình chiếu toàn màn hình' }));
    expect(await screen.findByRole('button', { name: 'Thoát toàn màn hình' })).toBeTruthy();
    act(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(screen.getByRole('button', { name: 'Trình chiếu toàn màn hình' })).toBeTruthy();
  });

  it('plays, pauses, seeks events, changes speed, and stops deterministically at replay end', async () => {
    vi.useFakeTimers();
    const replay = await verifiedReplay();
    render(<ReplayPlayer replay={replay} />);
    expect(screen.getByRole('button', { name: /^phát$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /sự kiện tiếp theo/i }));
    expect(screen.getByText(/sự kiện 1 \/ 3/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /tiếp tục/i }));
    expect(screen.getByRole('button', { name: /tạm dừng/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /tạm dừng/i }));
    expect(screen.getByRole('button', { name: /tiếp tục/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/tốc độ phát/i), { target: { value: '2' } });
    expect(screen.getByLabelText(/tốc độ phát/i)).toHaveProperty('value', '2');
    fireEvent.change(screen.getByLabelText(/tốc độ phát/i), { target: { value: '0.5' } });
    expect(screen.getByLabelText(/tốc độ phát/i)).toHaveProperty('value', '0.5');
    fireEvent.change(screen.getByLabelText(/tốc độ phát/i), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('slider', { name: /chọn sự kiện/i }), { target: { value: '3' } });
    expect(screen.getByText(/sự kiện 3 \/ 3/i)).toBeTruthy();
    expect(screen.getByText(/đã hết replay/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /tiếp tục/i }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /bắt đầu lại/i }));
    expect(screen.getByText('0 / 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^phát$/i }));
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(screen.getByText(/sự kiện 3 \/ 3/i)).toBeTruthy();
  });

  it('presents teams, map, action timeline, fault summary, and final result accessibly', async () => {
    render(<ReplayPlayer replay={await verifiedReplay()} />);
    expect(screen.getByRole('heading', { name: /đội x/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /đội o/i })).toBeTruthy();
    expect(screen.getByRole('table', { name: /bàn cờ/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /tóm tắt fault/i })).toBeTruthy();
    expect(screen.getAllByText(/turn limit/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: /dòng sự kiện/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /điều khiển trận|kết nối trực tiếp/i })).toBeNull();
  });

  it('opens a public replay URL without starting an authentication session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(publicResponse(replayBody()));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', `/spectator/replays/${matchId}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: /xem lại trận/i })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/public/replays/${matchId}`, { credentials: 'omit' });
  });

  it('does not accept a timeline whose recorded events disagree with canonical engine output', async () => {
    const replay = await verifiedReplay();
    const tamperedEvents = replay.entries.map((entry, index) => index === 0
      ? { ...entry, events: [{ ...entry.events[0]!, reason: 'BOT_TIMEOUT' as const }] }
      : entry);
    expect(() => createReplayTimeline({ ...replay, entries: tamperedEvents })).toThrow(/cannot be reproduced/i);
  });

  it('creates timeline and moves over a v2 replay with matching final state hash', () => {
    const replayV2 = replayV2Fixture();
    const timeline = createReplayTimeline(replayV2);
    const moves = createReplayMoves(replayV2);
    expect(moves).toHaveLength(replayV2.entries.length);
    expect(timeline.frames).toHaveLength(timeline.events.length + 1);
    expect(timeline.frames.at(-1)?.finished).toBe(true);
    expect(replayV2.entries.at(-1)?.stateHash).toBe(replayV2.result.finalStateHash);
  });

  it('surfaces the timing line for v2 replay active events and omits it for v1 replay', async () => {
    // 1. v2 replay: timing line appears when an event is selected
    const replayV2 = replayV2Fixture();
    const { unmount } = render(<ReplayPlayer replay={replayV2} />);
    fireEvent.click(screen.getByRole('button', { name: /sự kiện tiếp theo/i }));
    expect(screen.getByText(/Thời gian:\s*120ms\s*·\s*Còn:\s*29880ms/i)).toBeTruthy();

    const moves = screen.getByRole('region', { name: /danh sách nước đi/i });
    const buttons = Array.from(moves.querySelectorAll('button'));
    fireEvent.click(buttons[1]!);
    expect(screen.getByText(/Thời gian:\s*250ms\s*·\s*Còn:\s*29750ms/i)).toBeTruthy();
    unmount();

    // 2. v1 replay: timing line does not appear
    const replayV1 = await verifiedReplay();
    render(<ReplayPlayer replay={replayV1} />);
    fireEvent.click(screen.getByRole('button', { name: /sự kiện tiếp theo/i }));
    expect(screen.queryByText(/Thời gian:/i)).toBeNull();
  });

  it('shows team names with their side when a v2 replay carries them', () => {
    const replay: SpectatorReplayV2 = { ...replayV2Fixture(), teams: { X: { name: 'Sấm Sét' }, O: { name: '<img src=x onerror=alert(1)>' } } };
    const { container } = render(<ReplayPlayer replay={replay} />);
    expect(screen.getByRole('heading', { name: 'Sấm Sét (X)' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '<img src=x onerror=alert(1)> (O)' })).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Đội X' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /sự kiện tiếp theo/i }));
    expect(screen.getByRole('region', { name: 'Sự kiện đang phát' }).textContent).toContain('Sấm Sét (X) · lượt 1');
    const moves = screen.getByRole('region', { name: /danh sách nước đi/i });
    expect(moves.textContent).toContain('Sấm Sét (X) · lượt 1');
  });

  it('keeps the Đội X / Đội O labels when the replay has no team names', () => {
    render(<ReplayPlayer replay={replayV2Fixture()} />);
    expect(screen.getByRole('heading', { name: 'Đội X' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Đội O' })).toBeTruthy();
  });

  it('parses optional teams on v2 and rejects malformed teams', async () => {
    const withTeams = { ...replayV2Fixture(), teams: { X: { name: 'A' }, O: { name: 'B' } } };
    const parsed = await verifyReplayResponse(v2Response(JSON.stringify(withTeams))) as SpectatorReplayV2;
    expect(parsed.teams).toEqual({ X: { name: 'A' }, O: { name: 'B' } });
    const bad: unknown[] = [
      { X: { name: 'A' } },
      { X: { name: '' }, O: { name: 'B' } },
      { X: { name: 'A', id: 'team-1' }, O: { name: 'B' } },
      { X: 'A', O: 'B' },
      { X: { name: 'A' }, O: { name: 'B' }, Z: { name: 'C' } },
      { X: { name: 'A'.repeat(400) }, O: { name: 'B' } },
      'A vs B',
    ];
    for (const teams of bad) {
      await expect(verifyReplayResponse(v2Response(JSON.stringify({ ...replayV2Fixture(), teams })))).rejects.toMatchObject({ code: 'INVALID_REPLAY' });
    }
  });
});
