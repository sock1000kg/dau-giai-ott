import { useRef, type KeyboardEvent } from 'react';
import type { ReplayMove } from './replay-state.ts';

export function MoveList({ moves, currentEntry, onSeek }: {
  readonly moves: readonly ReplayMove[];
  readonly currentEntry: number | undefined;
  readonly onSeek: (eventIndex: number) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = event.key === 'ArrowDown' ? Math.min(moves.length - 1, index + 1)
      : event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? moves.length - 1 : undefined;
    if (target === undefined) return;
    event.preventDefault();
    buttons.current[target]?.focus();
    if (moves[target]) onSeek(moves[target]!.eventIndex);
  }
  return <section className="replay-event-nav replay-move-list" aria-label="Danh sách nước đi">
    <h2>Danh sách nước đi</h2>
    <ol>{moves.map((move, index) => <li key={move.entryIndex}>
      <button type="button" ref={(node) => { buttons.current[index] = node; }}
        aria-current={currentEntry === move.entryIndex ? 'step' : undefined}
        onClick={() => onSeek(move.eventIndex)} onKeyDown={(event) => navigate(event, index)}>
        Nước {index + 1}: Đội {move.input.side} · lượt {move.turnId} · {move.input.kind === 'apply'
          ? `${move.input.action.pieceId} → ${String.fromCharCode(65 + move.input.action.to.col)}${move.input.action.to.row + 1}`
          : move.input.kind === 'skip' ? 'Bỏ lượt' : 'Xử thua'}
      </button>
    </li>)}</ol>
    {moves.length === 0 && <p>Chưa có nước đi.</p>}
  </section>;
}
