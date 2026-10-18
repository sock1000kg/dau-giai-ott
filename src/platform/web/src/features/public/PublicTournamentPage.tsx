import { useEffect, useState } from 'react';
import { loadPublicSnapshot, type PublicSnapshot } from './snapshot.ts';
import { RulesPage } from './RulesPage.tsx';

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
  if (!snapshot) return <main className="leaderboard-page"><h1>Giải đấu OTT</h1>
    <p role="status">{failed ? 'Chưa tải được dữ liệu công khai. Trang sẽ tự thử lại.' : 'Đang tải dữ liệu…'}</p></main>;
  const stale = failed || now - Date.parse(snapshot.updatedAt) > 90_000;
  return <main className="leaderboard-page">
    <h1>Giải đấu OTT · {snapshot.round.name}</h1>
    <p>{snapshot.stage} · {snapshot.round.status}</p>
    <p>Cập nhật lúc <time dateTime={snapshot.updatedAt}>{snapshot.updatedAt}</time></p>
    {stale && <p role="alert">Dữ liệu có thể đã cũ. Đang giữ bản cập nhật cuối cùng.</p>}
    <section aria-label="Trạng thái"><h2>Trạng thái</h2><p>{snapshot.status.message}</p>
      <p>ETA khắc phục: {snapshot.status.incidentEta ?? 'Chưa có ước tính sự cố'}</p></section>
    <section aria-label="Hàng đợi"><h2>Hàng đợi</h2><ol>{snapshot.queue.map((row, i) =>
      <li key={i}>#{row.position} · {row.teams} · ETA {row.etaSeconds === null ? 'chưa xác định' : `~${row.etaSeconds} giây`}</li>)}</ol></section>
    <section aria-label="Kết quả"><h2>Kết quả</h2><ul>{snapshot.results.map((row) =>
      <li key={row.matchId}>{row.teams}: {row.score}{snapshot.stage === 'FINALS' && row.syncVerified && row.replayPublished
        && <> · <a href={`/spectator/replays/${row.matchId}`}>Replay</a></>}</li>)}</ul></section>
    <section id="leaderboard" aria-label="Bảng xếp hạng"><h2>Bảng xếp hạng</h2>
      <table><thead><tr><th scope="col">Hạng</th><th scope="col">Đội</th><th scope="col">Elo</th><th scope="col">Điều kiện finals</th></tr></thead>
        <tbody>{snapshot.leaderboard.map((row, i) => <tr key={i}><td>{row.rank}</td><td>{row.team}</td><td>{row.rating}</td>
          <td>{row.eligible ? 'Đủ điều kiện' : 'Chưa đủ series'}</td></tr>)}</tbody></table></section>
    <RulesPage rules={snapshot.rules} />
    {([['Lịch', snapshot.schedule], ['Thông báo', snapshot.announcements], ['FAQ', snapshot.faq]] as const).map(([title, items]) =>
      <section aria-label={title} key={title}><h2>{title}</h2>{items.map((row, i) => <article key={i}><h3>{row.title}</h3><p>{row.body}</p></article>)}</section>)}
  </main>;
}
