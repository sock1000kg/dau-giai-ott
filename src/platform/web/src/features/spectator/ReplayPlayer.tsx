import { useEffect, useMemo, useReducer } from 'react';
import type { Piece, Position } from '@ott/game-core';
import type { ReplaySpeed } from './replay-state.ts';
import { createReplayMoves, createReplayTimeline, initialPlaybackState, playbackReducer } from './replay-state.ts';
import type { SpectatorReplayV1 } from './replay-schema.ts';
import { MoveList } from './MoveList.tsx';
import { Badge, Button, Card, Select } from '../../ui/index.ts';
import './replay-player.css';

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
  const previousFrame = playback.eventIndex === 0 ? null : timeline.frames[playback.eventIndex - 1] ?? null;
  const movedAction = currentEvent?.event.action ?? null;
  const toKey = movedAction === null ? null : positionKey(movedAction.to);
  const fromKey = movedAction === null ? null : previousFrame?.pieces.find((piece) => piece.id === movedAction.pieceId)?.position;
  const fromCell = fromKey === null || fromKey === undefined ? null : positionKey(fromKey);
  const eventRange = eventCount === 0 ? undefined : `${Math.min(eventCount, Math.max(1, playback.eventIndex))} / ${eventCount}`;

  const winner = replay.result.winnerSide;
  return (
    <section className="rp-player" aria-label="Trình phát replay">
      <Card className="rp-heading">
        <div>
          <p className="rp-eyebrow">REPLAY ĐÃ XÁC MINH</p>
          <h2>Trận đấu <span className="rp-mono rp-match-id" title={replay.matchId}>{replay.matchId}</span></h2>
          <p className="rp-sr-only">Bản đồ {replay.header.game.map.mapId} v{replay.header.game.map.version} · Engine {replay.header.game.engineVersion} · {replay.result.turnCount} lượt</p>
          <div className="rp-chips" aria-hidden="true">
            <Badge>map {replay.header.game.map.mapId} v{replay.header.game.map.version}</Badge>
            <Badge>engine {replay.header.game.engineVersion}</Badge>
            <Badge>{replay.result.turnCount} lượt</Badge>
          </div>
        </div>
        <Badge accent>Chỉ xem</Badge>
      </Card>

      <div className="rp-scoreboard">
        {(['X', 'O'] as const).map((side) => (
          <Card as="article" className={winner === side ? 'rp-team rp-team--winner' : 'rp-team'} key={side}>
            <p className="rp-eyebrow">PHÍA {side}</p>
            <div className="rp-team-head"><span className={`rp-chip rp-chip--${side.toLowerCase()}`} aria-hidden="true">{side}</span><h2>Đội {side}</h2></div>
            <p>{winner === side ? 'Người thắng' : winner === null ? 'Hòa' : 'Đối thủ'}</p>
          </Card>
        ))}
        <article className="ui-card rp-outcome" aria-label="Kết quả trận đấu">
          <p className="rp-eyebrow">KẾT QUẢ</p>
          <strong>{winner === null ? 'Hòa' : `Đội ${winner} thắng`}</strong>
          <span>{reasonLabel(replay.result.reason)} · {replay.result.turnCount} lượt</span>
        </article>
      </div>

      <div className="rp-stage">
        <Card className="rp-board-card">
          <div className="rp-board-scroll">
            <table className="rp-board" aria-label="Bàn cờ replay">
              <caption>Bàn cờ — lượt {state.turnId}, phía {state.activeSide} {state.finished ? '(đã kết thúc)' : 'đang đi'}</caption>
              <thead><tr><th scope="col" aria-label="Hàng / cột" />{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {Array.from({ length: 9 }, (_, rowIndex) => 8 - rowIndex).map((row) => (
                  <tr key={row}><th scope="row">{row + 1}</th>{columns.map((column, col) => {
                    const position = { col, row };
                    const key = positionKey(position);
                    const piece = piecesByPosition.get(key);
                    const goalSide = key === positionKey(goals.X) ? 'X' : key === positionKey(goals.O) ? 'O' : null;
                    const isObstacle = obstacles.has(key);
                    const cellLabel = `${column}${row + 1}${piece ? `, ${pieceLabel(piece)}` : ''}${goalSide ? `, đích Đội ${goalSide}` : ''}${isObstacle ? ', chướng ngại vật' : ''}`;
                    const classes = [
                      piece ? `rp-cell--${piece.owner.toLowerCase()}` : '',
                      goalSide ? `rp-cell--goal-${goalSide.toLowerCase()}` : '',
                      isObstacle ? 'rp-cell--obstacle' : '',
                      key === toKey ? 'rp-cell--to' : '',
                      key === fromCell ? 'rp-cell--from' : '',
                    ].filter(Boolean).join(' ');
                    return <td key={column} className={classes} aria-label={cellLabel}>
                      <span aria-hidden="true">{piece ? `${piece.owner}·${piece.type === 'ROCK' ? 'Đ' : piece.type === 'PAPER' ? 'G' : 'K'}` : goalSide ? '◆' : isObstacle ? '■' : '·'}</span>
                    </td>;
                  })}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <aside className="rp-side">
          <section className="ui-card" aria-live="polite" aria-label="Sự kiện đang phát">
            <p className="rp-eyebrow">{eventRange ? `SỰ KIỆN ${eventRange}` : 'TRẠNG THÁI BAN ĐẦU'}</p>
            {currentEvent ? <>
              <h2>{currentEvent.event.type === 'ACTION_APPLIED' ? 'Di chuyển quân' : currentEvent.event.type === 'TURN_SKIPPED' ? 'Bỏ lượt' : 'Kết thúc trận'}</h2>
              <p>{currentEvent.event.side === 'X' ? 'Đội X' : 'Đội O'} · lượt {currentEvent.event.turnId}</p>
              {currentEvent.event.action && <p>{currentEvent.event.action.pieceId}: {columns[currentEvent.event.action.to.col]}{currentEvent.event.action.to.row + 1}</p>}
              {currentEvent.event.reason && <p>Lý do: {reasonLabel(currentEvent.event.reason)}</p>}
            </> : <h2>Trận đấu chưa bắt đầu</h2>}
          </section>

          <section className="ui-card" aria-label="Tóm tắt fault">
            <p className="rp-eyebrow">TÓM TẮT FAULT</p>
            {(['X', 'O'] as const).map((side) => <p className="rp-fault-row" key={side}><strong>Đội {side}</strong><span>{replay.faults[side].recoverableTotal} lần · liên tiếp {replay.faults[side].recoverableConsecutive} · gần nhất {replay.faults[side].lastErrorCode ?? 'không có'}</span></p>)}
          </section>

          <MoveList moves={moves} currentEntry={currentEvent?.entryIndex}
            onSeek={(eventIndex) => dispatch({ type: 'SEEK', eventIndex, eventCount })} />
        </aside>
      </div>

      <section className="ui-card rp-controls" aria-label="Điều khiển replay">
        <div className="rp-button-row">
          <Button variant="ghost" onClick={() => dispatch({ type: 'RESTART' })}>Bắt đầu lại</Button>
          <Button variant="secondary" aria-label="Sự kiện trước" disabled={playback.eventIndex === 0} onClick={() => dispatch({ type: 'SEEK', eventIndex: playback.eventIndex - 1, eventCount })}>← Sự kiện trước</Button>
          <Button aria-label={playback.isPlaying ? 'Tạm dừng' : playback.eventIndex > 0 ? 'Tiếp tục' : 'Phát'} disabled={isAtEnd && !playback.isPlaying} onClick={() => dispatch(playback.isPlaying ? { type: 'PAUSE' } : { type: 'PLAY', eventCount })}>{playback.isPlaying ? 'Tạm dừng' : playback.eventIndex > 0 ? 'Tiếp tục' : 'Phát'}</Button>
          <Button variant="secondary" aria-label="Sự kiện tiếp theo" disabled={isAtEnd} onClick={() => dispatch({ type: 'SEEK', eventIndex: playback.eventIndex + 1, eventCount })}>Sự kiện tiếp theo →</Button>
        </div>
        <div className="rp-field">
          <label htmlFor="replay-seek">Chọn sự kiện <output>{playback.eventIndex} / {eventCount}</output></label>
          <input id="replay-seek" className="rp-range" type="range" min="0" max={eventCount} step="1" value={playback.eventIndex} onChange={(event) => dispatch({ type: 'SEEK', eventIndex: Number(event.currentTarget.value), eventCount })} />
        </div>
        <div className="rp-field rp-speed">
          <label htmlFor="replay-speed">Tốc độ phát</label>
          <Select id="replay-speed" value={playback.speed} onChange={(event) => dispatch({ type: 'SET_SPEED', speed: Number(event.currentTarget.value) as ReplaySpeed })}>
            {speedValues.map((speed) => <option value={speed} key={speed}>{speed}x</option>)}
          </Select>
        </div>
        <p className="rp-status" role="status">{isAtEnd ? 'Đã hết replay' : playback.isPlaying ? `Đang phát · ${playback.speed}x` : 'Đang tạm dừng'}</p>
      </section>

      <nav className="ui-card rp-events" aria-label="Dòng sự kiện">
        <h2>Dòng sự kiện</h2>
        <ol className="rp-scroll">{timeline.events.map(({ event }, index) => <li key={`${event.sequence}-${index}`}>
          <button type="button" className="rp-move" aria-current={playback.eventIndex === index + 1 ? 'step' : undefined} onClick={() => dispatch({ type: 'SEEK', eventIndex: index + 1, eventCount })}>
            <span className="rp-move-no rp-mono">{event.sequence}</span> Đội {event.side} · {event.type === 'ACTION_APPLIED' ? 'di chuyển' : event.type === 'TURN_SKIPPED' ? 'bỏ lượt' : 'kết thúc'}{event.reason ? ` (${reasonLabel(event.reason)})` : ''}
          </button>
        </li>)}</ol>
        {eventCount === 0 && <p>Replay không có sự kiện.</p>}
      </nav>
    </section>
  );
}
