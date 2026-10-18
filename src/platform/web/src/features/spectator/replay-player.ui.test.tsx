import { createGame, DEFAULT_MAP, getGameResult, hashGameState, skipTurn } from '@ott/game-core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReplayPlayer } from './ReplayPlayer.tsx';
import type { SpectatorReplayV1 } from './replay-schema.ts';

const matchId = '00000000-0000-4000-8000-000000000001';

function replay(winnerSide: 'X' | 'O' | null = null): SpectatorReplayV1 {
  let state = createGame({ gameId: matchId, engineVersion: '1.0.0', map: DEFAULT_MAP, maxTurns: 2 });
  const entries: SpectatorReplayV1['entries'][number][] = [];
  for (const [index, side] of (['X', 'O'] as const).entries()) {
    const transition = skipTurn(state, side, 'NO_LEGAL_ACTION');
    if (!transition.ok) throw new Error('fixture transition failed');
    state = transition.state;
    entries.push({ index: index + 1, input: { kind: 'skip', side, reason: 'NO_LEGAL_ACTION' }, events: transition.events, revision: state.revision, stateHash: hashGameState(state) });
  }
  const result = getGameResult(state);
  if (result === null) throw new Error('fixture must be terminal');
  const lastEntry = entries.at(-1)!;
  if (winnerSide !== null) entries[entries.length - 1] = { ...lastEntry, events: [...lastEntry.events.slice(0, -1), { ...lastEntry.events.at(-1)!, side: winnerSide }] };
  return {
    schema: 'ott.spectator-replay', schemaVersion: 1, matchId,
    header: { format: 'ott.match-event-log', formatVersion: 1, matchId, protocolVersion: 1, engineVersion: '1.0.0', game: { engineVersion: '1.0.0', maxTurns: 2, map: DEFAULT_MAP } },
    entries,
    result: { ...result, winnerSide },
    faults: { X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null }, O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null } },
  };
}

afterEach(() => cleanup());

describe('replay player restyle', () => {
  it.each([
    ['X', 'Đội X thắng', ['Người thắng', 'Đối thủ']],
    ['O', 'Đội O thắng', ['Đối thủ', 'Người thắng']],
    [null, 'Hòa', ['Hòa', 'Hòa']],
  ] as const)('shows the outcome as text for winner %s', (winner, outcome, labels) => {
    render(<ReplayPlayer replay={replay(winner)} />);
    const result = screen.getByRole('article', { name: /kết quả trận đấu/i });
    expect(within(result).getByText(outcome)).toBeTruthy();
    const cards = ['Đội X', 'Đội O'].map((name) => screen.getByRole('heading', { name }).closest('article')!);
    expect(cards.map((card) => card.querySelector('p:last-child')!.textContent)).toEqual(labels);
    cards.forEach((card, index) => expect(card.className.includes('rp-team--winner')).toBe(winner === (index === 0 ? 'X' : 'O')));
  });

  it('keeps the header text, meta sentence and read-only badge', () => {
    render(<ReplayPlayer replay={replay()} />);
    expect(screen.getByRole('heading', { name: `Trận đấu ${matchId}` })).toBeTruthy();
    expect(screen.getByText(/Bản đồ default v1 · Engine 1\.0\.0 · 2 lượt/)).toBeTruthy();
    expect(screen.getByText('Chỉ xem')).toBeTruthy();
  });

  it('keeps board cell labels for goals, obstacles and pieces', () => {
    const { container } = render(<ReplayPlayer replay={replay()} />);
    const cells = Array.from(container.querySelectorAll('td')).map((cell) => cell.getAttribute('aria-label') ?? '');
    expect(cells).toHaveLength(81);
    expect(cells.some((label) => /đích Đội X/.test(label))).toBe(true);
    expect(cells.some((label) => /đích Đội O/.test(label))).toBe(true);
    expect(cells.some((label) => /Đội X - /.test(label))).toBe(true);
    expect(screen.getByRole('table', { name: /bàn cờ replay/i }).querySelector('caption')).toBeTruthy();
    if (DEFAULT_MAP.obstacles.length > 0) expect(cells.some((label) => /chướng ngại vật/.test(label))).toBe(true);
  });

  it('keeps accessible names for controls, seek range and speed select', () => {
    render(<ReplayPlayer replay={replay()} />);
    const controls = screen.getByRole('region', { name: /điều khiển replay/i });
    for (const name of ['Bắt đầu lại', 'Sự kiện trước', 'Phát', 'Sự kiện tiếp theo']) expect(within(controls).getByRole('button', { name })).toBeTruthy();
    expect(within(controls).getByRole('slider', { name: /chọn sự kiện/i })).toBeTruthy();
    expect(within(controls).getByRole('combobox', { name: /tốc độ phát/i })).toBeTruthy();
    expect(within(controls).getByText('Đang tạm dừng').getAttribute('role')).toBe('status');
  });

  it('uses a two-column stage with the move list in a bounded scroll card', () => {
    const { container } = render(<ReplayPlayer replay={replay()} />);
    const stage = container.querySelector('.rp-stage')!;
    expect(stage.children).toHaveLength(2);
    expect(stage.children[0]!.contains(screen.getByRole('table', { name: /bàn cờ/i }))).toBe(true);
    const moves = screen.getByRole('region', { name: /danh sách nước đi/i });
    expect(stage.children[1]!.contains(moves)).toBe(true);
    expect(moves.className).toContain('ui-card');
    expect(moves.querySelector('ol.rp-scroll')).toBeTruthy();
  });

  it('has a single level-2 title and no level-1 heading inside the player', () => {
    render(<ReplayPlayer replay={replay()} />);
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2, name: `Trận đấu ${matchId}` })).toBeTruthy();
  });

  it('moves aria-current in the move list with playback and seek', () => {
    render(<ReplayPlayer replay={replay()} />);
    const list = screen.getByRole('region', { name: /danh sách nước đi/i });
    const buttons = () => Array.from(list.querySelectorAll('button'));
    expect(buttons().map((b) => b.getAttribute('aria-current'))).toEqual([null, null]);
    fireEvent.click(screen.getByRole('button', { name: 'Sự kiện tiếp theo' }));
    expect(buttons().map((b) => b.getAttribute('aria-current'))).toEqual(['step', null]);
    fireEvent.change(screen.getByRole('slider', { name: /chọn sự kiện/i }), { target: { value: '3' } });
    expect(buttons().map((b) => b.getAttribute('aria-current'))).toEqual([null, 'step']);
  });
});
