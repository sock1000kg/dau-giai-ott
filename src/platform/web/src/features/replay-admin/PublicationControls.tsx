import { useEffect, useRef, useState } from 'react';
import type { ReplayPublicationState } from './api.ts';

export type ReplayAction = 'stage' | 'publish';

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

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [action]);

  function open(next: ReplayAction) {
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
      <div className="replay-publication-controls">
        <span className="qualification-private-note">Vòng loại: replay riêng tư — không công khai</span>
      </div>
    );
  }

  return (
    <div className="replay-publication-controls">
      {state === 'PRIVATE' && <button className="secondary-button" type="button" disabled={busy} onClick={() => open('stage')}>Đưa vào duyệt</button>}
      {state === 'STAGED' && <button className="publish-button" type="button" disabled={busy} onClick={() => open('publish')}>Công bố replay</button>}
      {state === 'PUBLISHED' && <span className="published-note">Replay đã công khai</span>}
      {action !== null && (
        <dialog ref={dialogRef} className="replay-confirm" aria-labelledby="replay-confirm-title" onCancel={(event) => { event.preventDefault(); setAction(null); }}>
          <form aria-label="Xác nhận phát hành replay" onSubmit={(event) => void submit(event)}>
            <p className="eyebrow">XÁC NHẬN THAO TÁC BTC</p>
            <h2 id="replay-confirm-title">{action === 'stage' ? 'Đưa replay vào duyệt?' : 'Công bố replay?'}</h2>
            <p>Thao tác chỉ áp dụng cho trận đã kết thúc. Không có điều khiển trận trực tiếp.</p>
            <label htmlFor="replay-reason">Lý do</label>
            <textarea id="replay-reason" required minLength={1} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
            <div className="replay-confirm-actions">
              <button className="secondary-button" type="button" disabled={submitting} onClick={() => setAction(null)}>Hủy</button>
              <button className="publish-button" type="submit" disabled={busy || submitting || reason.trim().length === 0}>
                {submitting ? 'Đang lưu…' : action === 'stage' ? 'Xác nhận đưa vào duyệt' : 'Xác nhận công bố'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
