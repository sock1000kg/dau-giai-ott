import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  bulkResetTeamCredentials,
  createTeam,
  isTeamApiError,
  listTeams,
  resetTeamCredential,
  TeamApiError,
  type TeamCredential,
  type TeamSummary,
} from './api.ts';
import { Alert, Button, Card, Field, Input, Page } from '../../ui/index.ts';
import { BulkProvision, downloadCredentialBlob } from './BulkProvision.tsx';
import { CredentialOnce } from './CredentialOnce.tsx';
import './admin-teams.css';

type OneTimeCredential = Readonly<{ teamName: string; credential: TeamCredential }>;

function errorMessage(error: unknown): string {
  if (isTeamApiError(error) && error.code === 'TEAM_NAME_TAKEN') return 'Tên đội đã tồn tại.';
  if (isTeamApiError(error) && error.status === 403) return 'Tài khoản không có quyền quản lý đội thi.';
  return 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}

export function TeamProvisionPage() {
  const [teams, setTeams] = useState<readonly TeamSummary[]>([]);
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const [oneTimeCredential, setOneTimeCredential] = useState<OneTimeCredential | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const loadTeams = useCallback(async () => {
    setListStatus('loading');
    setListError(null);
    try {
      const data = await listTeams();
      setTeams(data);
      setListStatus('ready');
    } catch (error) {
      setListError(errorMessage(error));
      setListStatus('error');
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    const clearCredentialOnNavigation = () => setOneTimeCredential(null);
    window.addEventListener('pagehide', clearCredentialOnNavigation);
    return () => window.removeEventListener('pagehide', clearCredentialOnNavigation);
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = teamName.trim();
    if (normalizedName.length === 0 || normalizedName.length > 100) {
      setCreateError('Tên đội phải có từ 1 đến 100 ký tự.');
      return;
    }
    setWorking(true);
    setActionError(null);
    setCreateError(null);
    try {
      const created = await createTeam(normalizedName);
      setTeams((current) => [...current, created.team].sort((left, right) => left.name.localeCompare(right.name)));
      setTeamName('');
      setOneTimeCredential({ teamName: created.team.name, credential: created.credential });
    } catch (error) {
      if (isTeamApiError(error) && error.code === 'TEAM_NAME_TAKEN') setCreateError(errorMessage(error));
      else setActionError(errorMessage(error));
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

  async function handleBulkReset() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!window.confirm(`Cấp lại mật khẩu cho ${count} đội đã chọn? Thông tin cũ sẽ mất hiệu lực.`)) return;
    setWorking(true);
    setActionError(null);
    setBulkNotice(null);
    try {
      const { blob, filename } = await bulkResetTeamCredentials(Array.from(selectedIds));
      downloadCredentialBlob(blob, filename);
      setBulkNotice(`Đã tải file ${filename} — xóa file sau khi gửi`);
      setSelectedIds(new Set());
    } catch (error) {
      if (isTeamApiError(error) && error.status === 403) {
        setActionError('Tài khoản không có quyền quản lý đội thi.');
      } else {
        setActionError(errorMessage(error));
      }
    } finally {
      setWorking(false);
    }
  }

  function toggleSelectAll() {
    if (teams.length > 0 && selectedIds.size === teams.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(teams.map((t) => t.id)));
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  }

  const allSelected = teams.length > 0 && selectedIds.size === teams.length;

  return (
    <Page
      title="Quản lý đội thi"
      description="Tạo tài khoản cho đội và gửi thông tin đăng nhập qua kênh riêng."
      actions={<a className="ui-button ui-button--ghost" href="/admin">← Về khu vực BTC</a>}
    >
      {actionError !== null && <Alert tone="danger">{actionError}</Alert>}
      {bulkNotice !== null && <Alert tone="success">{bulkNotice}</Alert>}

      {oneTimeCredential !== null && (
        <CredentialOnce
          teamName={oneTimeCredential.teamName}
          credential={oneTimeCredential.credential}
          onDismiss={() => setOneTimeCredential(null)}
        />
      )}

      {oneTimeCredential === null && (
        <Card title="Tạo đội mới">
          <p className="teams-card-desc">Chỉ cần tên đội; hệ thống tự sinh tài khoản và mật khẩu.</p>
          <form className="teams-form" aria-label="Tạo đội" onSubmit={(event) => void handleCreate(event)}>
            <Field
              label="Tên đội"
              help="Tối đa 100 ký tự, không trùng tên đội khác"
              {...(createError === null ? {} : { error: createError })}
            >
              <Input
                id="team-name"
                name="name"
                required
                maxLength={100}
                value={teamName}
                onChange={(event) => setTeamName(event.currentTarget.value)}
              />
            </Field>
            {createError !== null && <span role="alert" className="teams-sr-only">{createError}</span>}
            <p className="teams-counter">{teamName.length}/100</p>
            <Button type="submit" loading={working}>{working ? 'Đang tạo…' : 'Tạo tài khoản đội'}</Button>
          </form>
        </Card>
      )}

      <BulkProvision onImportSuccess={loadTeams} />

      <Card title="Danh sách đội">
        <div className="ui-stack">
          <div className="teams-toolbar">
            <p className="teams-count">Đã chọn {selectedIds.size}/{teams.length}</p>
            <div className="ui-row">
              <Button
                variant="secondary"
                disabled={working || selectedIds.size === 0}
                onClick={() => void handleBulkReset()}
              >
                Cấp lại mật khẩu hàng loạt
              </Button>
              <Button variant="secondary" disabled={listStatus === 'loading'} onClick={() => void loadTeams()}>
                Làm mới
              </Button>
            </div>
          </div>

          {listStatus === 'loading' && <p role="status">Đang tải danh sách đội…</p>}
          {listStatus === 'error' && <Alert tone="danger">{listError}</Alert>}
          {listStatus === 'ready' && teams.length === 0 && <div className="ui-empty">Chưa có đội nào.</div>}
          {listStatus === 'ready' && teams.length > 0 && (
            <div className="ui-table-scroll">
              <table className="ui-table teams-table">
                <caption>Danh sách đội thi</caption>
                <thead>
                  <tr>
                    <th scope="col" className="teams-col-check">
                      <label className="teams-check">
                        <input type="checkbox" aria-label="Chọn tất cả" checked={allSelected} onChange={toggleSelectAll} />
                      </label>
                    </th>
                    <th scope="col">Tên đội</th>
                    <th scope="col">Email đại diện</th>
                    <th scope="col">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id}>
                      <td className="teams-col-check">
                        <label className="teams-check">
                          <input
                            type="checkbox"
                            aria-label={`Chọn đội ${team.name}`}
                            checked={selectedIds.has(team.id)}
                            onChange={() => toggleSelect(team.id)}
                          />
                        </label>
                      </td>
                      <td>{team.name}</td>
                      <td className="teams-col-email">{team.representativeEmail ?? '—'}</td>
                      <td>
                        <Button
                          variant="secondary"
                          disabled={working || oneTimeCredential !== null}
                          onClick={() => void handleReset(team)}
                        >
                          Cấp lại thông tin đăng nhập — {team.name}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </Page>
  );
}
