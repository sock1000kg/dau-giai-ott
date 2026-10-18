import './styles.css';
import { PublicTournamentPage } from '../features/public/PublicTournamentPage.tsx';
import { AuthProvider } from '../features/auth/AuthProvider.tsx';
import { AuthRoutes } from './routes.tsx';
import { LeaderboardPage } from '../features/leaderboard/LeaderboardPage.tsx';
import { SpectatorReplayPage } from '../pages/SpectatorReplayPage.tsx';

export function App() {
  const isPublicLeaderboard = window.location.pathname === '/leaderboard';
  const replayMatch = window.location.pathname.match(/^\/spectator\/replays\/([^/]+)$/);
  const isPublicReplay = replayMatch !== null;
  const replayMatchId = replayMatch?.[1] ?? '';
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Giải đấu OTT - trang chủ">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>OTT Arena</span>
        </a>
        <span className="header-label">NỀN TẢNG GIẢI ĐẤU</span>
        <a className="public-nav-link" href="/public">Thông tin giải đấu</a>
        <a className="public-nav-link" href={window.location.pathname === '/public' ? '#leaderboard' : '/leaderboard'}>Bảng xếp hạng</a>
      </header>

      {window.location.pathname === '/public' ? <PublicTournamentPage /> : isPublicLeaderboard ? <LeaderboardPage />
        : isPublicReplay ? <SpectatorReplayPage matchId={replayMatchId} />
          : <AuthProvider><AuthRoutes /></AuthProvider>}

      <footer className="app-footer">
        <span>OTT Arena</span>
        <span>Giao diện local</span>
      </footer>
    </div>
  );
}
