import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Button, Field, Input, Select, Textarea } from '../../ui/index.ts';
import { newIdempotencyKey, operationsErrorMessage, runPrivilegedAction, type PrivilegedActionKind } from './api.ts';
import { isUuid, matchLabel, Panel, shortId, TargetPicker, useDirectory, type TargetMode } from './shared.tsx';

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

const PICKER_LABELS: Record<PrivilegedActionKind, string> = {
  suspend: 'Chọn đội',
  unsuspend: 'Chọn đội',
  revoke: 'Chọn submission',
  cancel: 'Chọn trận',
  rerun: 'Chọn trận',
};

const TARGET_MODES: Record<PrivilegedActionKind, TargetMode> = {
  suspend: 'team',
  unsuspend: 'team',
  revoke: 'submission',
  cancel: 'match-failed',
  rerun: 'match-failed',
};

const DESTRUCTIVE: readonly PrivilegedActionKind[] = ['suspend', 'revoke', 'cancel'];

export function PrivilegedActions({ onDone }: Readonly<{ onDone: () => void }>) {
  const directory = useDirectory();
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
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const reviewWrap = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);

  const needsPublicReason = kind === 'cancel' || kind === 'rerun';
  const target = targetId.trim();
  const ready = isUuid(target) && reason.trim() !== ''
    && (!needsPublicReason || publicReason.trim() !== '') && (kind !== 'rerun' || verified);

  useEffect(() => {
    if (confirming) confirmHeading.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      reviewWrap.current?.querySelector('button')?.focus();
    }
  }, [confirming]);

  function changeKind(next: PrivilegedActionKind) {
    setKind(next);
    setTargetId('');
  }

  function targetName(): string {
    const mode = TARGET_MODES[kind];
    if (mode === 'team') return directory.teamName(target) ?? 'Đội chưa có trong danh sách';
    if (mode === 'match-failed') {
      const match = directory.matchById(target);
      return match === null ? 'Trận chưa có trong danh sách' : matchLabel(match);
    }
    return 'Submission';
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!ready) {
      setError(isUuid(target) || target === '' ? 'Cần nhập đủ đối tượng và lý do trước khi tiếp tục.' : 'Mã đối tượng không đúng định dạng UUID; cần chọn từ danh sách hoặc nhập đủ đối tượng và lý do.');
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
        kind, targetId: target, reason: reason.trim(),
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

  function cancelConfirm() {
    restoreFocus.current = true;
    setConfirming(false);
  }

  return (
    <Panel id="ops-privileged" title="Thao tác đặc quyền" description="Đình chỉ đội, thu hồi submission, hủy hoặc chạy lại trận. Mỗi thao tác cần lý do và được xác nhận hai bước.">
      <form className="ui-stack" onSubmit={review}>
        <Field label="Thao tác">
          <Select value={kind} disabled={confirming} onChange={(event) => changeKind(event.target.value as PrivilegedActionKind)}>
            {(Object.keys(ACTION_LABELS) as PrivilegedActionKind[]).map((value) => <option key={value} value={value}>{ACTION_LABELS[value]}</option>)}
          </Select>
        </Field>
        <TargetPicker key={kind} mode={TARGET_MODES[kind]} value={targetId} onChange={setTargetId} disabled={confirming} manualLabel={TARGET_LABELS[kind]} pickerLabel={PICKER_LABELS[kind]} />
        <Field label="Lý do (bắt buộc, tối đa 500 ký tự)" help={`Ghi vào audit chỉ-thêm. ${reason.length}/500`}>
          <Textarea value={reason} maxLength={500} disabled={confirming} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {needsPublicReason && (
          <Field label="Lý do công khai (tối đa 200 ký tự, không nêu tên đội)" help={`Hiển thị trong mục can thiệp hàng đợi. ${publicReason.length}/200`}>
            <Input value={publicReason} maxLength={200} disabled={confirming} onChange={(event) => setPublicReason(event.target.value)} />
          </Field>
        )}
        {kind === 'rerun' && (
          <label htmlFor="ops-verified" className="ops-checkbox">
            <input id="ops-verified" type="checkbox" checked={verified} disabled={confirming} onChange={(event) => setVerified(event.target.checked)} />
            <span>Tôi xác nhận đây là lỗi hạ tầng, không phải lỗi bot</span>
          </label>
        )}
        {!confirming && (
          <div ref={reviewWrap}><Button type="submit">Xem lại thao tác</Button></div>
        )}
      </form>
      {confirming && (
        <div role="group" aria-label="Xác nhận thao tác" className="ops-confirm">
          <h3 ref={confirmHeading} tabIndex={-1}>Xác nhận {ACTION_LABELS[kind]}</h3>
          <p>Đối tượng: <strong>{targetName()}</strong> <code className="ops-code">({shortId(target)})</code></p>
          <p>Thao tác được ghi audit và không thể hoàn tác.</p>
          <div className="ui-row">
            <Button variant={DESTRUCTIVE.includes(kind) ? 'danger' : 'primary'} loading={submitting} onClick={() => void confirm()}>{submitting ? 'Đang thực hiện…' : 'Xác nhận thực hiện'}</Button>
            <Button variant="secondary" disabled={submitting} onClick={cancelConfirm}>Hủy</Button>
          </div>
        </div>
      )}
      {error !== null && <Alert tone="danger">{error}</Alert>}
      {message !== null && <Alert tone="success">{message}</Alert>}
    </Panel>
  );
}
