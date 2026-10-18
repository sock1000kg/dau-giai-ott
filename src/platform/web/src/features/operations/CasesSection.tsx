import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Input, Select, Textarea } from '../../ui/index.ts';
import {
  addCaseEvidence,
  CASE_DECISIONS,
  CASE_KINDS,
  changeCaseStatus,
  decideCase,
  getCase,
  listCases,
  openCase,
  operationsErrorMessage,
  type CaseDecision,
  type CaseDetail,
  type CaseKind,
  type CaseStatus,
  type CaseSummary,
  type Pagination,
} from './api.ts';
import { DataTable, formatTime, isUuid, matchLabel, PageControls, Panel, shortId, TargetPicker, useDirectory, type TargetMode } from './shared.tsx';

const SUBJECT_LABELS: Record<CaseKind, string> = {
  ANOMALY: 'Mã trận (UUID)',
  DUPLICATE: 'Mã submission (UUID)',
  APPEAL: 'Mã đội (UUID)',
};

const SUBJECT_PICKER_LABELS: Record<CaseKind, string> = {
  ANOMALY: 'Chọn trận',
  DUPLICATE: 'Chọn submission',
  APPEAL: 'Chọn đội',
};

const SUBJECT_MODES: Record<CaseKind, TargetMode> = { ANOMALY: 'match-any', DUPLICATE: 'submission', APPEAL: 'team' };
const CASE_STATUSES: readonly CaseStatus[] = ['OPEN', 'UNDER_REVIEW', 'DECIDED', 'CLOSED'];

type Action = 'evidence' | 'status' | 'decision';

