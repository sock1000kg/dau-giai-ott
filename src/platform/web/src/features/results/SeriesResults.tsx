import { Badge, Table, type TableColumn } from '../../ui/index.ts';
import type { SeriesResult } from './api.ts';
import { cancellationLabel, formatVnDate, statusLabel } from './labels.ts';
import './results.css';

const columns: readonly TableColumn<SeriesResult>[] = [
  { key: 'stage', header: 'Vòng · Thể thức', render: (item) => `${item.stage} · ${item.format}` },
  { key: 'teams', header: 'Đội A vs Đội B', render: (item) => <strong>{item.teams.a.name} vs {item.teams.b.name}</strong> },
  { key: 'status', header: 'Trạng thái', render: (item) => <Badge>{statusLabel(item.status)}</Badge> },
  {
    key: 'outcome',
    header: 'Kết quả',
    render: (item) => <div className="results-cell">
      <span>{`Tỉ số: ${item.score.a ?? '—'} – ${item.score.b ?? '—'}`}{item.winnerTeamId ? ` · Thắng: ${item.winnerTeamId === item.teams.a.id ? item.teams.a.name : item.teams.b.name}` : ''}</span>
      {item.cancellationReason && <span className="results-muted">{cancellationLabel(item.cancellationReason)}</span>}
    </div>,
  },
  { key: 'date', header: 'Thời điểm', render: (item) => formatVnDate(item.finalizedAt) },
];

/** Small presentation component shared by the series-results page and focused component tests. */
export function SeriesResults({ items }: Readonly<{ items: readonly SeriesResult[] }>) {
  return <div className="results-table"><Table caption="Kết quả loạt trận" columns={columns} rows={items} rowKey={(item) => item.seriesId} emptyMessage="Chưa có kết quả loạt trận." /></div>;
}
