import { useEffect, useState } from 'react';
import { fetchPublicReplay } from '../features/spectator/api.ts';
import { ReplayPlayer } from '../features/spectator/ReplayPlayer.tsx';
import { SpectatorReplayError } from '../features/spectator/replay-schema.ts';
import { Alert, Button } from '../ui/index.ts';
import type { SpectatorReplayV1 } from '../features/spectator/replay-schema.ts';

function messageFor(error: unknown): string {
  if (error instanceof SpectatorReplayError && error.code === 'REPLAY_NOT_FOUND') return 'Replay này không tồn tại hoặc chưa được BTC công khai.';
  if (error instanceof SpectatorReplayError && error.code === 'CHECKSUM_MISMATCH') return 'Dữ liệu replay không vượt qua kiểm tra toàn vẹn.';
  if (error instanceof SpectatorReplayError && error.code === 'UNSUPPORTED_SCHEMA') return 'Phiên bản replay này chưa được hỗ trợ.';
  if (error instanceof SpectatorReplayError && error.code === 'INVALID_REPLAY') return 'Dữ liệu replay không hợp lệ.';
  return 'Không thể tải replay lúc này. Vui lòng thử lại.';
}

export function SpectatorReplayPage({ matchId }: { readonly matchId: string }) {
  const [replay, setReplay] = useState<SpectatorReplayV1 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void fetchPublicReplay(matchId).then((verified) => {
      if (active) setReplay(verified);
    }).catch((cause: unknown) => {
      if (active) setError(messageFor(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [attempt, matchId]);

  return (
    <main className="ui-page rp-page">
      <header className="ui-page-header">
        <p className="rp-eyebrow">KHÁN GIẢ · REPLAY CÔNG KHAI</p>
        <h1>Xem lại trận</h1>
        <p>Trận đã kết thúc được phát lại từ log đã công khai. Trang này chỉ trình chiếu, không kết nối hay can thiệp trận đang chạy.</p>
      </header>
      {loading && <p className="rp-state" role="status">Đang tải và xác minh replay…</p>}
      {!loading && error && <Alert tone="danger"><div className="rp-error"><p>{error}</p><Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Thử lại</Button></div></Alert>}
      {!loading && replay && <ReplayPlayer replay={replay} />}
    </main>
  );
}
