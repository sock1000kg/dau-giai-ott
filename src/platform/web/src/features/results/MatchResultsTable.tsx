import { Badge, LinkButton, Table, type TableColumn } from '../../ui/index.ts';
import type { MatchResult } from './api.ts';
import { formatVnDate, reasonLabel, statusLabel } from './labels.ts';
import './results.css';

function outcome(match: MatchResult): string {
  if (match.winnerSide) return `Thắng: ${match.winnerSide === 'X' ? match.teams.x.name : match.teams.o.name}`;
  return match.reason === 'TURN_LIMIT' ? 'Hòa · hết giới hạn lượt' : 'Không có đội thắng';
}

function columnsFor(isAdmin: boolean): readonly TableColumn<MatchResult>[] {
  return [
    { key: 'game', header: 'Game', render: (match) => `${match.stage} · Game ${match.gameNumber}` },
    { key: 'teams', header: 'Đội X vs Đội O', render: (match) => <strong>{match.teams.x.name} vs {match.teams.o.name}</strong> },
    { key: 'status', header: 'Trạng thái', render: (match) => <Badge>{statusLabel(match.status)}</Badge> },
    {
      key: 'outcome',
      header: 'Kết quả',
      render: (match) => <div className="results-cell">
        {match.winnerSide ? <Badge accent>{outcome(match)}</Badge> : <span>{outcome(match)}</span>}
        <span className="results-muted">{match.reason ? reasonLabel(match.reason) : 'Chưa có lý do'}</span>
        {match.faults
          ? <div className="results-faults" aria-label="Tóm tắt lỗi bot"><span>X: {match.faults.X.recoverableTotal} lỗi{match.faults.X.lastErrorCode ? ` (${match.faults.X.lastErrorCode})` : ''}</span><span>O: {match.faults.O.recoverableTotal} lỗi{match.faults.O.lastErrorCode ? ` (${match.faults.O.lastErrorCode})` : ''}</span></div>
          : <span className="results-muted">Không có fault summary cho kết quả này.</span>}
      </div>,
    },
    { key: 'turns', header: 'Số lượt', render: (match) => match.turnCount === null ? '—' : `${match.turnCount} lượt` },
    { key: 'date', header: 'Thời điểm', render: (match) => formatVnDate(match.finalizedAt) },
    {
      key: 'replay',
      header: 'Replay',
      render: (match) => match.status === 'FINALIZED'
        ? <LinkButton variant="secondary" href={isAdmin ? `/admin/replays/${match.matchId}/view` : `/team/replays/${match.matchId}`}>Replay</LinkButton>
        : null,
    },
  ];
}

export function MatchResultsTable({ items, isAdmin }: Readonly<{ items: readonly MatchResult[]; isAdmin: boolean }>) {
  return <div className="results-table"><Table caption="Kết quả từng trận" columns={columnsFor(isAdmin)} rows={items} rowKey={(match) => match.matchId} emptyMessage="Chưa có kết quả phù hợp." /></div>;
}
