import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ReplayMove } from './replay-state.ts';

export function MoveList({ moves, currentEntry, onSeek, sideLabel = (side) => `Đội ${side}` }: {
  readonly moves: readonly ReplayMove[];
  readonly currentEntry: number | undefined;
  readonly onSeek: (eventIndex: number) => void;
  readonly sideLabel?: (side: 'X' | 'O') => string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLOListElement | null>(null);
  // Keep the current move visible inside the list only; never scroll the page.
  useEffect(() => {
    const list = scroller.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (list === null || list === undefined || current === null || current === undefined) return;
    const top = current.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + current.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + current.offsetHeight - list.clientHeight;
  }, [currentEntry]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = event.key === 'ArrowDown' ? Math.min(moves.length - 1, index + 1)
      : event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? moves.length - 1 : undefined;
    if (target === undefined) return;
    event.preventDefault();
    buttons.current[target]?.focus();
    if (moves[target]) onSeek(moves[target]!.eventIndex);
  }
  return <section className="ui-card rp-moves" aria-label="Danh sách nước đi">
    <h2>Danh sách nước đi</h2>
    <ol className="rp-scroll" ref={scroller}>{moves.map((move, index) => <li key={move.entryIndex}>
      <button type="button" className="rp-move" ref={(node) => { buttons.current[index] = node; }}
        aria-current={currentEntry === move.entryIndex ? 'step' : undefined}
        onClick={() => onSeek(move.eventIndex)} onKeyDown={(event) => navigate(event, index)}>
        <span className="rp-move-no rp-mono">Nước {index + 1}:</span>
        <span className={`rp-chip rp-chip--${move.input.side.toLowerCase()}`} aria-hidden="true">{move.input.side}</span>
        <span className="rp-move-text">{sideLabel(move.input.side)} · lượt {move.turnId} · <span className="rp-mono">{move.input.kind === 'apply'
          ? `${move.input.action.pieceId} → ${String.fromCharCode(65 + move.input.action.to.col)}${move.input.action.to.row + 1}`
          : move.input.kind === 'skip' ? 'Bỏ lượt' : 'Xử thua'}</span></span>
      </button>
    </li>)}</ol>
    {moves.length === 0 && <p>Chưa có nước đi.</p>}
  </section>;
}
