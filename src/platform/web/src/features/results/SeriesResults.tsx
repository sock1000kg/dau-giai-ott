import type { SeriesResult } from './api.ts';

/** Small presentation component shared by the series-results page and focused component tests. */
export function SeriesResults({ items }: Readonly<{ items: readonly SeriesResult[] }>) {
  if (items.length === 0) return <p className="results-state">Chưa có kết quả loạt trận.</p>;
  return <div className="results-list">{items.map((item) => <article className="result-card" key={item.seriesId}>
    <div className="result-heading"><div><p className="eyebrow">{item.stage} · {item.format}</p><h2>{item.teams.a.name} <span>vs</span> {item.teams.b.name}</h2></div><span className="result-status">{item.status}</span></div>
    <p className="result-outcome">Tỉ số: {item.score.a ?? '—'} – {item.score.b ?? '—'}{item.winnerTeamId ? ` · Thắng: ${item.winnerTeamId === item.teams.a.id ? item.teams.a.name : item.teams.b.name}` : ''}{item.cancellationReason ? ` · ${item.cancellationReason}` : ''}</p>
    <p className="result-date">{item.finalizedAt ? new Date(item.finalizedAt).toLocaleString() : 'Thời điểm chưa có'}</p>
  </article>)}</div>;
}
