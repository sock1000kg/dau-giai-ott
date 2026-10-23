import { useEffect, useState } from 'react';
import { fetchTestRunReplay } from './api.ts';
import { ReplayPlayer } from '../spectator/ReplayPlayer.tsx';
import { SpectatorReplayError, type SpectatorReplay } from '../spectator/replay-schema.ts';
import { Alert, Button } from '../../ui/index.ts';
import './test-runs.css';

function messageFor(error: unknown): string {
  if (error instanceof SpectatorReplayError && error.code === 'REPLAY_NOT_FOUND') return 'Lượt chạy chưa có replay hoặc bạn không có quyền xem.';
  if (error instanceof SpectatorReplayError && error.code === 'CHECKSUM_MISMATCH') return 'Replay không vượt qua kiểm tra toàn vẹn.';
  if (error instanceof SpectatorReplayError && error.code === 'UNSUPPORTED_SCHEMA') return 'Phiên bản replay này chưa được hỗ trợ.';
  if (error instanceof SpectatorReplayError && error.code === 'UNAUTHENTICATED') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  return 'Không thể tải replay lượt chạy thử lúc này.';
}

export function TestRunReplayPage({ testRunId }: Readonly<{ testRunId: string }>) {
  const [replay, setReplay] = useState<SpectatorReplay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void fetchTestRunReplay(testRunId).then((verified) => {
      if (active) setReplay(verified);
    }).catch((cause: unknown) => {
      if (active) setError(messageFor(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [attempt, testRunId]);

  return (
    <main className="ui-page rp-page">
      <header className="ui-page-header">
        <p className="test-runs-eyebrow">REPLAY RIÊNG CỦA ĐỘI</p>
        <h1>Replay lượt chạy thử</h1>
        <p>Replay chỉ được phát sau khi checksum và định dạng được xác minh.</p>
      </header>
      {loading && <p className="rp-state" role="status">Đang tải và xác minh replay…</p>}
      {!loading && error && <Alert tone="danger"><div className="rp-error"><p>{error}</p><Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Thử lại</Button></div></Alert>}
      {!loading && replay && <ReplayPlayer replay={replay} />}
    </main>
  );
}
