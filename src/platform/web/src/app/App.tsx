import './styles.css';
import { AuthProvider } from '../features/auth/AuthProvider.tsx';
import { AuthRoutes } from './routes.tsx';

export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#main" aria-label="Giải đấu OTT - trang chủ">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>OTT Arena</span>
        </a>
        <span className="header-label">NỀN TẢNG GIẢI ĐẤU</span>
      </header>

      <AuthProvider>
        <AuthRoutes />
      </AuthProvider>

      <footer className="app-footer">
        <span>OTT Arena</span>
        <span>Giao diện local</span>
      </footer>
    </div>
  );
}