function CaseForms({ detail, onDone }: Readonly<{ detail: CaseDetail; onDone: () => void }>) {
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<'UNDER_REVIEW' | 'CLOSED'>('UNDER_REVIEW');
  const [decision, setDecision] = useState<CaseDecision>('NO_ACTION');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const inFlight = useRef<Record<Action, boolean>>({ evidence: false, status: false, decision: false });

  async function run(action: Action, work: () => Promise<void>) {
    if (inFlight.current[action]) return;
    setError(null);
    if (reason.trim() === '') {
      setError('Cần nhập lý do.');
      return;
    }
    inFlight.current[action] = true;
    setBusy(action);
    try {
      await work();
      setReason('');
      setSummary('');
      onDone();
    } catch (cause) {
      setError(operationsErrorMessage(cause));
    } finally {
      inFlight.current[action] = false;
      setBusy((current) => (current === action ? null : current));
    }
  }

  return (
    <div className="ui-stack">
      <Field label="Lý do (bắt buộc)" help={`Áp dụng cho thao tác bên dưới và ghi vào audit. ${reason.length}/500`}>
        <Textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <div className="ops-subform">
        <h4>Thêm bằng chứng</h4>
        <Field label="Bằng chứng (tóm tắt)" help={`${summary.length}/1000`}>
          <Input value={summary} maxLength={1000} onChange={(event) => setSummary(event.target.value)} />
        </Field>
        <div><Button loading={busy === 'evidence'} disabled={summary.trim() === ''} onClick={() => void run('evidence', () => addCaseEvidence(detail.id, reason.trim(), summary.trim()))}>Thêm bằng chứng</Button></div>
      </div>
      <div className="ops-subform">
        <h4>Đổi trạng thái</h4>
        <Field label="Trạng thái mới">
          <Select value={status} onChange={(event) => setStatus(event.target.value as 'UNDER_REVIEW' | 'CLOSED')}>
            <option value="UNDER_REVIEW">UNDER_REVIEW</option>
            <option value="CLOSED">CLOSED</option>
          </Select>
        </Field>
        <div><Button variant="secondary" loading={busy === 'status'} onClick={() => void run('status', () => changeCaseStatus(detail.id, reason.trim(), status))}>Đổi trạng thái</Button></div>
      </div>
      <div className="ops-subform">
        <h4>Ghi quyết định</h4>
        <Field label="Quyết định" help="Quyết định không tự sửa kết quả hay Elo; hãy thực hiện thao tác đặc quyền riêng.">
          <Select value={decision} onChange={(event) => setDecision(event.target.value as CaseDecision)}>
            {CASE_DECISIONS.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
        <div><Button loading={busy === 'decision'} onClick={() => void run('decision', () => decideCase(detail.id, reason.trim(), decision))}>Ghi quyết định</Button></div>
      </div>
      {error !== null && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}

function subjectLabel(item: CaseSummary, directory: ReturnType<typeof useDirectory>): string {
  if (item.teamId !== null) return `Đội ${directory.teamName(item.teamId) ?? shortId(item.teamId)}`;
  if (item.matchId !== null) {
    const match = directory.matchById(item.matchId);
    return match === null ? `Trận ${shortId(item.matchId)}` : `Trận ${matchLabel(match)}`;
  }
  if (item.submissionId !== null) return `Submission ${shortId(item.submissionId)}`;
  return '—';
}

export function Cases() {
  const directory = useDirectory();
  const [cases, setCases] = useState<readonly CaseSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, totalItems: 0 });
  const [selected, setSelected] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<CaseKind | ''>('');
  const [statusFilter, setStatusFilter] = useState<CaseStatus | ''>('');
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<CaseKind>('ANOMALY');
  const [subjectId, setSubjectId] = useState('');
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [opening, setOpening] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listCases({ kind: kindFilter, status: statusFilter, page });
      setCases(result.items);
      setPagination(result.pagination);
      setError(null);
    } catch (cause) {
      setError(operationsErrorMessage(cause));
    }
  }, [kindFilter, statusFilter, page]);
  useEffect(() => { void load(); }, [load]);

  async function select(id: string) {
    try {
      setSelected(await getCase(id));
    } catch (cause) {
      setError(operationsErrorMessage(cause));
    }
  }

  async function open(event: FormEvent) {
    event.preventDefault();
    if (opening) return;
    setFormError(null);
    if (reason.trim() === '' || subjectId.trim() === '' || summary.trim() === '') {
      setFormError('Cần nhập đối tượng, bằng chứng và lý do.');
      return;
    }
    if (!isUuid(subjectId)) {
      setFormError('Mã đối tượng không đúng định dạng UUID.');
      return;
    }
    setOpening(true);
    try {
      await openCase({ kind, subjectId: subjectId.trim(), reason: reason.trim(), summary: summary.trim() });
      setSubjectId('');
      setReason('');
      setSummary('');
      await load();
    } catch (cause) {
      setFormError(operationsErrorMessage(cause));
    } finally {
      setOpening(false);
    }
  }

  return (
    <Panel id="ops-cases" title="Hồ sơ vụ việc" description="Mở hồ sơ cho trận bất thường, submission trùng lặp hoặc khiếu nại; theo dõi bằng chứng và quyết định.">
      <form className="ui-stack" onSubmit={(event) => void open(event)}>
        <Field label="Loại hồ sơ">
          <Select value={kind} onChange={(event) => { setKind(event.target.value as CaseKind); setSubjectId(''); }}>
            {CASE_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
        <TargetPicker key={kind} mode={SUBJECT_MODES[kind]} value={subjectId} onChange={setSubjectId} disabled={opening} manualLabel={SUBJECT_LABELS[kind]} pickerLabel={SUBJECT_PICKER_LABELS[kind]} />
        <Field label="Bằng chứng ban đầu" help={`${summary.length}/1000`}>
          <Input value={summary} maxLength={1000} onChange={(event) => setSummary(event.target.value)} />
        </Field>
        <Field label="Lý do mở hồ sơ" help={`${reason.length}/500`}>
          <Textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {formError !== null && <Alert tone="danger">{formError}</Alert>}
        <div><Button type="submit" loading={opening}>Mở hồ sơ</Button></div>
      </form>

      <div className="ops-form-grid">
        <Field label="Lọc theo loại">
          <Select value={kindFilter} onChange={(event) => { setKindFilter(event.target.value as CaseKind | ''); setPage(1); }}>
            <option value="">Tất cả loại</option>
            {CASE_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
        <Field label="Lọc theo trạng thái">
          <Select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as CaseStatus | ''); setPage(1); }}>
            <option value="">Tất cả trạng thái</option>
            {CASE_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </Field>
      </div>
      {error !== null && <Alert tone="danger">{error}</Alert>}
      <DataTable
        caption="Danh sách hồ sơ"
        rows={cases}
        rowKey={(item) => item.id}
        emptyMessage="Chưa có hồ sơ nào"
        columns={[
          { key: 'kind', header: 'Loại', render: (item) => <Badge accent>{item.kind}</Badge> },
          { key: 'status', header: 'Trạng thái', render: (item) => <Badge accent={item.status === 'OPEN' || item.status === 'UNDER_REVIEW'}>{item.status}</Badge> },
          { key: 'subject', header: 'Đối tượng', render: (item) => subjectLabel(item, directory) },
          { key: 'opened', header: 'Mở lúc', render: (item) => formatTime(item.openedAt) },
          { key: 'view', header: 'Xem', render: (item) => <Button variant="secondary" onClick={() => void select(item.id)}>Xem {shortId(item.id)}</Button> },
        ]}
      />
      <PageControls page={pagination.page} totalPages={pagination.totalPages} onPage={setPage} />
      {selected !== null && (
        <article aria-label="Chi tiết hồ sơ" className="ui-stack ops-subform">
          <h3>Hồ sơ {selected.kind} · {selected.status}</h3>
          <ol className="ops-timeline">
            {[...selected.events].sort((a, b) => a.seq - b.seq).map((event) => (
              <li key={event.seq}>
                <span>{event.seq}. {event.eventType}{event.decision !== null ? ` (${event.decision})` : ''} — {event.reason}</span>
                <time dateTime={event.createdAt}>{formatTime(event.createdAt)}</time>
              </li>
            ))}
          </ol>
          <CaseForms detail={selected} onDone={() => { void load(); void select(selected.id); }} />
        </article>
      )}
    </Panel>
  );
}
