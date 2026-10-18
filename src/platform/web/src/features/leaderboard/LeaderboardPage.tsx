import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Page, Select } from '../../ui/index.ts';
import { LeaderboardApiError, listLeaderboard, type LeaderboardEntry } from './api.ts';
import { LeaderboardTable } from './LeaderboardTable.tsx';
import './leaderboard.css';

const PAGE_SIZE = 25;

const KNOWN_STAGES: readonly (readonly [string, string])[] = [['QUALIFICATION', 'Vòng loại'], ['FINALS', 'Chung kết']];

/** Known stages plus any other stage currently in use, so it stays selectable. */
export function stageOptions(...current: readonly string[]): readonly (readonly [string, string])[] {
  const extras = [...new Set(current)].filter((value) => value !== '' && !KNOWN_STAGES.some(([known]) => known === value));
  return [...KNOWN_STAGES, ...extras.map((value) => [value, value] as const)];
}

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

  const showTable = !loading && !error && items.length > 0;
  return (
    <Page
      title="Bảng xếp hạng"
      description="Thứ hạng và các chỉ số chính thức do máy chủ giải đấu tính. Các đội đồng hạng được giữ cùng hạng."
    >
      <p className="pub-eyebrow">OTT ARENA · BẢNG ĐIỂM CÔNG KHAI</p>
      <Card as="div">
        <form className="pub-filters" onSubmit={applyStage} aria-label="Lọc bảng xếp hạng">
          <Field label="Vòng đấu / stage">
            <Select id="leaderboard-stage" value={draftStage} onChange={(event) => setDraftStage(event.target.value)}>
              {stageOptions(stage, draftStage).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Button variant="primary" type="submit" disabled={loading}>Áp dụng</Button>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>Làm mới</Button>
        </form>
      </Card>
      {error && <Alert tone="danger"><p className="pub-alert-text">{error}</p><Button variant="secondary" onClick={() => void load()}>Thử lại</Button></Alert>}
      {loading
        ? <div className="pub-state" role="status" aria-busy="true">Đang tải bảng xếp hạng…</div>
        : !error && items.length === 0 ? <div className="pub-state">Chưa có dữ liệu bảng xếp hạng cho vòng đấu này.</div> : null}
      {showTable && <p className="pub-summary">Hiển thị {items.length} đội · Trang {page}{totalPages ? ` / ${totalPages}` : ''}</p>}
      {showTable && <LeaderboardTable items={items} />}
      <nav className="pub-pagination" aria-label="Phân trang bảng xếp hạng">
        <Button variant="secondary" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Trang trước</Button>
        <span>Trang {page}{totalPages ? ` / ${totalPages}` : ''}</span>
        <Button variant="secondary" disabled={loading || totalPages === 0 || page >= totalPages} onClick={() => setPage(page + 1)}>Trang sau</Button>
      </nav>
      <Card as="div" className="pub-note">
        <p>Thứ hạng và Elo do hệ thống giải đấu tính từ kết quả đã chốt. Các đội bằng điểm được giữ cùng hạng; thứ tự cuối cùng khi chọn đội vào chung kết sẽ được công bố riêng.</p>
      </Card>
    </Page>
  );
}
