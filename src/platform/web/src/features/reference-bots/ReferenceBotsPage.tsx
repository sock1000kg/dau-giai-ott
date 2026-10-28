import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Input, Page, Textarea } from '../../ui/index.ts';
import {
  listReferenceBots,
  ReferenceBotApiError,
  setReferenceBotEnabled,
  uploadReferenceBot,
  type ReferenceBot,
} from './api.ts';

import './reference-bots.css';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

function failureMessage(error: unknown): string {
  if (error instanceof ReferenceBotApiError) {
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error.status === 403) return 'Tài khoản không có quyền quản lý bot tham chiếu.';
    if (error.code === 'REFERENCE_BOT_ARCHIVE_EXISTS') return 'Archive này đã có trong danh sách bot BTC.';
    if (error.code === 'IDEMPOTENCY_KEY_REUSED') return 'Yêu cầu bị xung đột. Tải lại danh sách rồi thử lại.';
    if (error.status === 413) return 'OCI archive vượt quá giới hạn 256 MiB.';
    if (error.status === 409) return 'Trạng thái bot đã thay đổi. Tải lại danh sách để kiểm tra.';
  }
  return 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}

function statusLabel(bot: ReferenceBot): string {
  if (bot.enabled) return 'Đang hoạt động';
  if (bot.disabledAt !== null) return 'Đã tắt';
  return 'Chưa kích hoạt';
}

interface PendingAction {
  readonly bot: ReferenceBot;
  readonly enabled: boolean;
}

