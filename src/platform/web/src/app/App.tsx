import './styles.css';
import { AuthProvider } from '../features/auth/AuthProvider.tsx';
import { AuthRoutes } from './routes.tsx';
import { LeaderboardPage } from '../features/leaderboard/LeaderboardPage.tsx';

export function App() {
  const isPublicLeaderboard = window.location.pathname === '/leaderboard';
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Giải đấu OTT - trang chủ">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>OTT Arena</span>
        </a>
        <span className="header-label">NỀN TẢNG GIẢI ĐẤU</span>
        <a className="public-nav-link" href="/leaderboard">Bảng xếp hạng</a>
      </header>

      {isPublicLeaderboard ? <LeaderboardPage /> : <AuthProvider><AuthRoutes /></AuthProvider>}

      <footer className="app-footer">
        <span>OTT Arena</span>
        <span>Giao diện local</span>
      </footer>
    </div>
  );
}
