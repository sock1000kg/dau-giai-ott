import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createTeam, listTeams, resetTeamCredential, TeamApiError, type TeamCredential, type TeamSummary } from './api.ts';
import { CredentialOnce } from './CredentialOnce.tsx';

type OneTimeCredential = Readonly<{ teamName: string; credential: TeamCredential }>;

function errorMessage(error: unknown): string {
  if (error instanceof TeamApiError && error.code === 'TEAM_NAME_TAKEN') return 'Tên đội đã tồn tại.';
  if (error instanceof TeamApiError && error.status === 403) return 'Tài khoản không có quyền quản lý đội thi.';
  return 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}

export function TeamProvisionPage() {
  const [teams, setTeams] = useState<readonly TeamSummary[]>([]);
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [oneTimeCredential, setOneTimeCredential] = useState<OneTimeCredential | null>(null);

  const loadTeams = useCallback(async () => {
    setListStatus('loading');
    setListError(null);
    try {
      setTeams(await listTeams());
      setListStatus('ready');
    } catch (error) {
      setListError(errorMessage(error));
      setListStatus('error');
    }
  }, []);

  useEffect(() => { void loadTeams(); }, [loadTeams]);

  useEffect(() => {
    const clearCredentialOnNavigation = () => setOneTimeCredential(null);
    window.addEventListener('pagehide', clearCredentialOnNavigation);
    return () => window.removeEventListener('pagehide', clearCredentialOnNavigation);
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = teamName.trim();
    if (normalizedName.length === 0 || normalizedName.length > 100) {
      setActionError('Tên đội phải có từ 1 đến 100 ký tự.');
      return;
    }
    setWorking(true);
    setActionError(null);
    try {
      const created = await createTeam(normalizedName);
      setTeams((current) => [...current, created.team].sort((left, right) => left.name.localeCompare(right.name)));
      setTeamName('');
      setOneTimeCredential({ teamName: created.team.name, credential: created.credential });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function handleReset(team: TeamSummary) {
    if (!window.confirm(`Cấp thông tin đăng nhập mới cho đội ${team.name}? Thông tin cũ sẽ mất hiệu lực.`)) return;
    setWorking(true);
    setActionError(null);
    setOneTimeCredential(null);
    try {
      const credential = await resetTeamCredential(team.id);
      setOneTimeCredential({ teamName: team.name, credential });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="admin-page">
      <div className="eyebrow"><span aria-hidden="true" /> QUẢN TRỊ GIẢI ĐẤU</div>
      <a className="admin-back-link" href="/admin">← Về khu vực BTC</a>
      <h1>Quản lý đội thi</h1>
      <p className="welcome-copy">Tạo tài khoản cho đội và gửi thông tin đăng nhập qua kênh riêng.</p>

      {actionError !== null && <p role="alert">{actionError}</p>}
      {oneTimeCredential !== null && (
        <CredentialOnce
          teamName={oneTimeCredential.teamName}
          credential={oneTimeCredential.credential}
          onDismiss={() => setOneTimeCredential(null)}
        />
      )}

      {oneTimeCredential === null && (
        <form className="team-create-form" aria-label="Tạo đội" onSubmit={(event) => void handleCreate(event)}>
          <label htmlFor="team-name">Tên đội</label>
          <div className="team-create-row">
            <input
              id="team-name"
              name="name"
              required
              maxLength={100}
              value={teamName}
              onChange={(event) => setTeamName(event.currentTarget.value)}
            />
            <button type="submit" disabled={working}>{working ? 'Đang tạo…' : 'Tạo tài khoản đội'}</button>
          </div>
        </form>
      )}

      <section className="team-list" aria-labelledby="team-list-heading">
        <div className="team-list-heading">
          <h2 id="team-list-heading">Danh sách đội</h2>
          <button type="button" className="button-secondary" disabled={listStatus === 'loading'} onClick={() => void loadTeams()}>
            Làm mới
          </button>
        </div>
        {listStatus === 'loading' && <p role="status">Đang tải danh sách đội…</p>}
        {listStatus === 'error' && <p role="alert">{listError}</p>}
        {listStatus === 'ready' && teams.length === 0 && <p>Chưa có đội nào.</p>}
        {listStatus === 'ready' && teams.length > 0 && (
          <ul>
            {teams.map((team) => (
              <li key={team.id}>
                <span>{team.name}</span>
                <button type="button" className="button-secondary" disabled={working || oneTimeCredential !== null} onClick={() => void handleReset(team)}>
                  Cấp lại thông tin đăng nhập — {team.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
