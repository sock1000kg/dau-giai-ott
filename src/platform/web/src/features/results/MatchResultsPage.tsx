import { useCallback, useEffect, useState } from 'react';
import { listResultTeams, listResults, ResultsApiError, type MatchResult, type SeriesResult } from './api.ts';
import { SeriesResults } from './SeriesResults.tsx';

const PAGE_SIZE = 10;

function failureMessage(error: unknown): string {
  if (error instanceof ResultsApiError && error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (error instanceof ResultsApiError && error.status === 403) return 'Tài khoản không có quyền xem kết quả này.';
  return 'Không thể tải kết quả. Vui lòng thử lại.';
}

export function MatchResultsPage({ isAdmin }: Readonly<{ isAdmin: boolean }>) {
  const [kind, setKind] = useState<'matches' | 'series'>('matches');
  const [teamId, setTeamId] = useState('');
  const [stage, setStage] = useState('');
  const [page, setPage] = useState(1);
  const [teams, setTeams] = useState<readonly { id: string; name: string }[]>([]);
  const [matches, setMatches] = useState<readonly MatchResult[]>([]);
  const [series, setSeries] = useState<readonly SeriesResult[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void listResultTeams().then((items) => { if (active) setTeams(items); }).catch((cause: unknown) => { if (active) setError(failureMessage(cause)); });
    return () => { active = false; };
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const options = { page, pageSize: PAGE_SIZE, ...(isAdmin && teamId ? { teamId } : {}), ...(stage ? { stage } : {}) };
      const result = kind === 'matches' ? await listResults('matches', options) : await listResults('series', options);
      setTotalPages(result.pagination.totalPages);
      if (kind === 'matches') { setMatches(result.items as readonly MatchResult[]); setSeries([]); }
      else { setSeries(result.items as readonly SeriesResult[]); setMatches([]); }
    } catch (cause) { setError(failureMessage(cause)); }
    finally { setLoading(false); }
  }, [isAdmin, kind, page, stage, teamId]);

  useEffect(() => { void load(); }, [load]);
  const setFilter = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => { setter(event.target.value); setPage(1); };
  const empty = kind === 'matches' ? matches.length === 0 : series.length === 0;

  return (
    <main className="results-page">
      <section className="results-intro"><p className="eyebrow">KẾT QUẢ CHÍNH THỨC</p><h1>Kết quả thi đấu</h1><p className="welcome-copy">Kết quả đã chốt được cung cấp từ hệ thống giải đấu; trang này chỉ đọc và không can thiệp trận.</p></section>
      <section className="results-controls" aria-label="Bộ lọc kết quả">
        <label>Loại kết quả<select value={kind} onChange={(event) => { setKind(event.target.value as 'matches' | 'series'); setPage(1); }}><option value="matches">Từng trận</option><option value="series">Loạt trận</option></select></label>
        {isAdmin && <label>Đội thi<select value={teamId} onChange={setFilter(setTeamId)}><option value="">Tất cả đội</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
        <label>Vòng/stage<input value={stage} onChange={setFilter(setStage)} placeholder="Ví dụ: QUALIFICATION" /></label>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>Làm mới</button>
      </section>
      {error && <div className="results-error" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => void load()}>Thử lại</button></div>}
      {loading ? <p className="results-state" role="status" aria-busy="true">Đang tải kết quả…</p> : !error && empty ? <p className="results-state">Chưa có kết quả phù hợp.</p> : null}
      {!loading && !error && kind === 'matches' && matches.length > 0 && <div className="results-list">{matches.map((match) => <article className="result-card" key={match.matchId}>
        <div className="result-heading"><div><p className="eyebrow">{match.stage} · GAME {match.gameNumber}</p><h2>{match.teams.x.name} <span>vs</span> {match.teams.o.name}</h2></div><span className="result-status">{match.status}</span></div>
        <p className="result-outcome">{match.winnerSide ? `Thắng: ${match.winnerSide === 'X' ? match.teams.x.name : match.teams.o.name}` : match.reason === 'TURN_LIMIT' ? 'Hòa · hết giới hạn lượt' : 'Không có đội thắng'} · {match.reason ?? 'Chưa có lý do'}{match.turnCount === null ? '' : ` · ${match.turnCount} lượt`}</p>
        {match.faults ? <div className="fault-summary" aria-label="Tóm tắt lỗi bot"><span>X: {match.faults.X.recoverableTotal} lỗi{match.faults.X.lastErrorCode ? ` (${match.faults.X.lastErrorCode})` : ''}</span><span>O: {match.faults.O.recoverableTotal} lỗi{match.faults.O.lastErrorCode ? ` (${match.faults.O.lastErrorCode})` : ''}</span></div> : <p className="result-date">Không có fault summary cho kết quả này.</p>}
        <p className="result-date">{match.finalizedAt ? new Date(match.finalizedAt).toLocaleString() : 'Thời điểm chưa có'}</p>
        {match.status === 'FINALIZED' && (
          <div className="result-actions">
            <a className="secondary-button" href={isAdmin ? `/admin/replays/${match.matchId}/view` : `/team/replays/${match.matchId}`}>Replay</a>
          </div>
        )}
      </article>)}</div>}
      {!loading && !error && kind === 'series' && series.length > 0 && <SeriesResults items={series} />}
      <nav className="results-pagination" aria-label="Phân trang kết quả"><button className="secondary-button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button><span>Trang {page}{totalPages ? ` / ${totalPages}` : ''}</span><button className="secondary-button" disabled={loading || totalPages === 0 || page >= totalPages} onClick={() => setPage(page + 1)}>Trang sau</button></nav>
    </main>
  );
}
