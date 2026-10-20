import { useEffect, useState } from 'react';
import { fetchFinalsSnapshot, type FinalsSnapshotPayload } from './api.ts';
import { GroupStandings } from './GroupStandings.tsx';
import { FinalsSchedule } from './FinalsSchedule.tsx';

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
      <main className="leaderboard-page" aria-busy="true">
        <h1>Vòng Chung kết (Finals) · OTT Tournament</h1>
        <p role="status">Đang tải dữ liệu snapshot vòng chung kết…</p>
      </main>
    );
  }

  if (failed && !snapshot) {
    return (
      <main className="leaderboard-page">
        <h1>Vòng Chung kết (Finals) · OTT Tournament</h1>
        <p role="alert" style={{ color: '#ffb6ad' }}>
          {errorMessage ?? 'Không thể tải snapshot vòng chung kết. Trang sẽ tự động thử lại.'}
        </p>
      </main>
    );
  }

  if (!snapshot) return null;

  const isStale = failed || now - Date.parse(snapshot.updatedAt) > 90_000;

  return (
    <main className="leaderboard-page finals-page" aria-label="Trang thông tin Vòng Chung kết">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <span className="eyebrow" style={{ color: '#ffd59a' }}>VÒNG CHUNG KẾT · 8 ĐỘI TRANH TÀI</span>
          <h1 style={{ margin: '6px 0 2px' }}>Vòng Chung kết (Finals)</h1>
          <p style={{ color: '#a8b8c8', margin: 0, fontSize: '13px' }}>
            Giải đấu: <code>{snapshot.tournamentId}</code> · Bộ luật: <code>{snapshot.finalsRuleSetId}</code>
          </p>
        </div>

        <div style={{ textAlign: 'right', fontSize: '12px', color: '#8ea4b7' }}>
          <div>Cập nhật: <time dateTime={snapshot.updatedAt}>{snapshot.updatedAt}</time></div>
          {isStale && (
            <span role="alert" style={{ color: '#ffd59a', fontWeight: 'bold' }}>
              [Dữ liệu cũ - Đang giữ bản cập nhật cuối]
            </span>
          )}
        </div>
      </div>

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
  );
}