export function ReferenceBotsPage() {
  const [bots, setBots] = useState<readonly ReferenceBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [uploadReason, setUploadReason] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const uploadKey = useRef<string | null>(null);
  const actionKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      setBots(await listReferenceBots());
    } catch (cause) {
      setError(failureMessage(cause));
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file === null || busy || loadFailed) return;
    if (file.size === 0 || file.size > MAX_ARCHIVE_BYTES) {
      setError(file.size === 0 ? 'Chọn OCI archive không rỗng.' : 'OCI archive vượt quá giới hạn 256 MiB.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    uploadKey.current ??= crypto.randomUUID();
    try {
      const result = await uploadReferenceBot({
        file,
        displayName: displayName.trim(),
        reason: uploadReason.trim(),
        idempotencyKey: uploadKey.current,
      });
      uploadKey.current = null;
      setNotice(result.replayed ? 'Yêu cầu tải lên đã được xác nhận trước đó.' : 'Đã tải bot lên. Bot đang ở trạng thái chưa kích hoạt.');
      setFile(null);
      setDisplayName('');
      setUploadReason('');
      await load();
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function beginAction(bot: ReferenceBot, enabled: boolean) {
    setPendingAction({ bot, enabled });
    setActionReason('');
    actionKey.current = null;
    setError(null);
    setNotice(null);
  }

  async function confirmAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingAction === null || busy || loadFailed) return;
    setBusy(true);
    setError(null);
    actionKey.current ??= crypto.randomUUID();
    try {
      const result = await setReferenceBotEnabled(
        pendingAction.bot.id,
        pendingAction.enabled,
        actionReason.trim(),
        actionKey.current,
      );
      actionKey.current = null;
      setPendingAction(null);
      setNotice(result.replayed ? 'Yêu cầu đã được xác nhận trước đó.' : pendingAction.enabled ? 'Đã kích hoạt bot.' : 'Đã tắt bot.');
      await load();
    } catch (cause) {
      setError(failureMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Bot chạy thử"
      description="BTC tải OCI archive lên, kiểm tra checksum rồi kích hoạt bot để các đội chọn trong mục Chạy thử bot. Mỗi archive được lưu thành một phiên bản riêng."
    >
      <p className="reference-bots-eyebrow">BTC · CATALOG BOT THAM CHIẾU</p>

      {error !== null && (
        <Alert tone="danger">
          <div className="reference-bots-alert"><p>{error}</p><Button variant="secondary" onClick={() => void load()} disabled={busy}>Tải lại</Button></div>
        </Alert>
      )}
      {notice !== null && <Alert tone="success">{notice}</Alert>}

      <div className="reference-bots-layout">
        <Card title="Tải OCI archive" className="reference-bots-upload">
          <p>Chấp nhận một file .tar, tối đa 256 MiB. Archive được kiểm tra theo OCI và tạo ở trạng thái chưa kích hoạt.</p>
          <form className="reference-bots-form" onSubmit={(event) => void submitUpload(event)}>
            <label htmlFor="reference-bot-name">Tên bot</label>
            <Input id="reference-bot-name" value={displayName} maxLength={80} onChange={(event) => { uploadKey.current = null; setDisplayName(event.target.value); }} required />
            <label htmlFor="reference-bot-reason">Lý do tải lên</label>
            <Textarea id="reference-bot-reason" value={uploadReason} maxLength={500} onChange={(event) => { uploadKey.current = null; setUploadReason(event.target.value); }} required rows={3} />
            <label htmlFor="reference-bot-file">OCI image archive (.tar)</label>
            <Input
              id="reference-bot-file"
              type="file"
              accept=".tar,application/x-tar"
              onChange={(event) => {
                uploadKey.current = null;
                const selected = event.target.files?.[0] ?? null;
                setFile(selected);
                if (selected !== null && selected.size > MAX_ARCHIVE_BYTES) setError('OCI archive vượt quá giới hạn 256 MiB.');
                else setError(null);
              }}
              required
            />
            {file !== null && <p className="reference-bots-file-meta">{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MiB</p>}
            <Button type="submit" loading={busy} disabled={loading || loadFailed || file === null || displayName.trim().length === 0 || uploadReason.trim().length === 0}>
              {busy ? 'Đang tải lên…' : 'Tải lên OCI'}
            </Button>
          </form>
        </Card>

        <Card title="Các phiên bản bot" className="reference-bots-catalog">
          {loading && <p role="status" aria-busy="true">Đang tải danh sách bot…</p>}
          {!loading && !loadFailed && bots.length === 0 && <p className="reference-bots-empty">Chưa có bot tham chiếu nào.</p>}
          {!loading && bots.length > 0 && (
            <ul className="reference-bots-list">
              {bots.map((bot) => (
                <li key={bot.id} className="reference-bots-item">
                  <div className="reference-bots-item-heading">
                    <div><h3>{bot.displayName}</h3><Badge accent={bot.enabled}>{statusLabel(bot)}</Badge></div>
                    <time dateTime={bot.createdAt}>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(bot.createdAt))}</time>
                  </div>
                  <dl className="reference-bots-digests">
                    <div><dt>Archive SHA-256</dt><dd><code>{bot.archiveSha256}</code></dd></div>
                    <div><dt>Manifest</dt><dd><code>{bot.manifestDigest}</code></dd></div>
                    <div><dt>Config</dt><dd><code>{bot.configDigest}</code></dd></div>
                    <div><dt>Sandbox policy</dt><dd><code>{bot.policyVersion}</code></dd></div>
                  </dl>
                  <div className="reference-bots-actions">
                    {bot.enabled
                      ? <Button variant="danger" disabled={busy || loadFailed} onClick={() => beginAction(bot, false)}>Tắt bot</Button>
                      : <Button variant="secondary" disabled={busy || loadFailed} onClick={() => beginAction(bot, true)}>Kích hoạt</Button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {pendingAction !== null && (
        <Card title={pendingAction.enabled ? `Kích hoạt ${pendingAction.bot.displayName}` : `Tắt ${pendingAction.bot.displayName}`} className="reference-bots-confirm">
          <p>{pendingAction.enabled ? 'Bot sẽ xuất hiện trong danh sách đối thủ của các đội.' : 'Các đội sẽ không thể chọn bot này cho lượt chạy mới.'}</p>
          <form className="reference-bots-form" onSubmit={(event) => void confirmAction(event)}>
            <label htmlFor="reference-bot-action-reason">Lý do thay đổi</label>
            <Textarea id="reference-bot-action-reason" value={actionReason} maxLength={500} onChange={(event) => setActionReason(event.target.value)} required rows={3} />
            <div className="reference-bots-actions">
              <Button type="submit" loading={busy} disabled={actionReason.trim().length === 0 || loadFailed}>
                {busy ? 'Đang xử lý…' : pendingAction.enabled ? 'Xác nhận kích hoạt' : 'Xác nhận tắt bot'}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setPendingAction(null)}>Hủy</Button>
            </div>
          </form>
        </Card>
      )}
    </Page>
  );
}
