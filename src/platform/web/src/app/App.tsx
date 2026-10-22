import './styles.css';
import { PublicTournamentPage } from '../features/public/PublicTournamentPage.tsx';
import { AuthProvider } from '../features/auth/AuthProvider.tsx';
import { AuthRoutes } from './routes.tsx';
import { LeaderboardPage } from '../features/leaderboard/LeaderboardPage.tsx';
import { SpectatorReplayPage } from '../pages/SpectatorReplayPage.tsx';
import { FinalsPage } from '../features/finals/FinalsPage.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';

export function App() {
  const isFinalsPage = window.location.pathname === '/finals';
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
        <nav className="public-header-nav" aria-label="Điều hướng công khai">
          <a className="public-nav-link" href="/public" aria-current={window.location.pathname === '/public' ? 'page' : undefined}>Thông tin giải đấu</a>
          <a className="public-nav-link" href="/leaderboard" aria-current={isPublicLeaderboard ? 'page' : undefined}>Bảng xếp hạng</a>
          <a className="public-nav-link" href="/finals" aria-current={isFinalsPage ? 'page' : undefined}>Vòng chung kết</a>
          <ThemeToggle />
        </nav>
      </header>

      {window.location.pathname === '/public' ? <PublicTournamentPage /> : isFinalsPage ? <FinalsPage /> : isPublicLeaderboard ? <LeaderboardPage />
        : isPublicReplay ? <SpectatorReplayPage matchId={replayMatchId} />
          : <AuthProvider><AuthRoutes /></AuthProvider>}

      <footer className="app-footer">
        <span>OTT Arena</span>
        <span>Giao diện local</span>
      </footer>
    </div>
  );
}
