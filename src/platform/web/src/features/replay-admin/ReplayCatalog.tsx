import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Page, Table, type TableColumn } from '../../ui/index.ts';
import { listReplayCatalog, ReplayAdminApiError, transitionReplay, type ReplayCatalogEntry, type ReplayPublicationState } from './api.ts';
import { PublicationControls, type ReplayAction } from './PublicationControls.tsx';

import './replay-admin.css';

const PAGE_SIZE = 25;
const VN_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function formatVnTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(VN_TIME.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}/${parts.year}`;
}

function shortMatchId(matchId: string): string {
  return matchId.length > 16 ? `${matchId.slice(0, 8)}…${matchId.slice(-6)}` : matchId;
}

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

  const columns: readonly TableColumn<ReplayCatalogEntry>[] = [
    { key: 'finalizedAt', header: 'Kết thúc', render: (item) => <time dateTime={item.finalizedAt}>{formatVnTime(item.finalizedAt)}</time> },
    { key: 'match', header: 'Trận', render: (item) => (
      <div className="ra-match">
        <h2>{item.teamX.name} <span>vs</span> {item.teamO.name}</h2>
        <p>{item.stage} · SERIES {item.seriesId}</p>
      </div>
    ) },
    { key: 'state', header: 'Trạng thái', render: (item) => <span className={`ra-state ra-state--${item.state.toLowerCase()}`}><Badge accent={item.state === 'PUBLISHED'}>{stateLabel(item.state)}</Badge></span> },
    { key: 'sha', header: 'SHA-256 đã lưu', render: (item) => <code title={item.eventLogSha256}>{item.eventLogSha256.slice(0, 23)}…</code> },
    { key: 'matchId', header: 'Match ID', render: (item) => <code title={item.matchId}>{shortMatchId(item.matchId)}</code> },
    { key: 'actions', header: 'Thao tác', render: (item) => (
      <PublicationControls stage={item.stage} state={item.state} busy={catalogUnavailable || busyMatch !== null} onBegin={(action, reason, key) => transition(item, action, reason, key)} />
    ) },
  ];

  return (
    <Page
      title="Phát hành replay"
      description="Chọn trận đã hoàn tất, xem checksum đã lưu và công bố replay để khán giả xem lại. Server sẽ xác minh toàn vẹn trước mỗi lần chuyển trạng thái; trang này không có điều khiển trận trực tiếp."
    >
      <p className="ra-eyebrow">BTC · SAU KHI TRẬN KẾT THÚC</p>

      <Card className="ra-summary">
        <div className="ra-summary-row">
          <p className="ra-count">{total} trận đủ điều kiện</p>
          <Button variant="secondary" onClick={() => void load()} disabled={loading || busyMatch !== null}>Làm mới</Button>
        </div>
        <p className="ra-legend">Vòng đời replay: Riêng tư → Đang chờ duyệt → Đã công bố. Replay vòng loại luôn riêng tư — không công khai.</p>
      </Card>

      {error && (
        <Alert tone="danger">
          <p className="ra-alert-text">{error}</p>
          <Button variant="secondary" onClick={() => void load()}>Thử lại</Button>
        </Alert>
      )}
      {loading && <p className="ra-state-note" role="status" aria-busy="true">Đang tải danh sách replay…</p>}
      {!loading && !error && items.length === 0 && <Card className="ra-empty"><p>Chưa có replay đủ điều kiện phát hành.</p></Card>}

      {!loading && items.length > 0 && (
        <Card className="ra-catalog">
          <Table caption="Danh sách trận đã kết thúc" columns={columns} rows={items} rowKey={(item) => item.matchId} emptyMessage="Chưa có replay đủ điều kiện phát hành." />
        </Card>
      )}

      <nav className="ra-pagination" aria-label="Phân trang replay">
        <Button variant="secondary" disabled={loading || busyMatch !== null || page <= 1} onClick={() => setPage(page - 1)}>Trang trước</Button>
        <span>Trang {page}{totalPages > 0 ? ` / ${totalPages}` : ''}</span>
        <Button variant="secondary" disabled={loading || busyMatch !== null || page >= totalPages} onClick={() => setPage(page + 1)}>Trang sau</Button>
      </nav>
    </Page>
  );
}
