import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Field, Input, Select } from '../../ui/index.ts';
import { listAudit, listQueueOverrides, operationsErrorMessage, type AuditItem, type Pagination, type QueueOverride } from './api.ts';
import { DataTable, formatTime, isUuid, PageControls, Panel, shortId, useDirectory } from './shared.tsx';

export const AUDIT_ACTIONS: readonly string[] = [
  'TEAM_SUSPENDED', 'TEAM_UNSUSPENDED', 'SUBMISSION_REVOKED', 'MATCH_CANCELLED', 'MATCH_RERUN',
  'CASE_OPENED', 'CASE_EVIDENCE_ADDED', 'CASE_STATUS_CHANGED', 'CASE_DECIDED',
  'TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_CREDENTIAL_RESET', 'ROUND_CREATED',
];
export const AUDIT_TARGET_TYPES: readonly string[] = ['TEAM', 'SUBMISSION', 'MATCH', 'CASE', 'ROUND', 'ACCOUNT'];

const CUSTOM = '__custom';
const WORD = /^[A-Z][A-Z0-9_]{0,63}$/;

/** A Select of known values with a free-text fallback ("Khác…") for values not in the list. */
function SelectOrCustom({ label, customLabel, known, value, onChange }: Readonly<{ label: string; customLabel: string; known: readonly string[]; value: string; onChange: (value: string) => void }>) {
  const [custom, setCustom] = useState(false);
  const selectValue = custom ? CUSTOM : value;
  const invalid = custom && value.trim() !== '' && !WORD.test(value.trim());
  return (
    <div className="ui-stack">
      <Field label={label}>
        <Select value={selectValue} onChange={(event) => {
          if (event.target.value === CUSTOM) { setCustom(true); onChange(''); } else { setCustom(false); onChange(event.target.value); }
        }}>
          <option value="">Tất cả</option>
          {known.map((item) => <option key={item} value={item}>{item}</option>)}
          <option value={CUSTOM}>Khác (nhập tay)…</option>
        </Select>
      </Field>
      {custom && (
        <Field label={customLabel} help="Chữ HOA, số và dấu gạch dưới, ví dụ TEAM_SUSPENDED." {...(invalid ? { error: 'Giá trị không đúng định dạng.' } : {})}>
          <Input value={value} autoComplete="off" onChange={(event) => onChange(event.target.value.toUpperCase())} />
        </Field>
      )}
    </div>
  );
}

interface Applied { readonly action: string; readonly targetType: string; readonly targetId: string; readonly page: number }

export function AuditViewer({ refreshToken }: Readonly<{ refreshToken: number }>) {
  const directory = useDirectory();
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [applied, setApplied] = useState<Applied>({ action: '', targetType: '', targetId: '', page: 1 });
  const [items, setItems] = useState<readonly AuditItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, totalItems: 0 });
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listAudit(applied).then(
      (result) => { if (live) { setItems(result.items); setPagination(result.pagination); setError(null); } },
      (cause: unknown) => { if (live) setError(operationsErrorMessage(cause)); },
    );
    return () => { live = false; };
  }, [applied, refreshToken]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = { action: action.trim(), targetType: targetType.trim(), targetId: targetId.trim() };
    if ((next.action !== '' && !WORD.test(next.action)) || (next.targetType !== '' && !WORD.test(next.targetType))) {
      setFilterError('Hành động và loại đối tượng chỉ gồm chữ HOA, số và dấu gạch dưới.');
      return;
    }
    if (next.targetId !== '' && !isUuid(next.targetId)) {
      setFilterError('Mã đối tượng phải là UUID.');
      return;
    }
    setFilterError(null);
    setApplied({ ...next, page: 1 });
  }

  return (
    <Panel id="ops-audit" title="Nhật ký audit" description="Mọi thao tác đặc quyền được ghi lại chỉ-thêm, kèm correlation ID. Lọc theo hành động, loại hoặc mã đối tượng.">
      <form className="ui-stack" onSubmit={submit}>
        <div className="ops-form-grid">
          <SelectOrCustom label="Hành động" customLabel="Hành động (nhập tay)" known={AUDIT_ACTIONS} value={action} onChange={setAction} />
          <SelectOrCustom label="Loại đối tượng" customLabel="Loại đối tượng (nhập tay)" known={AUDIT_TARGET_TYPES} value={targetType} onChange={setTargetType} />
          <Field label="Mã đối tượng" help="UUID của đội, trận, hoặc submission.">
            <Input value={targetId} autoComplete="off" spellCheck={false} onChange={(event) => setTargetId(event.target.value)} />
          </Field>
        </div>
        {filterError !== null && <Alert tone="danger">{filterError}</Alert>}
        <div><Button type="submit" variant="secondary">Lọc</Button></div>
      </form>
      {error !== null && <Alert tone="danger">{error}</Alert>}
      <DataTable
        caption="Sự kiện audit (chỉ ghi thêm)"
        rows={items}
        rowKey={(item) => item.id}
        emptyMessage="Chưa có sự kiện audit nào"
        columns={[
          { key: 'time', header: 'Thời gian', render: (item) => formatTime(item.createdAt) },
          { key: 'action', header: 'Hành động', render: (item) => <Badge accent>{item.action}</Badge> },
          { key: 'target', header: 'Đối tượng', render: (item) => (
            <>{item.targetType} {item.targetId !== null && <code className="ops-code" title={item.targetId}>{item.targetType === 'TEAM' ? directory.teamName(item.targetId) ?? shortId(item.targetId) : shortId(item.targetId)}</code>}</>
          ) },
          { key: 'reason', header: 'Lý do', render: (item) => item.reason ?? '' },
          { key: 'correlation', header: 'Correlation', render: (item) => <code className="ops-code">{item.correlationId ?? ''}</code> },
        ]}
      />
      <PageControls page={pagination.page} totalPages={pagination.totalPages} onPage={(page) => setApplied({ ...applied, page })} />
    </Panel>
  );
}

export function QueueOverrides({ refreshToken }: Readonly<{ refreshToken: number }>) {
  const [items, setItems] = useState<readonly QueueOverride[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void listQueueOverrides().then((rows) => { setItems(rows); setError(null); }).catch((cause: unknown) => setError(operationsErrorMessage(cause)));
  }, [refreshToken]);
  return (
    <Panel id="ops-overrides" title="Can thiệp hàng đợi (công khai)" description="Các can thiệp vào hàng đợi trận mà khán giả có thể thấy, kèm lý do công khai.">
      {error !== null && <Alert tone="danger">{error}</Alert>}
      <DataTable
        caption="Can thiệp hàng đợi công khai"
        rows={items}
        rowKey={(item) => item.id}
        emptyMessage="Chưa có can thiệp nào"
        columns={[
          { key: 'time', header: 'Thời gian', render: (item) => formatTime(item.createdAt) },
          { key: 'action', header: 'Hành động', render: (item) => <Badge accent>{item.action}</Badge> },
          { key: 'match', header: 'Trận', render: (item) => <code className="ops-code">{item.matchOpaqueId}</code> },
          { key: 'reason', header: 'Lý do công khai', render: (item) => item.publicReason },
        ]}
      />
    </Panel>
  );
}
