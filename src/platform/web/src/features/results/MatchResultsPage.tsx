import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Field, Page, Select } from '../../ui/index.ts';
import { listResultTeams, listResults, ResultsApiError, type MatchResult, type SeriesResult } from './api.ts';
import { MatchResultsTable } from './MatchResultsTable.tsx';
import { SeriesResults } from './SeriesResults.tsx';
import { stageOptions } from './stages.ts';
import './results.css';

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
  const [seenStages, setSeenStages] = useState<ReadonlySet<string>>(new Set());
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
      setSeenStages((previous) => new Set([...previous, ...result.items.map((item) => item.stage)]));
      if (kind === 'matches') { setMatches(result.items as readonly MatchResult[]); setSeries([]); }
      else { setSeries(result.items as readonly SeriesResult[]); setMatches([]); }
    } catch (cause) { setError(failureMessage(cause)); }
    finally { setLoading(false); }
  }, [isAdmin, kind, page, stage, teamId]);

  useEffect(() => { void load(); }, [load]);
  const setFilter = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLSelectElement>) => { setter(event.target.value); setPage(1); };
  const options = useMemo(() => stageOptions([...seenStages, stage]), [seenStages, stage]);
  const count = kind === 'matches' ? matches.length : series.length;
  const empty = count === 0;

  return (
    <Page title="Kết quả thi đấu" description="Kết quả đã chốt được cung cấp từ hệ thống giải đấu; trang này chỉ đọc và không can thiệp trận.">
      <Card className="results-filter-card"><div className="results-filters" role="group" aria-label="Bộ lọc kết quả">
        <Field label="Loại kết quả" help="Xem từng trận hoặc cả loạt trận.">
          <Select value={kind} onChange={(event) => { setKind(event.target.value as 'matches' | 'series'); setPage(1); }}><option value="matches">Từng trận</option><option value="series">Loạt trận</option></Select>
        </Field>
        {isAdmin && <Field label="Đội thi" help="Chỉ hiện kết quả của đội được chọn.">
          <Select value={teamId} onChange={setFilter(setTeamId)}><option value="">Tất cả đội</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</Select>
        </Field>}
        <Field label="Vòng/stage" help="Lọc theo vòng đấu.">
          <Select value={stage} onChange={setFilter(setStage)}><option value="">Tất cả vòng</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
        </Field>
        <div className="results-refresh"><Button variant="secondary" onClick={() => void load()} disabled={loading}>Làm mới</Button></div>
      </div></Card>
      {!loading && !error && !empty && <p className="results-summary">Hiển thị {count} kết quả · Trang {page}{totalPages ? ` / ${totalPages}` : ''}</p>}
      {error && <Alert tone="danger"><p>{error}</p><Button variant="secondary" onClick={() => void load()}>Thử lại</Button></Alert>}
      {loading ? <div className="ui-empty" role="status" aria-busy="true">Đang tải kết quả…</div> : !error && empty ? <div className="ui-empty">Chưa có kết quả phù hợp.</div> : null}
      {!loading && !error && kind === 'matches' && matches.length > 0 && <MatchResultsTable items={matches} isAdmin={isAdmin} />}
      {!loading && !error && kind === 'series' && series.length > 0 && <SeriesResults items={series} />}
      <nav className="results-pagination" aria-label="Phân trang kết quả"><Button variant="secondary" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Trang trước</Button><span>Trang {page}{totalPages ? ` / ${totalPages}` : ''}</span><Button variant="secondary" disabled={loading || totalPages === 0 || page >= totalPages} onClick={() => setPage(page + 1)}>Trang sau</Button></nav>
    </Page>
  );
}
