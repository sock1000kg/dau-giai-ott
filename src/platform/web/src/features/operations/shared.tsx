import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Alert, Button, Card, Field, Input, Select } from '../../ui/index.ts';
import { listMatches, listTeams, operationsErrorMessage, type MatchOption, type TeamOption } from './api.ts';
import { formatVietnamDateTime } from '../../lib/format-date.ts';
import './operations.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value.trim());
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export const formatTime = formatVietnamDateTime;

export function matchLabel(match: MatchOption): string {
  return `${match.stage} · Game ${match.gameNumber} · ${match.teams.x.name} vs ${match.teams.o.name} · ${match.status}`;
}

/** Panel = Card + a named region (the heading names the section for assistive tech). */
export function Panel({ id, title, description, children }: Readonly<{ id: string; title: string; description: string; children: ReactNode }>) {
  return (
    <Card as="div">
      <section aria-labelledby={`${id}-title`} className="ui-stack">
        <div className="ops-panel-head">
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        {children}
      </section>
    </Card>
  );
}

/** Read-only table that always renders (caption stays discoverable) and shows an empty row. */
export function DataTable<Row>({ caption, columns, rows, rowKey, rowProps, emptyMessage }: Readonly<{
  caption: string;
  columns: readonly { readonly key: string; readonly header: string; readonly render: (row: Row) => ReactNode }[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  rowProps?: (row: Row) => HTMLAttributes<HTMLTableRowElement>;
  emptyMessage: string;
}>) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <caption>{caption}</caption>
        <thead><tr>{columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="ops-empty-cell">{emptyMessage}</td></tr>}
          {rows.map((row) => <tr key={rowKey(row)} {...rowProps?.(row)}>{columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

export function PageControls({ page, totalPages, busy, onPage }: Readonly<{ page: number; totalPages: number; busy?: boolean; onPage: (page: number) => void }>) {
  if (totalPages <= 1) return null;
  return (
    <nav className="ui-row" aria-label="Phân trang">
      <Button variant="secondary" disabled={busy === true || page <= 1} onClick={() => onPage(page - 1)}>Trang trước</Button>
      <span className="ops-muted">Trang {page}/{totalPages}</span>
      <Button variant="secondary" disabled={busy === true || page >= totalPages} onClick={() => onPage(page + 1)}>Trang sau</Button>
    </nav>
  );
}

// ---------------------------------------------------------------- directory (teams + matches seen so far)

type TeamsState = { readonly status: 'loading' } | { readonly status: 'error'; readonly message: string } | { readonly status: 'ready'; readonly teams: readonly TeamOption[] };

interface Directory {
  readonly teams: TeamsState;
  readonly reloadTeams: () => void;
  readonly teamName: (id: string | null) => string | null;
  readonly remember: (matches: readonly MatchOption[]) => void;
  readonly matchById: (id: string | null) => MatchOption | null;
}

const DirectoryContext = createContext<Directory | null>(null);

export function DirectoryProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [teams, setTeams] = useState<TeamsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [matches, setMatches] = useState<ReadonlyMap<string, MatchOption>>(new Map());

  useEffect(() => {
    let live = true;
    setTeams({ status: 'loading' });
    listTeams().then(
      (rows) => { if (live) setTeams({ status: 'ready', teams: rows }); },
      (cause: unknown) => { if (live) setTeams({ status: 'error', message: operationsErrorMessage(cause) }); },
    );
    return () => { live = false; };
  }, [attempt]);

  const reloadTeams = useCallback(() => setAttempt((value) => value + 1), []);
  const remember = useCallback((rows: readonly MatchOption[]) => {
    setMatches((current) => {
      const next = new Map(current);
      for (const row of rows) next.set(row.matchId, row);
      return next;
    });
  }, []);
  const value = useMemo<Directory>(() => ({
    teams,
    reloadTeams,
    remember,
    teamName: (id) => (id !== null && teams.status === 'ready' ? teams.teams.find((team) => team.id === id)?.name ?? null : null),
    matchById: (id) => (id === null ? null : matches.get(id) ?? null),
  }), [teams, reloadTeams, remember, matches]);
  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

export function useDirectory(): Directory {
  const value = useContext(DirectoryContext);
  if (value === null) throw new Error('DirectoryProvider missing');
  return value;
}

// ---------------------------------------------------------------- pickers

interface PickerProps {
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly disabled?: boolean | undefined;
}

function TeamSelect({ value, onChange, disabled, label }: Readonly<PickerProps & { label: string }>) {
  const { teams, reloadTeams } = useDirectory();
  const [filter, setFilter] = useState('');
  if (teams.status === 'error') {
    return (
      <div className="ui-stack">
        <Alert tone="danger">{`Không tải được danh sách đội. ${teams.message}`}</Alert>
        <div><Button variant="secondary" onClick={reloadTeams}>Thử lại tải danh sách đội</Button></div>
      </div>
    );
  }
  const all = teams.status === 'ready' ? teams.teams : [];
  const needle = filter.trim().toLowerCase();
  const visible = all.filter((team) => team.id === value || needle === '' || team.name.toLowerCase().includes(needle));
  return (
    <div className="ops-picker">
      <Field label="Lọc đội theo tên" help={teams.status === 'loading' ? 'Đang tải danh sách đội…' : `${all.length} đội`}>
        <Input value={filter} disabled={disabled} onChange={(event) => setFilter(event.target.value)} />
      </Field>
      <Field label={label}>
        <Select value={all.some((team) => team.id === value) ? value : ''} disabled={disabled || teams.status !== 'ready'} onChange={(event) => onChange(event.target.value)}>
          <option value="">— Chọn đội —</option>
          {visible.map((team) => <option key={team.id} value={team.id}>{team.name} ({shortId(team.id)})</option>)}
        </Select>
      </Field>
    </div>
  );
}

interface MatchSelectProps extends PickerProps {
  /** Only these match statuses are offered (the list endpoint also returns others). */
  readonly statuses: readonly string[];
  readonly label: string;
}

function MatchSelect({ value, onChange, disabled, statuses, label }: Readonly<MatchSelectProps>) {
  const { teams, remember } = useDirectory();
  const [teamId, setTeamId] = useState('');
  const [stage, setStage] = useState('');
  const [stages, setStages] = useState<readonly string[]>([]);
  const [rows, setRows] = useState<readonly MatchOption[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const append = useRef(false);

  useEffect(() => {
    let live = true;
    setState('loading');
    listMatches({ stage, teamId, page }).then(
      (result) => {
        if (!live) return;
        remember(result.items);
        setRows((current) => (append.current ? [...current, ...result.items] : result.items));
        setTotalPages(result.pagination.totalPages);
        setStages((current) => [...new Set([...current, ...result.items.map((item) => item.stage)])].sort());
        setState('ready');
      },
      (cause: unknown) => { if (live) { setMessage(operationsErrorMessage(cause)); setState('error'); } },
    );
    return () => { live = false; };
  }, [stage, teamId, page, attempt, remember]);

  function refilter(next: { stage?: string; teamId?: string }) {
    append.current = false;
    setPage(1);
    if (next.stage !== undefined) setStage(next.stage);
    if (next.teamId !== undefined) setTeamId(next.teamId);
  }

  const offered = rows.filter((row) => statuses.includes(row.status));
  return (
    <div className="ops-picker">
      <div className="ops-form-grid">
        <Field label="Lọc trận theo đội">
          <Select value={teamId} disabled={disabled} onChange={(event) => refilter({ teamId: event.target.value })}>
            <option value="">Tất cả đội</option>
            {teams.status === 'ready' && teams.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </Select>
        </Field>
        <Field label="Lọc trận theo giai đoạn">
          <Select value={stage} disabled={disabled} onChange={(event) => refilter({ stage: event.target.value })}>
            <option value="">Tất cả giai đoạn</option>
            {stages.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </Field>
      </div>
      {state === 'error' && (
        <div className="ui-stack">
          <Alert tone="danger">{`Không tải được danh sách trận. ${message}`}</Alert>
          <div><Button variant="secondary" onClick={() => { append.current = false; setAttempt((n) => n + 1); }}>Thử lại tải danh sách trận</Button></div>
        </div>
      )}
      <Field label={label} help={state === 'loading' ? 'Đang tải danh sách trận…' : `${offered.length} trận phù hợp (${statuses.join(' / ')})`}>
        <Select value={offered.some((row) => row.matchId === value) ? value : ''} disabled={disabled || state === 'loading'} onChange={(event) => onChange(event.target.value)}>
          <option value="">— Chọn trận —</option>
          {offered.map((row) => <option key={row.matchId} value={row.matchId}>{matchLabel(row)} ({shortId(row.matchId)})</option>)}
        </Select>
      </Field>
      {page < totalPages && state === 'ready' && (
        <div><Button variant="ghost" disabled={disabled} onClick={() => { append.current = true; setPage(page + 1); }}>Tải thêm trận</Button></div>
      )}
    </div>
  );
}

function ManualId({ value, onChange, disabled, label, open, note }: Readonly<PickerProps & { label: string; open: boolean; note?: string | undefined }>) {
  const invalid = value.trim() !== '' && !isUuid(value);
  return (
    <details className="ops-manual" open={open}>
      <summary>Nhập mã thủ công</summary>
      <div className="ui-stack">
        {note !== undefined && <p className="ops-muted">{note}</p>}
        <Field label={label} help="Dán mã UUID khi mục cần chọn không có trong danh sách." {...(invalid ? { error: 'Mã không đúng định dạng UUID.' } : {})}>
          <Input value={value} disabled={disabled} autoComplete="off" spellCheck={false} onChange={(event) => onChange(event.target.value)} />
        </Field>
      </div>
    </details>
  );
}

export type TargetMode = 'team' | 'match-failed' | 'match-any' | 'submission';

const GAP_NOTES: Record<TargetMode, string | undefined> = {
  team: undefined,
  'match-failed': 'Danh sách chỉ có trận FAILED; trận SCHEDULED chưa có trong API danh sách nên cần nhập mã thủ công.',
  'match-any': undefined,
  submission: 'API hiện chỉ cho tài khoản đội xem danh sách submission; BTC cần nhập mã submission thủ công.',
};

/** Entity picker for one target, with a labelled manual-UUID fallback. `value` is always the selected id. */
export function TargetPicker({ mode, value, onChange, disabled, manualLabel, pickerLabel }: Readonly<PickerProps & { mode: TargetMode; manualLabel: string; pickerLabel: string }>) {
  const { teams } = useDirectory();
  const pickerBroken = mode === 'team' && teams.status === 'error';
  return (
    <div className="ui-stack">
      {mode === 'team' && <TeamSelect value={value} onChange={onChange} disabled={disabled} label={pickerLabel} />}
      {mode === 'match-failed' && <MatchSelect value={value} onChange={onChange} disabled={disabled} label={pickerLabel} statuses={['FAILED']} />}
      {mode === 'match-any' && <MatchSelect value={value} onChange={onChange} disabled={disabled} label={pickerLabel} statuses={['FINALIZED', 'FAILED', 'CANCELLED']} />}
      <ManualId value={value} onChange={onChange} disabled={disabled} label={manualLabel} open={mode === 'submission' || pickerBroken} note={GAP_NOTES[mode]} />
    </div>
  );
}
