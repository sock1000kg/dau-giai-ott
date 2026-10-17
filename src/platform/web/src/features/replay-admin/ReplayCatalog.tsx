import { useCallback, useEffect, useState } from 'react';
import { listReplayCatalog, ReplayAdminApiError, transitionReplay, type ReplayCatalogEntry, type ReplayPublicationState } from './api.ts';
import { PublicationControls, type ReplayAction } from './PublicationControls.tsx';

const PAGE_SIZE = 25;

function failureMessage(error: unknown): string {
  if (error instanceof ReplayAdminApiError && error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (error instanceof ReplayAdminApiError && error.status === 403) return 'Tài khoản không có quyền quản lý replay.';
  if (error instanceof ReplayAdminApiError && error.status === 409) return 'Trạng thái replay đã thay đổi hoặc dữ liệu không còn hợp lệ. Hãy tải lại danh sách.';
  return 'Không thể hoàn tất thao tác replay. Vui lòng thử lại.';
}

function stateLabel(state: ReplayPublicationState): string {
  if (state === 'PRIVATE') return 'Riêng tư';
  if (state === 'STAGED') return 'Đang chờ duyệt';
  return 'Đã công bố';
}

export function ReplayCatalog() {
  const [items, setItems] = useState<readonly ReplayCatalogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [busyMatch, setBusyMatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCatalogUnavailable(false);
    try {
      const result = await listReplayCatalog(page, PAGE_SIZE);
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (cause) {
      setError(failureMessage(cause));
      setCatalogUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { void load(); }, [load]);

  async function transition(entry: ReplayCatalogEntry, action: ReplayAction, reason: string, idempotencyKey: string) {
    setBusyMatch(entry.matchId);
    setError(null);
    try {
      const state = await transitionReplay(entry.matchId, action, reason, idempotencyKey);
      // Use the authoritative transition response immediately, then reconcile from the catalog.
      setItems((current) => current.map((item) => item.matchId === entry.matchId ? { ...item, state } : item));
      await load();
    } catch (cause) {
      setError(failureMessage(cause));
      throw cause;
    } finally {
      setBusyMatch(null);
    }
  }

  return (
    <main className="replay-admin-page">
      <section className="replay-admin-intro">
        <p className="eyebrow">BTC · SAU KHI TRẬN KẾT THÚC</p>
        <h1>Phát hành replay</h1>
        <p>Chọn trận đã hoàn tất, xem checksum đã lưu và công bố replay để khán giả xem lại. Server sẽ xác minh toàn vẹn trước mỗi lần chuyển trạng thái; trang này không có điều khiển trận trực tiếp.</p>
      </section>

      <div className="replay-admin-toolbar">
        <p>{total} trận đủ điều kiện</p>
        <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading || busyMatch !== null}>Làm mới</button>
      </div>

      {error && <div className="replay-admin-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => void load()}>Thử lại</button></div>}
      {loading && <p className="replay-admin-state" role="status" aria-busy="true">Đang tải danh sách replay…</p>}
      {!loading && !error && items.length === 0 && <p className="replay-admin-state">Chưa có replay đủ điều kiện phát hành.</p>}

      {!loading && items.length > 0 && (
        <section className="replay-catalog" aria-label="Danh sách trận đã kết thúc">
          {items.map((item) => (
            <article className="replay-card" key={item.matchId}>
              <div className="replay-card-heading">
                <div><p className="eyebrow">{item.stage} · SERIES {item.seriesId}</p><h2>{item.teamX.name} <span>vs</span> {item.teamO.name}</h2></div>
                <span className={`replay-state replay-state-${item.state.toLowerCase()}`}>{stateLabel(item.state)}</span>
              </div>
              <dl className="replay-metadata">
                <div><dt>Kết thúc</dt><dd><time dateTime={item.finalizedAt}>{new Date(item.finalizedAt).toLocaleString()}</time></dd></div>
                <div><dt>Match ID</dt><dd><code>{item.matchId}</code></dd></div>
                <div><dt>SHA-256 đã lưu</dt><dd><code>{item.eventLogSha256.slice(0, 23)}…</code></dd></div>
              </dl>
              <PublicationControls stage={item.stage} state={item.state} busy={catalogUnavailable || busyMatch === item.matchId || busyMatch !== null} onBegin={(action, reason, key) => transition(item, action, reason, key)} />
            </article>
          ))}
        </section>
      )}

      <nav className="replay-pagination" aria-label="Phân trang replay">
        <button className="secondary-button" type="button" disabled={loading || busyMatch !== null || page <= 1} onClick={() => setPage(page - 1)}>Trang trước</button>
        <span>Trang {page}{totalPages > 0 ? ` / ${totalPages}` : ''}</span>
        <button className="secondary-button" type="button" disabled={loading || busyMatch !== null || page >= totalPages} onClick={() => setPage(page + 1)}>Trang sau</button>
      </nav>
    </main>
  );
}
