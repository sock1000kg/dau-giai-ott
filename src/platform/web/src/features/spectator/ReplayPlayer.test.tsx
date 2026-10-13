import { createHash } from 'node:crypto';
import { createGame, DEFAULT_MAP, getGameResult, hashGameState, skipTurn } from '@ott/game-core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../app/App.tsx';
import { ReplayPlayer } from './ReplayPlayer.tsx';
import { createReplayTimeline } from './replay-state.ts';
import { verifyReplayResponse } from './verify-replay.ts';
import type { SpectatorReplayV1 } from './replay-schema.ts';

const matchId = '00000000-0000-4000-8000-000000000001';

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

function publicResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'content-type': 'application/vnd.ott.spectator-replay+json;version=1',
      'x-replay-sha256': `sha256:${createHash('sha256').update(body).digest('hex')}`,
    },
  });
}

async function verifiedReplay(): Promise<SpectatorReplayV1> {
  return verifyReplayResponse(publicResponse(replayBody()));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('spectator replay player', () => {
  it('builds repeatable board frames from the recorded events', async () => {
    const replay = await verifiedReplay();
    const first = createReplayTimeline(replay);
    const second = createReplayTimeline(replay);
    expect(first.events.map((item) => item.event.sequence)).toEqual([0, 2, 3]);
    expect(first.frames).toHaveLength(first.events.length + 1);
    expect(first.frames).toEqual(second.frames);
    expect(first.frames.at(-1)?.finished).toBe(true);
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
});
