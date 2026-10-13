import { useCallback, useEffect, useState } from 'react';
import { LeaderboardApiError, listLeaderboard, type LeaderboardEntry } from './api.ts';
import { LeaderboardTable } from './LeaderboardTable.tsx';

const PAGE_SIZE = 25;

function errorMessage(error: unknown): string {
  if (error instanceof LeaderboardApiError && error.status === 429) return 'Đang có nhiều yêu cầu. Vui lòng thử lại sau ít phút.';
  return 'Không thể tải bảng xếp hạng. Vui lòng thử lại.';
}

export function LeaderboardPage() {
  const [draftStage, setDraftStage] = useState('QUALIFICATION');
  const [stage, setStage] = useState('QUALIFICATION');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<readonly LeaderboardEntry[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listLeaderboard({ stage, page, pageSize: PAGE_SIZE });
      setItems(result.items);
      setTotalPages(result.pagination.totalPages);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [page, stage]);

  useEffect(() => { void load(); }, [load]);

  function applyStage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setStage(draftStage.trim().toUpperCase());
  }

  return (
    <main className="leaderboard-page">
      <header className="leaderboard-intro">
        <p className="eyebrow">OTT ARENA · BẢNG ĐIỂM CÔNG KHAI</p>
        <h1>Bảng xếp hạng</h1>
        <p>Thứ hạng và các chỉ số chính thức do máy chủ giải đấu tính. Các đội đồng hạng cần Ban tổ chức quyết định bước tiếp theo.</p>
      </header>
      <form className="leaderboard-filters" onSubmit={applyStage} aria-label="Lọc bảng xếp hạng">
        <label htmlFor="leaderboard-stage">Vòng đấu / stage</label>
        <input id="leaderboard-stage" value={draftStage} onChange={(event) => setDraftStage(event.target.value)} maxLength={64} />
        <button className="secondary-button" type="submit" disabled={loading}>Áp dụng</button>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>Làm mới</button>
      </form>
      {error && <div className="leaderboard-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Thử lại</button></div>}
      {loading ? <p className="leaderboard-state" role="status" aria-busy="true">Đang tải bảng xếp hạng…</p> : !error && items.length === 0 ? <p className="leaderboard-state">Chưa có dữ liệu bảng xếp hạng cho vòng đấu này.</p> : null}
      {!loading && !error && items.length > 0 && <LeaderboardTable items={items} />}
      <nav className="leaderboard-pagination" aria-label="Phân trang bảng xếp hạng">
        <button className="secondary-button" type="button" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button>
        <span>Trang {page}{totalPages ? ` / ${totalPages}` : ''}</span>
        <button className="secondary-button" type="button" disabled={loading || totalPages === 0 || page >= totalPages} onClick={() => setPage(page + 1)}>Trang sau</button>
      </nav>
      <p className="leaderboard-note">Elo, thứ hạng và tie-break không được tính lại trên trình duyệt. Kết quả đồng hạng được giữ nguyên theo dữ liệu chính thức.</p>
    </main>
  );
}
