import { useEffect, useState } from 'react';
import { fetchFinalsSnapshot, type FinalsSnapshotPayload } from './api.ts';
import { GroupStandings } from './GroupStandings.tsx';
import { FinalsSchedule } from './FinalsSchedule.tsx';
import { Page } from '../../ui/index.ts';
import './finals.css';

export interface FinalsPageProps {
  readonly initialSnapshot?: FinalsSnapshotPayload | null;
}

export function FinalsPage({ initialSnapshot = null }: FinalsPageProps) {
  const [snapshot, setSnapshot] = useState<FinalsSnapshotPayload | null>(initialSnapshot);
  const [loading, setLoading] = useState<boolean>(!initialSnapshot);
  const [failed, setFailed] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function refresh() {
      try {
        const next = await fetchFinalsSnapshot(controller.signal);
        if (!stopped) {
          setSnapshot(next);
          setFailed(false);
          setErrorMessage(null);
          setLoading(false);
        }
      } catch (err) {
        if (!stopped) {
          setFailed(true);
          setErrorMessage(err instanceof Error ? err.message : 'Lỗi tải dữ liệu');
          setLoading(false);
        }
      }

      if (!stopped) {
        setNow(Date.now());
        timer = setTimeout(() => void refresh(), 30_000);
      }
    }

    void refresh();

    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  if (loading && !snapshot) {
    return (
      <Page title="Vòng Chung kết" description="Bảng đấu, lịch thi đấu và kết quả đã xác minh.">
        <p className="finals-state" role="status" aria-busy="true">Đang tải dữ liệu snapshot vòng chung kết…</p>
      </Page>
    );
  }

  if (failed && !snapshot) {
    return (
      <Page title="Vòng Chung kết" description="Bảng đấu, lịch thi đấu và kết quả đã xác minh.">
        <p className="finals-state finals-state--error" role="alert">
          {errorMessage ?? 'Không thể tải snapshot vòng chung kết. Trang sẽ tự động thử lại.'}
        </p>
      </Page>
    );
  }

  if (!snapshot) return null;

  const isStale = failed || now - Date.parse(snapshot.updatedAt) > 90_000;

  return (
    <Page title="Vòng Chung kết" description="Bảng đấu, lịch thi đấu và kết quả đã xác minh.">
      <main className="finals-page" aria-label="Trang thông tin Vòng Chung kết">
      <section className="finals-overview" aria-label="Tổng quan vòng chung kết">
        <div className="finals-overview-copy">
          <span className="eyebrow">VÒNG CHUNG KẾT · 8 ĐỘI TRANH TÀI</span>
          <h2>Nhánh đấu chính thức</h2>
          <p>Đối chiếu lịch, kết quả và bằng chứng phát hành của vòng chung kết.</p>
          <p style={{ color: '#a8b8c8', margin: 0, fontSize: '13px' }}>
            Giải đấu: <code>{snapshot.tournamentId}</code> · Bộ luật: <code>{snapshot.finalsRuleSetId}</code>
          </p>
        </div>

        <div className="finals-overview-meta">
          <div>Cập nhật lần cuối</div><time dateTime={snapshot.updatedAt}>{snapshot.updatedAt}</time>
          {isStale && (
            <span role="alert" className="finals-stale-badge">
              [Dữ liệu cũ - Đang giữ bản cập nhật cuối]
            </span>
          )}
        </div>
      </section>

      {/* Standings & Bracket */}
      <GroupStandings
        proof={snapshot.proof}
        standings={snapshot.standings}
        bracket={snapshot.bracket}
        isStale={isStale}
      />

      {/* Detailed Schedule & Results with Replay Links */}
      <FinalsSchedule bracket={snapshot.bracket} />
      </main>
    </Page>
  );
}

