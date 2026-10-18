import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Field, Textarea } from '../../ui/index.ts';
import type { ReplayPublicationState } from './api.ts';
import './replay-admin.css';

export type ReplayAction = 'stage' | 'publish';

const REASON_MAX = 500;

export function PublicationControls({
  state,
  busy,
  stage,
  onBegin,
}: Readonly<{
  state: ReplayPublicationState;
  busy: boolean;
  stage?: string;
  onBegin: (action: ReplayAction, reason: string, idempotencyKey: string) => Promise<void>;
}>) {
  const [action, setAction] = useState<ReplayAction | null>(null);
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector('textarea')?.focus();
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [action]);

  useEffect(() => {
    if (action !== null) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const trigger = triggerRef.current;
    if (trigger !== null && trigger.isConnected) trigger.focus();
  }, [action]);

  function open(next: ReplayAction, trigger: HTMLElement) {
    triggerRef.current = trigger;
    setAction(next);
    setReason('');
    setIdempotencyKey(crypto.randomUUID());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action === null || reason.trim().length === 0 || submitting || idempotencyKey.length === 0) return;
    setSubmitting(true);
    try {
      await onBegin(action, reason.trim(), idempotencyKey);
      setAction(null);
      setReason('');
      setIdempotencyKey('');
    } catch {
      // The page displays a sanitized error and keeps this intent available for idempotent retry.
    } finally {
      setSubmitting(false);
    }
  }

  if (stage !== undefined && stage !== 'FINALS') {
    return (
      <div className="ra-controls">
        <Badge>Vòng loại: replay riêng tư — không công khai</Badge>
      </div>
    );
  }

  return (
    <div className="ra-controls">
      {state === 'PRIVATE' && <Button variant="secondary" disabled={busy} onClick={(event) => open('stage', event.currentTarget)}>Đưa vào duyệt</Button>}
      {state === 'STAGED' && <Button variant="primary" disabled={busy} onClick={(event) => open('publish', event.currentTarget)}>Công bố replay</Button>}
      {state === 'PUBLISHED' && <Badge accent>Replay đã công khai</Badge>}
      {action !== null && (
        <dialog ref={dialogRef} className="ra-dialog" aria-labelledby="replay-confirm-title" onCancel={(event) => { event.preventDefault(); setAction(null); }}>
          <form className="ra-dialog-form" aria-label="Xác nhận phát hành replay" onSubmit={(event) => void submit(event)}>
            <p className="ra-eyebrow">XÁC NHẬN THAO TÁC BTC</p>
            <h2 id="replay-confirm-title">{action === 'stage' ? 'Đưa replay vào duyệt?' : 'Công bố replay?'}</h2>
            <p className="ra-dialog-note">Thao tác chỉ áp dụng cho trận đã kết thúc. Không có điều khiển trận trực tiếp.</p>
            <Field label="Lý do" help="Lý do được lưu cùng lịch sử phát hành replay." required>
              <Textarea id="replay-reason" minLength={1} maxLength={REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <p className="ra-counter" aria-live="polite">{reason.length}/{REASON_MAX}</p>
            <div className="ra-dialog-actions">
              <Button variant="secondary" disabled={submitting} onClick={() => setAction(null)}>Hủy</Button>
              <Button variant="primary" type="submit" disabled={busy || submitting || reason.trim().length === 0}>
                {submitting ? 'Đang lưu…' : action === 'stage' ? 'Xác nhận đưa vào duyệt' : 'Xác nhận công bố'}
              </Button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
