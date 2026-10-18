import { useEffect, useState } from 'react';
import { loadPublicSnapshot, type PublicSnapshot } from './snapshot.ts';
import { Alert, Badge, Card, LinkButton, Page } from '../../ui/index.ts';
import { RulesPage } from './RulesPage.tsx';
import { formatScheduleValue, orderSchedule, scheduleLabel } from './schedule.ts';
import './public.css';

export function formatVnDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium' });
}

export function PublicTournamentPage() {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const controller = new AbortController();
    let previous: PublicSnapshot | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const next = await loadPublicSnapshot(previous, controller.signal);
        if (!stopped) { previous = next; setSnapshot(next); setFailed(false); }
      } catch { if (!stopped) setFailed(true); }
      if (!stopped) { setNow(Date.now()); timer = setTimeout(() => void refresh(), 30_000); }
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, []);
  if (!snapshot) return <Page title="Giải đấu OTT">
    <p className="pub-state" role="status">{failed ? 'Chưa tải được dữ liệu công khai. Trang sẽ tự thử lại.' : 'Đang tải dữ liệu…'}</p></Page>;
  const stale = failed || now - Date.parse(snapshot.updatedAt) > 90_000;
  return <Page title={`Giải đấu OTT · ${snapshot.round.name}`}>
    <div className="pub-strip">
      <Badge accent>{snapshot.stage}</Badge>
      <Badge>{snapshot.round.status}</Badge>
      <span className="pub-updated">Cập nhật lúc <time dateTime={snapshot.updatedAt}>{formatVnDateTime(snapshot.updatedAt)}</time></span>
    </div>
    {stale && <Alert tone="warning">Dữ liệu có thể đã cũ. Đang giữ bản cập nhật cuối cùng.</Alert>}
    <div className="pub-grid">
      <div className="pub-stack"><section aria-label="Trạng thái"><Card as="div" title="Trạng thái"><p>{snapshot.status.message}</p>
        <p>ETA khắc phục: {snapshot.status.incidentEta ?? 'Chưa có ước tính sự cố'}</p></Card></section>
      <section aria-label="Hàng đợi"><Card as="div" title="Hàng đợi"><ol className="pub-list">{snapshot.queue.map((row, i) =>
        <li key={i}><Badge accent>#{row.position}</Badge><span className="pub-list-main">{row.teams}</span>
          <span className="pub-list-meta">ETA {row.etaSeconds === null ? 'chưa xác định' : `~${row.etaSeconds} giây`}</span></li>)}</ol></Card></section></div>
      <section aria-label="Kết quả"><Card as="div" title="Kết quả"><ul className="pub-list">{snapshot.results.map((row) =>
        <li key={row.matchId}><span className="pub-list-main">{row.teams}</span><span className="pub-score">{row.score}</span>
          {snapshot.stage === 'FINALS' && row.syncVerified && row.replayPublished
            && <LinkButton variant="secondary" href={`/spectator/replays/${row.matchId}`}>Replay</LinkButton>}</li>)}</ul></Card></section>
    </div>
    <section id="leaderboard" aria-label="Bảng xếp hạng"><Card as="div" title="Bảng xếp hạng">
      <div className="pub-section-action"><LinkButton variant="secondary" href="/leaderboard">Xem bảng xếp hạng đầy đủ →</LinkButton></div>
      <div className="ui-table-scroll pub-table-scroll"><table className="ui-table pub-table">
        <caption>Thứ hạng công khai theo bản cập nhật mới nhất</caption>
        <thead><tr><th scope="col">Hạng</th><th scope="col">Đội</th><th scope="col" className="pub-num">Elo</th><th scope="col">Điều kiện finals</th></tr></thead>
        <tbody>{snapshot.leaderboard.map((row, i) => <tr key={i} className={row.rank <= 3 ? 'pub-row-top' : undefined}>
          <td><span className="pub-rank-value">{row.rank}</span></td><td className="pub-team">{row.team}</td><td className="pub-num">{row.rating}</td>
          <td>{row.eligible ? <Badge accent>Đủ điều kiện</Badge> : <Badge>Chưa đủ series</Badge>}</td></tr>)}</tbody></table></div></Card></section>
    <RulesPage rules={snapshot.rules} />
    <div className={`pub-grid ${snapshot.faq.length > 0 ? 'pub-grid--thirds' : 'pub-grid--halves'}`}>
      <section aria-label="Lịch"><Card as="div" title="Lịch"><div className="pub-entries">{orderSchedule(snapshot.schedule).map((row, i) =>
        <article className="pub-entry" key={i}><h3>{scheduleLabel(row.title)}</h3><p>{formatScheduleValue(row.body)}</p></article>)}</div></Card></section>
      <section aria-label="Thông báo"><Card as="div" title="Thông báo">{snapshot.announcements.length === 0
        ? <p className="pub-muted">Chưa có thông báo.</p>
        : <div className="pub-entries">{snapshot.announcements.map((row, i) =>
          <article className="pub-entry" key={i}><h3>{row.title}</h3><p>{row.body}</p></article>)}</div>}</Card></section>
      {snapshot.faq.length > 0 && <section aria-label="FAQ"><Card as="div" title="FAQ"><div className="pub-entries">{snapshot.faq.map((row, i) =>
        <article className="pub-entry" key={i}><h3>{row.title}</h3><p>{row.body}</p></article>)}</div></Card></section>}
    </div>
  </Page>;
}
