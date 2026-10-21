import { applyAction, createGame, DEFAULT_MAP, getGameResult, hashGameState, skipTurn } from '@ott/game-core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReplayPlayer } from './ReplayPlayer.tsx';
import type { SpectatorMapV1, SpectatorReplayV1 } from './replay-schema.ts';

const matchId = '00000000-0000-4000-8000-000000000001';

function replay(winnerSide: 'X' | 'O' | null = null, map: SpectatorMapV1 = DEFAULT_MAP): SpectatorReplayV1 {
  let state = createGame({ gameId: matchId, engineVersion: '1.0.0', map, maxTurns: 2 });
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
    header: { format: 'ott.match-event-log', formatVersion: 1, matchId, protocolVersion: 1, engineVersion: '1.0.0', game: { engineVersion: '1.0.0', maxTurns: 2, map } },
    entries,
    result: { ...result, winnerSide },
    faults: { X: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null }, O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null } },
  };
}

function captureReplay(): SpectatorReplayV1 {
  const map: SpectatorMapV1 = {
    ...DEFAULT_MAP,
    spawns: [
      { id: 'x-rock', owner: 'X', type: 'ROCK', position: { col: 2, row: 2 } },
      { id: 'o-scissors', owner: 'O', type: 'SCISSORS', position: { col: 3, row: 2 } },
    ],
  };
  const state = createGame({ gameId: matchId, engineVersion: '1.0.0', map, maxTurns: 10 });
  const action = { pieceId: 'x-rock', to: { col: 3, row: 2 } };
  const transition = applyAction(state, 'X', action);
  if (!transition.ok || transition.result === null) throw new Error('capture fixture transition failed');
  return {
    schema: 'ott.spectator-replay', schemaVersion: 1, matchId,
    header: { format: 'ott.match-event-log', formatVersion: 1, matchId, protocolVersion: 1, engineVersion: '1.0.0', game: { engineVersion: '1.0.0', maxTurns: 10, map } },
    entries: [{ index: 1, input: { kind: 'apply', side: 'X', action }, events: transition.events, revision: transition.state.revision, stateHash: hashGameState(transition.state) }],
    result: transition.result,
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

  it('renders the reference hand tokens with accessible names and in-cell coordinates', () => {
    const { container } = render(<ReplayPlayer replay={replay()} />);
    const table = screen.getByRole('table', { name: /bàn cờ replay/i });
    const cells = Array.from(table.querySelectorAll('td'));
    const pieces = Array.from(table.querySelectorAll('.rp-piece'));
    expect(cells).toHaveLength(81);
    expect(pieces).toHaveLength(18);
    expect(pieces.filter((piece) => piece.classList.contains('rp-piece--x'))).toHaveLength(9);
    expect(pieces.filter((piece) => piece.classList.contains('rp-piece--o'))).toHaveLength(9);
    expect(screen.getAllByRole('img', { name: 'Đội Đỏ (X) — Búa' })).toHaveLength(3);
    expect(screen.getAllByRole('img', { name: 'Đội Xanh (O) — Bao' })).toHaveLength(3);
    expect(screen.getAllByRole('img', { name: 'Đội Đỏ (X) — Kéo' })).toHaveLength(3);
    expect(pieces.some((piece) => piece.textContent === '✊')).toBe(true);
    expect(pieces.some((piece) => piece.textContent === '✋')).toBe(true);
    expect(pieces.some((piece) => piece.textContent === '✌️')).toBe(true);
    expect(table.querySelector('caption')).toBeTruthy();

    const a1 = table.querySelector('[data-square="a1"]')!;
    const i1 = table.querySelector('[data-square="i1"]')!;
    const i9 = table.querySelector('[data-square="i9"]')!;
    expect(a1.querySelector('.rp-row-label')?.textContent).toBe('1');
    expect(i1.querySelector('.rp-column-label')?.textContent).toBe('i');
    expect(i9.querySelector('.rp-row-label')?.textContent).toBe('9');
    expect(a1.getAttribute('aria-label')).toContain('đích Đội O');
    expect(i9.getAttribute('aria-label')).toContain('đích Đội X');
    expect(a1.classList).toContain('rp-cell--goal-red');
    expect(i9.classList).toContain('rp-cell--goal-blue');
    expect(a1.querySelector('.rp-goal-flag')?.textContent).toContain('ĐỎ');
    expect(i9.querySelector('.rp-goal-flag')?.textContent).toContain('XANH');
  });

  it('renders map obstacles as terrain while keeping their accessible square name', () => {
    const map = { ...DEFAULT_MAP, obstacles: [{ col: 4, row: 4 }] };
    render(<ReplayPlayer replay={replay(null, map)} />);
    const obstacle = document.querySelector('[data-square="e5"]')!;
    expect(obstacle.classList).toContain('rp-cell--obstacle');
    expect(obstacle.getAttribute('aria-label')).toContain('chướng ngại vật');
    expect(obstacle.querySelector('.rp-obstacle-marker')?.textContent).toBe('▦');
  });

  it('keeps the hand token presentation and from/to highlights as a replay captures a piece', () => {
    render(<ReplayPlayer replay={captureReplay()} />);
    const table = screen.getByRole('table', { name: /bàn cờ replay/i });
    expect(table.querySelector('[data-square="c3"] .rp-piece')).toBeTruthy();
    expect(table.querySelector('[data-square="d3"] .rp-piece')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sự kiện tiếp theo' }));

    expect(table.querySelectorAll('.rp-piece')).toHaveLength(1);
    expect(table.querySelector('[data-square="c3"]')?.classList).toContain('rp-cell--from');
    expect(table.querySelector('[data-square="d3"]')?.classList).toContain('rp-cell--to');
    expect(table.querySelector('[data-square="d3"] .rp-piece')?.getAttribute('aria-label')).toBe('Đội Đỏ (X) — Búa');
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
