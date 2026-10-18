import { useEffect, useMemo, useReducer } from 'react';
import type { Piece, Position } from '@ott/game-core';
import type { ReplaySpeed } from './replay-state.ts';
import { createReplayMoves, createReplayTimeline, initialPlaybackState, playbackReducer } from './replay-state.ts';
import type { SpectatorReplayV1 } from './replay-schema.ts';
import { MoveList } from './MoveList.tsx';

const columns = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const speedValues: readonly ReplaySpeed[] = [0.5, 1, 2];

function positionKey(position: Position): string { return `${position.col}:${position.row}`; }

function reasonLabel(reason: string | null): string {
  if (reason === null) return 'Không có';
  return reason.replaceAll('_', ' ').toLocaleLowerCase('vi-VN');
}
function pieceLabel(piece: Piece): string {
  const type = piece.type === 'ROCK' ? 'Đá' : piece.type === 'PAPER' ? 'Giấy' : 'Kéo';
  return `${piece.owner === 'X' ? 'Đội X' : 'Đội O'} - ${type}`;
}

export function ReplayPlayer({ replay }: { readonly replay: SpectatorReplayV1 }) {
  const timeline = useMemo(() => createReplayTimeline(replay), [replay]);
  const moves = useMemo(() => createReplayMoves(replay), [replay]);
  const [playback, dispatch] = useReducer(playbackReducer, undefined, initialPlaybackState);
  const eventCount = timeline.events.length;
  const currentEvent = playback.eventIndex === 0 ? null : timeline.events[playback.eventIndex - 1] ?? null;
  const state = timeline.frames[playback.eventIndex] ?? timeline.frames[0]!;
  const isAtEnd = playback.eventIndex >= eventCount;

  useEffect(() => {
    if (!playback.isPlaying) return undefined;
    const timer = window.setInterval(() => dispatch({ type: 'ADVANCE', eventCount }), 500 / playback.speed);
    return () => window.clearInterval(timer);
  }, [eventCount, playback.isPlaying, playback.speed]);

  const piecesByPosition = new Map(state.pieces.map((piece) => [positionKey(piece.position), piece]));
  const obstacles = new Set(replay.header.game.map.obstacles.map(positionKey));
  const goals = replay.header.game.map.goals;
  const eventRange = eventCount === 0 ? undefined : `${Math.min(eventCount, Math.max(1, playback.eventIndex))} / ${eventCount}`;

  return (
    <section className="replay-player" aria-label="Trình phát replay">
      <div className="replay-player-heading">
        <div>
          <p className="eyebrow"><span /> REPLAY ĐÃ XÁC MINH</p>
          <h1>Trận đấu {replay.matchId}</h1>
          <p className="replay-match-meta">Bản đồ {replay.header.game.map.mapId} v{replay.header.game.map.version} · Engine {replay.header.game.engineVersion} · {replay.result.turnCount} lượt</p>
        </div>
        <span className="replay-readonly-badge">Chỉ xem</span>
      </div>

      <div className="replay-scoreboard">
        {(['X', 'O'] as const).map((side) => (
          <article className={`replay-team-card replay-team-${side.toLowerCase()}`} key={side}>
            <p className="eyebrow">PHÍA {side}</p>
            <h2>Đội {side}</h2>
            <p>{replay.result.winnerSide === side ? 'Người thắng' : replay.result.winnerSide === null ? 'Hòa' : 'Đối thủ'}</p>
          </article>
        ))}
        <article className="replay-outcome-card" aria-label="Kết quả trận đấu">
          <p className="eyebrow">KẾT QUẢ</p>
          <strong>{replay.result.winnerSide === null ? 'Hòa' : `Đội ${replay.result.winnerSide} thắng`}</strong>
          <span>{reasonLabel(replay.result.reason)} · {replay.result.turnCount} lượt</span>
        </article>
      </div>

      <div className="replay-stage">
        <div className="replay-board-scroll">
          <table className="replay-board" aria-label="Bàn cờ replay">
            <caption>Bàn cờ — lượt {state.turnId}, phía {state.activeSide} {state.finished ? '(đã kết thúc)' : 'đang đi'}</caption>
            <thead><tr><th scope="col" aria-label="Hàng / cột" />{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: 9 }, (_, rowIndex) => 8 - rowIndex).map((row) => (
                <tr key={row}><th scope="row">{row + 1}</th>{columns.map((column, col) => {
                  const position = { col, row };
                  const piece = piecesByPosition.get(positionKey(position));
                  const goalSide = positionKey(position) === positionKey(goals.X) ? 'X'
                    : positionKey(position) === positionKey(goals.O) ? 'O' : null;
                  const cellLabel = `${column}${row + 1}${piece ? `, ${pieceLabel(piece)}` : ''}${goalSide ? `, đích Đội ${goalSide}` : ''}${obstacles.has(positionKey(position)) ? ', chướng ngại vật' : ''}`;
                  return <td key={column} className={`${piece ? `piece-${piece.owner.toLowerCase()}` : ''} ${goalSide ? `goal-${goalSide.toLowerCase()}` : ''} ${obstacles.has(positionKey(position)) ? 'board-obstacle' : ''}`} aria-label={cellLabel}>
                    <span aria-hidden="true">{piece ? `${piece.owner}·${piece.type === 'ROCK' ? 'Đ' : piece.type === 'PAPER' ? 'G' : 'K'}` : goalSide ? '◆' : obstacles.has(positionKey(position)) ? '■' : '·'}</span>
                  </td>;
                })}</tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="replay-details">
          <section className="replay-detail-card" aria-live="polite" aria-label="Sự kiện đang phát">
            <p className="eyebrow">{eventRange ? `SỰ KIỆN ${eventRange}` : 'TRẠNG THÁI BAN ĐẦU'}</p>
            {currentEvent ? <>
              <h2>{currentEvent.event.type === 'ACTION_APPLIED' ? 'Di chuyển quân' : currentEvent.event.type === 'TURN_SKIPPED' ? 'Bỏ lượt' : 'Kết thúc trận'}</h2>
              <p>{currentEvent.event.side === 'X' ? 'Đội X' : 'Đội O'} · lượt {currentEvent.event.turnId}</p>
              {currentEvent.event.action && <p>{currentEvent.event.action.pieceId}: {columns[currentEvent.event.action.to.col]}{currentEvent.event.action.to.row + 1}</p>}
              {currentEvent.event.reason && <p>Lý do: {reasonLabel(currentEvent.event.reason)}</p>}
            </> : <h2>Trận đấu chưa bắt đầu</h2>}
          </section>

          <section className="replay-detail-card" aria-label="Tóm tắt fault">
            <p className="eyebrow">TÓM TẮT FAULT</p>
            {(['X', 'O'] as const).map((side) => <p className="replay-fault-row" key={side}><strong>Đội {side}</strong><span>{replay.faults[side].recoverableTotal} lần · liên tiếp {replay.faults[side].recoverableConsecutive} · gần nhất {replay.faults[side].lastErrorCode ?? 'không có'}</span></p>)}
          </section>
        </aside>
      </div>

      <section className="replay-controls" aria-label="Điều khiển replay">
        <div className="replay-button-row">
          <button type="button" className="secondary-button" onClick={() => dispatch({ type: 'RESTART' })}>Bắt đầu lại</button>
          <button type="button" className="secondary-button" aria-label="Sự kiện trước" disabled={playback.eventIndex === 0} onClick={() => dispatch({ type: 'SEEK', eventIndex: playback.eventIndex - 1, eventCount })}>← Sự kiện trước</button>
          <button type="button" className="replay-primary-button" aria-label={playback.isPlaying ? 'Tạm dừng' : playback.eventIndex > 0 ? 'Tiếp tục' : 'Phát'} disabled={isAtEnd && !playback.isPlaying} onClick={() => dispatch(playback.isPlaying ? { type: 'PAUSE' } : { type: 'PLAY', eventCount })}>{playback.isPlaying ? 'Tạm dừng' : playback.eventIndex > 0 ? 'Tiếp tục' : 'Phát'}</button>
          <button type="button" className="secondary-button" aria-label="Sự kiện tiếp theo" disabled={isAtEnd} onClick={() => dispatch({ type: 'SEEK', eventIndex: playback.eventIndex + 1, eventCount })}>Sự kiện tiếp theo →</button>
        </div>
        <label className="replay-range-label" htmlFor="replay-seek">Chọn sự kiện <output>{playback.eventIndex} / {eventCount}</output></label>
        <input id="replay-seek" type="range" min="0" max={eventCount} step="1" value={playback.eventIndex} onChange={(event) => dispatch({ type: 'SEEK', eventIndex: Number(event.currentTarget.value), eventCount })} />
        <label className="replay-speed-label" htmlFor="replay-speed">Tốc độ phát</label>
        <select id="replay-speed" value={playback.speed} onChange={(event) => dispatch({ type: 'SET_SPEED', speed: Number(event.currentTarget.value) as ReplaySpeed })}>
          {speedValues.map((speed) => <option value={speed} key={speed}>{speed}x</option>)}
        </select>
        <p className="replay-playback-status" role="status">{isAtEnd ? 'Đã hết replay' : playback.isPlaying ? `Đang phát · ${playback.speed}x` : 'Đang tạm dừng'}</p>
      </section>

      <MoveList moves={moves} currentEntry={currentEvent?.entryIndex}
        onSeek={(eventIndex) => dispatch({ type: 'SEEK', eventIndex, eventCount })} />

      <nav className="replay-event-nav" aria-label="Dòng sự kiện">
        <h2>Dòng sự kiện</h2>
        <ol>{timeline.events.map(({ event }, index) => <li key={`${event.sequence}-${index}`}>
          <button type="button" aria-current={playback.eventIndex === index + 1 ? 'step' : undefined} onClick={() => dispatch({ type: 'SEEK', eventIndex: index + 1, eventCount })}>
            <span>{event.sequence}</span> Đội {event.side} · {event.type === 'ACTION_APPLIED' ? 'di chuyển' : event.type === 'TURN_SKIPPED' ? 'bỏ lượt' : 'kết thúc'}{event.reason ? ` (${reasonLabel(event.reason)})` : ''}
          </button>
        </li>)}</ol>
        {eventCount === 0 && <p>Replay không có sự kiện.</p>}
      </nav>
    </section>
  );
}
