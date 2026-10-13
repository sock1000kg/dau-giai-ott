import { useState } from 'react';
import { LoginPage } from '../features/auth/LoginPage.tsx';
import { useAuth } from '../features/auth/AuthProvider.tsx';

function SessionUnavailable({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <main className="welcome-panel">
      <h1>Chưa thể kiểm tra phiên đăng nhập</h1>
      <p role="alert">Vui lòng kiểm tra kết nối rồi thử lại.</p>
      <button type="button" onClick={retry}>Thử lại</button>
    </main>
  );
}

function AccessDenied() {
  return (
    <main className="welcome-panel">
      <h1>Không có quyền truy cập</h1>
      <p>Tài khoản hiện tại không được phép mở khu vực này.</p>
      <a href="/">Về trang phù hợp với tài khoản</a>
    </main>
  );
}

function Workspace({ role, onLogout }: Readonly<{ role: 'BTC_ADMIN' | 'TEAM_ACCOUNT'; onLogout: () => Promise<void> }>) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutFailed(false);
    try {
      await onLogout();
    } catch {
      setLogoutFailed(true);
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="welcome-panel">
      <div className="eyebrow"><span aria-hidden="true" /> ĐÃ ĐĂNG NHẬP</div>
      <h1>{role === 'BTC_ADMIN' ? 'Khu vực BTC' : 'Cổng đội thi'}</h1>
      <p className="welcome-copy">{role === 'BTC_ADMIN' ? 'Tài khoản Ban tổ chức.' : 'Tài khoản đội thi.'}</p>
      {logoutFailed && <p role="alert">Không thể đăng xuất lúc này. Vui lòng thử lại.</p>}
      <button type="button" disabled={loggingOut} onClick={() => void handleLogout()}>
        {loggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
      </button>
    </main>
  );
}

export function AuthRoutes() {
  const auth = useAuth();
  if (auth.state.status === 'loading') {
    return <main className="welcome-panel" aria-busy="true"><p role="status">Đang kiểm tra phiên đăng nhập…</p></main>;
  }
  if (auth.state.status === 'error') return <SessionUnavailable retry={() => void auth.restoreSession()} />;
  if (auth.state.status === 'anonymous') return <LoginPage />;

  const role = auth.state.principal.role;
  const path = window.location.pathname;
  const expectedPath = role === 'BTC_ADMIN' ? '/admin' : '/team';
  if (path !== '/' && path !== '/login' && path !== expectedPath) return <AccessDenied />;
  return <Workspace role={role} onLogout={auth.logout} />;
}
