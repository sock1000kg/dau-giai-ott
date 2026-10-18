import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  addCaseEvidence,
  CASE_DECISIONS,
  CASE_KINDS,
  changeCaseStatus,
  decideCase,
  getCase,
  listAudit,
  listCases,
  listQueueOverrides,
  newIdempotencyKey,
  openCase,
  operationsErrorMessage,
  runPrivilegedAction,
  type AuditItem,
  type CaseDecision,
  type CaseDetail,
  type CaseKind,
  type CaseSummary,
  type PrivilegedActionKind,
  type QueueOverride,
} from './api.ts';

const ACTION_LABELS: Record<PrivilegedActionKind, string> = {
  suspend: 'Đình chỉ đội',
  unsuspend: 'Gỡ đình chỉ đội',
  revoke: 'Thu hồi submission',
  cancel: 'Hủy trận',
  rerun: 'Chạy lại trận (lỗi hạ tầng)',
};

const TARGET_LABELS: Record<PrivilegedActionKind, string> = {
  suspend: 'Mã đội (UUID)',
  unsuspend: 'Mã đội (UUID)',
  revoke: 'Mã submission (UUID)',
  cancel: 'Mã trận (UUID)',
  rerun: 'Mã trận (UUID)',
};

const SUBJECT_LABELS: Record<CaseKind, string> = {
  ANOMALY: 'Mã trận (UUID)',
  DUPLICATE: 'Mã submission (UUID)',
  APPEAL: 'Mã đội (UUID)',
};

function PrivilegedActions({ onDone }: Readonly<{ onDone: () => void }>) {
  const [kind, setKind] = useState<PrivilegedActionKind>('suspend');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [publicReason, setPublicReason] = useState('');
  const [verified, setVerified] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);

  const needsPublicReason = kind === 'cancel' || kind === 'rerun';
  const ready = targetId.trim() !== '' && reason.trim() !== ''
    && (!needsPublicReason || publicReason.trim() !== '') && (kind !== 'rerun' || verified);

  function review(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!ready) {
      setError('Cần nhập đủ đối tượng và lý do trước khi tiếp tục.');
      return;
    }
    setIdempotencyKey(newIdempotencyKey());
    setConfirming(true);
  }

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await runPrivilegedAction({
        kind, targetId: targetId.trim(), reason: reason.trim(),
        ...(needsPublicReason ? { publicReason: publicReason.trim() } : {}),
        ...(kind === 'rerun' ? { verifiedInfraFailure: verified } : {}),
      }, idempotencyKey);
      setMessage(`Đã thực hiện: ${ACTION_LABELS[kind]}.`);
      setConfirming(false);
      setTargetId('');
      setReason('');
      setPublicReason('');
      setVerified(false);
      onDone();
    } catch (cause) {
      setError(operationsErrorMessage(cause));
      setConfirming(false);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="Thao tác đặc quyền">
      <h2>Thao tác đặc quyền</h2>
      <form onSubmit={review}>
        <label htmlFor="ops-action">Thao tác</label>
        <select id="ops-action" value={kind} disabled={confirming} onChange={(event) => setKind(event.target.value as PrivilegedActionKind)}>
          {(Object.keys(ACTION_LABELS) as PrivilegedActionKind[]).map((value) => <option key={value} value={value}>{ACTION_LABELS[value]}</option>)}
        </select>
        <label htmlFor="ops-target">{TARGET_LABELS[kind]}</label>
        <input id="ops-target" value={targetId} disabled={confirming} onChange={(event) => setTargetId(event.target.value)} />
        <label htmlFor="ops-reason">Lý do (bắt buộc, tối đa 500 ký tự)</label>
        <textarea id="ops-reason" value={reason} maxLength={500} disabled={confirming} onChange={(event) => setReason(event.target.value)} />
        {needsPublicReason && (
          <>
            <label htmlFor="ops-public-reason">Lý do công khai (tối đa 200 ký tự, không nêu tên đội)</label>
            <input id="ops-public-reason" value={publicReason} maxLength={200} disabled={confirming} onChange={(event) => setPublicReason(event.target.value)} />
          </>
        )}
        {kind === 'rerun' && (
          <label htmlFor="ops-verified">
            <input id="ops-verified" type="checkbox" checked={verified} disabled={confirming} onChange={(event) => setVerified(event.target.checked)} />
            {' '}Tôi xác nhận đây là lỗi hạ tầng, không phải lỗi bot
          </label>
        )}
        {!confirming && <button type="submit">Xem lại thao tác</button>}
      </form>
      {confirming && (
        <div role="group" aria-label="Xác nhận thao tác">
          <p>Xác nhận <strong>{ACTION_LABELS[kind]}</strong> cho <code>{targetId.trim()}</code>. Thao tác được ghi audit và không thể hoàn tác.</p>
          <button type="button" disabled={submitting} onClick={() => void confirm()}>{submitting ? 'Đang thực hiện…' : 'Xác nhận thực hiện'}</button>
          <button type="button" disabled={submitting} onClick={() => setConfirming(false)}>Hủy</button>
        </div>
      )}
      {error !== null && <p role="alert">{error}</p>}
      {message !== null && <p role="status">{message}</p>}
    </section>
  );
}

