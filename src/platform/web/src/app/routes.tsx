import { useState } from 'react';
import { TeamProvisionPage } from '../features/admin-teams/TeamProvisionPage.tsx';
import { SubmissionForm } from '../features/submissions/SubmissionForm.tsx';
import { LoginPage } from '../features/auth/LoginPage.tsx';
import { MatchResultsPage } from '../features/results/MatchResultsPage.tsx';
import { ReplayCatalog } from '../features/replay-admin/ReplayCatalog.tsx';
import { RoundAdminPage } from '../features/round-admin/RoundAdminPage.tsx';
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
      {role === 'BTC_ADMIN' && <a href="/admin/teams">Quản lý đội thi</a>}
      {role === 'BTC_ADMIN' && <a href="/admin/replays">Phát hành replay</a>}
      {role === 'BTC_ADMIN' && <a href="/admin/rounds">Vận hành round</a>}
      {role === 'TEAM_ACCOUNT' && <a href="/team/submissions">Nộp bot và xem trạng thái</a>}
      <a href={role === 'BTC_ADMIN' ? '/admin/results' : '/team/results'}>Kết quả thi đấu</a>
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
  const isTeamAdminPage = role === 'BTC_ADMIN' && path === '/admin/teams';
  const isTeamSubmissionPage = role === 'TEAM_ACCOUNT' && path === '/team/submissions';
  const isReplayAdminPage = role === 'BTC_ADMIN' && path === '/admin/replays';
  const isRoundAdminPage = role === 'BTC_ADMIN' && path === '/admin/rounds';
  const isResultsPage = (role === 'BTC_ADMIN' && path === '/admin/results') || (role === 'TEAM_ACCOUNT' && path === '/team/results');
  if (path !== '/' && path !== '/login' && path !== expectedPath && !isTeamAdminPage && !isTeamSubmissionPage && !isReplayAdminPage && !isRoundAdminPage && !isResultsPage) return <AccessDenied />;
  if (isTeamAdminPage) return <TeamProvisionPage />;
  if (isTeamSubmissionPage) return <SubmissionForm />;
  if (isReplayAdminPage) return <ReplayCatalog />;
  if (isRoundAdminPage) return <RoundAdminPage />;
  if (isResultsPage) return <MatchResultsPage isAdmin={role === 'BTC_ADMIN'} />;
  return <Workspace role={role} onLogout={auth.logout} />;
}
