import { TeamProvisionPage } from '../features/admin-teams/TeamProvisionPage.tsx';
import { SubmissionForm } from '../features/submissions/SubmissionForm.tsx';
import { LoginPage } from '../features/auth/LoginPage.tsx';
import { MatchResultsPage } from '../features/results/MatchResultsPage.tsx';
import { ReplayCatalog } from '../features/replay-admin/ReplayCatalog.tsx';
import { PrivateReplayPage } from '../pages/PrivateReplayPage.tsx';
import { RoundAdminPage } from '../features/round-admin/RoundAdminPage.tsx';
import { OperationsConsole } from '../features/operations/OperationsConsole.tsx';
import { useAuth } from '../features/auth/AuthProvider.tsx';
import { HomePage } from '../features/home/HomePage.tsx';
import { AppShellLayout } from '../ui/AppShellLayout.tsx';
import { Alert, Button, Card, LinkButton } from '../ui/index.ts';

function SessionUnavailable({ retry }: Readonly<{ retry: () => void }>) {
  return (
    <main className="ui-page">
      <Card>
        <h1>Chưa thể kiểm tra phiên đăng nhập</h1>
        <Alert tone="danger">Vui lòng kiểm tra kết nối rồi thử lại.</Alert>
        <Button onClick={retry}>Thử lại</Button>
      </Card>
    </main>
  );
}

function AccessDenied() {
  return (
    <main className="ui-page">
      <Card>
        <h1>Không có quyền truy cập</h1>
        <p>Tài khoản hiện tại không được phép mở khu vực này.</p>
        <LinkButton href="/">Về trang phù hợp với tài khoản</LinkButton>
      </Card>
    </main>
  );
}

export function AuthRoutes() {
  const auth = useAuth();
  if (auth.state.status === 'loading') {
    return <main className="ui-page" aria-busy="true"><Card><p role="status">Đang kiểm tra phiên đăng nhập…</p></Card></main>;
  }
  if (auth.state.status === 'error') return <SessionUnavailable retry={() => void auth.restoreSession()} />;
  if (auth.state.status === 'anonymous') return <LoginPage />;

  const role = auth.state.principal.role;
  const path = window.location.pathname;
  return (
    <AppShellLayout role={role} pathname={path} onLogout={auth.logout}>
      {renderAuthenticated(role, path)}
    </AppShellLayout>
  );
}

function renderAuthenticated(role: 'BTC_ADMIN' | 'TEAM_ACCOUNT', path: string) {
  const expectedPath = role === 'BTC_ADMIN' ? '/admin' : '/team';
  const isTeamAdminPage = role === 'BTC_ADMIN' && path === '/admin/teams';
  const isTeamSubmissionPage = role === 'TEAM_ACCOUNT' && path === '/team/submissions';
  const isReplayAdminPage = role === 'BTC_ADMIN' && path === '/admin/replays';
  const isRoundAdminPage = role === 'BTC_ADMIN' && path === '/admin/rounds';
  const isOperationsPage = role === 'BTC_ADMIN' && path === '/admin/operations';
  const isResultsPage = (role === 'BTC_ADMIN' && path === '/admin/results') || (role === 'TEAM_ACCOUNT' && path === '/team/results');
  const isTeamReplayPage = role === 'TEAM_ACCOUNT' && path.startsWith('/team/replays/');
  const isAdminReplayViewPage = role === 'BTC_ADMIN' && path.startsWith('/admin/replays/') && path.endsWith('/view');
  if (path !== '/' && path !== '/login' && path !== expectedPath && !isTeamAdminPage && !isTeamSubmissionPage && !isReplayAdminPage && !isRoundAdminPage && !isOperationsPage && !isResultsPage && !isTeamReplayPage && !isAdminReplayViewPage) return <AccessDenied />;
  if (isTeamAdminPage) return <TeamProvisionPage />;
  if (isTeamSubmissionPage) return <SubmissionForm />;
  if (isReplayAdminPage) return <ReplayCatalog />;
  if (isRoundAdminPage) return <RoundAdminPage />;
  if (isOperationsPage) return <OperationsConsole />;
  if (isResultsPage) return <MatchResultsPage isAdmin={role === 'BTC_ADMIN'} />;
  if (isTeamReplayPage) {
    const matchId = path.slice('/team/replays/'.length);
    return <PrivateReplayPage matchId={matchId} />;
  }
  if (isAdminReplayViewPage) {
    const matchId = path.slice('/admin/replays/'.length, -'/view'.length);
    return <PrivateReplayPage matchId={matchId} />;
  }
  return <HomePage role={role} />;
}