function CaseForms({ detail, onDone }: Readonly<{ detail: CaseDetail; onDone: () => void }>) {
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<'UNDER_REVIEW' | 'CLOSED'>('UNDER_REVIEW');
  const [decision, setDecision] = useState<CaseDecision>('NO_ACTION');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    setError(null);
    if (reason.trim() === '') {
      setError('Cần nhập lý do.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
      setReason('');
      setSummary('');
      onDone();
    } catch (cause) {
      setError(operationsErrorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div>
      <label htmlFor="case-reason">Lý do (bắt buộc)</label>
      <textarea id="case-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      <label htmlFor="case-summary">Bằng chứng (tóm tắt)</label>
      <input id="case-summary" value={summary} maxLength={1000} onChange={(event) => setSummary(event.target.value)} />
      <button type="button" disabled={busy || summary.trim() === ''} onClick={() => void run(() => addCaseEvidence(detail.id, reason.trim(), summary.trim()))}>Thêm bằng chứng</button>
      <label htmlFor="case-status">Trạng thái mới</label>
      <select id="case-status" value={status} onChange={(event) => setStatus(event.target.value as 'UNDER_REVIEW' | 'CLOSED')}>
        <option value="UNDER_REVIEW">UNDER_REVIEW</option>
        <option value="CLOSED">CLOSED</option>
      </select>
      <button type="button" disabled={busy} onClick={() => void run(() => changeCaseStatus(detail.id, reason.trim(), status))}>Đổi trạng thái</button>
      <label htmlFor="case-decision">Quyết định</label>
      <select id="case-decision" value={decision} onChange={(event) => setDecision(event.target.value as CaseDecision)}>
        {CASE_DECISIONS.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <button type="button" disabled={busy} onClick={() => void run(() => decideCase(detail.id, reason.trim(), decision))}>Ghi quyết định</button>
      <p>Quyết định không tự sửa kết quả hay Elo; hãy thực hiện thao tác đặc quyền riêng.</p>
      {error !== null && <p role="alert">{error}</p>}
    </div>
  );
}

function Cases() {
  const [cases, setCases] = useState<readonly CaseSummary[]>([]);
  const [selected, setSelected] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<CaseKind>('ANOMALY');
  const [subjectId, setSubjectId] = useState('');
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    try {
      setCases(await listCases());
      setError(null);
    } catch (cause) {
      setError(operationsErrorMessage(cause));
    }
  }, []);
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
    if (reason.trim() === '' || subjectId.trim() === '' || summary.trim() === '') {
      setError('Cần nhập đối tượng, bằng chứng và lý do.');
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
      setError(operationsErrorMessage(cause));
    } finally {
      setOpening(false);
    }
  }

  return (
    <section aria-label="Hồ sơ vụ việc">
      <h2>Hồ sơ vụ việc</h2>
      {error !== null && <p role="alert">{error}</p>}
      <form onSubmit={(event) => void open(event)}>
        <label htmlFor="open-kind">Loại hồ sơ</label>
        <select id="open-kind" value={kind} onChange={(event) => setKind(event.target.value as CaseKind)}>
          {CASE_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <label htmlFor="open-subject">{SUBJECT_LABELS[kind]}</label>
        <input id="open-subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} />
        <label htmlFor="open-summary">Bằng chứng ban đầu</label>
        <input id="open-summary" value={summary} maxLength={1000} onChange={(event) => setSummary(event.target.value)} />
        <label htmlFor="open-reason">Lý do mở hồ sơ</label>
        <textarea id="open-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
        <button type="submit" disabled={opening}>Mở hồ sơ</button>
      </form>
      <table>
        <caption>Danh sách hồ sơ</caption>
        <thead><tr><th scope="col">Loại</th><th scope="col">Trạng thái</th><th scope="col">Mở lúc</th><th scope="col">Chi tiết</th></tr></thead>
        <tbody>
          {cases.map((item) => (
            <tr key={item.id}>
              <td>{item.kind}</td><td>{item.status}</td><td>{item.openedAt}</td>
              <td><button type="button" onClick={() => void select(item.id)}>Xem {item.id.slice(0, 8)}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {cases.length === 0 && error === null && <p>Chưa có hồ sơ.</p>}
      {selected !== null && (
        <article aria-label="Chi tiết hồ sơ">
          <h3>Hồ sơ {selected.kind} · {selected.status}</h3>
          <ol>
            {selected.events.map((event) => (
              <li key={event.seq}>{event.seq}. {event.eventType}{event.decision !== null ? ` (${event.decision})` : ''} — {event.reason}</li>
            ))}
          </ol>
          <CaseForms detail={selected} onDone={() => { void load(); void select(selected.id); }} />
        </article>
      )}
    </section>
  );
}

function AuditViewer({ refreshToken }: Readonly<{ refreshToken: number }>) {
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [items, setItems] = useState<readonly AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listAudit({ action: action.trim(), targetType: targetType.trim(), targetId: targetId.trim() }));
      setError(null);
    } catch (cause) {
      setError(operationsErrorMessage(cause));
    }
  }, [action, targetType, targetId]);
  useEffect(() => { void load(); }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section aria-label="Nhật ký audit">
      <h2>Nhật ký audit</h2>
      <form onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <label htmlFor="audit-action">Hành động</label>
        <input id="audit-action" value={action} onChange={(event) => setAction(event.target.value)} />
        <label htmlFor="audit-target-type">Loại đối tượng</label>
        <input id="audit-target-type" value={targetType} onChange={(event) => setTargetType(event.target.value)} />
        <label htmlFor="audit-target-id">Mã đối tượng</label>
        <input id="audit-target-id" value={targetId} onChange={(event) => setTargetId(event.target.value)} />
        <button type="submit">Lọc</button>
      </form>
      {error !== null && <p role="alert">{error}</p>}
      <table>
        <caption>Sự kiện audit (chỉ ghi thêm)</caption>
        <thead><tr><th scope="col">Thời gian</th><th scope="col">Hành động</th><th scope="col">Đối tượng</th><th scope="col">Lý do</th><th scope="col">Correlation</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.createdAt}</td><td>{item.action}</td><td>{item.targetType} {item.targetId ?? ''}</td><td>{item.reason ?? ''}</td><td>{item.correlationId ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function QueueOverrides({ refreshToken }: Readonly<{ refreshToken: number }>) {
  const [items, setItems] = useState<readonly QueueOverride[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void listQueueOverrides().then((rows) => { setItems(rows); setError(null); }).catch((cause: unknown) => setError(operationsErrorMessage(cause)));
  }, [refreshToken]);
  return (
    <section aria-label="Can thiệp hàng đợi công khai">
      <h2>Can thiệp hàng đợi (công khai)</h2>
      {error !== null && <p role="alert">{error}</p>}
      <ul>
        {items.map((item) => <li key={item.id}>{item.createdAt} · {item.action} · trận {item.matchOpaqueId} — {item.publicReason}</li>)}
      </ul>
      {items.length === 0 && error === null && <p>Chưa có can thiệp nào.</p>}
    </section>
  );
}

export function OperationsConsole() {
  const [refreshToken, setRefreshToken] = useState(0);
  return (
    <main className="admin-page">
      <p className="eyebrow">BTC · VẬN HÀNH ĐẶC QUYỀN</p>
      <h1>Vận hành đặc quyền</h1>
      <p className="welcome-copy">
        Mọi thao tác cần lý do, được xác nhận hai bước và ghi audit chỉ-thêm với correlation ID.
        Lịch sử kết quả và Elo không bao giờ bị sửa.
      </p>
      <PrivilegedActions onDone={() => setRefreshToken((token) => token + 1)} />
      <Cases />
      <AuditViewer refreshToken={refreshToken} />
      <QueueOverrides refreshToken={refreshToken} />
    </main>
  );
}
