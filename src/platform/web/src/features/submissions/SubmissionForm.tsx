import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  listSubmissions,
  reserveSubmission,
  sha256File,
  SubmissionApiError,
  uploadSubmission,
  type SubmissionPage,
  type TeamSubmission,
} from './api.ts';
import { SubmissionStatus } from './SubmissionStatus.tsx';

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

function failureMessage(error: unknown): string {
  if (error instanceof SubmissionApiError) {
    if (error.status === 401) return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
    if (error.status === 403) {
      if (error.code === 'SUBMISSION_DEADLINE_PASSED') return 'Đã quá hạn nộp bot. Không thể giữ chỗ mới.';
      if (error.code === 'RESERVATION_REQUIRED') return 'Đã qua hạn nộp chính thức. Cần có mã giữ chỗ hợp lệ để nộp trong thời gian ân hạn.';
      if (error.code === 'RESERVATION_INVALID') return 'Mã giữ chỗ không hợp lệ hoặc không thuộc về vòng thi hiện tại.';
      if (error.code === 'SUBMISSION_CLOSED') return 'Cổng nộp bot đã đóng hoàn toàn (hết thời gian ân hạn).';
      return 'Tài khoản này không có quyền nộp bot.';
    }
    if (error.status === 409) {
      if (error.code === 'SUBMISSION_NOT_OPEN') return 'Chưa đến thời gian nộp bot của vòng thi.';
      if (error.code === 'RESERVATION_HASH_MISMATCH') return 'File tải lên không khớp với SHA-256 đã giữ chỗ.';
      return `Máy chủ từ chối yêu cầu (${error.code ?? 'CONFLICT'}).`;
    }
    if (error.status === 429) {
      return 'Hệ thống đang bận xử lý lượt tải lên khác. Vui lòng thử lại sau giây lát.';
    }
    if (error.status === 0) return 'Không kết nối được máy chủ. Hãy kiểm tra mạng và thử lại.';
    if (error.code === 'ARCHIVE_TOO_LARGE') return 'Archive rỗng hoặc vượt quá giới hạn 256 MiB.';
    if (error.code !== null && /^[A-Z0-9_]{1,64}$/.test(error.code)) return `Máy chủ từ chối archive (${error.code}).`;
  }
  return 'Không thể hoàn tất yêu cầu lúc này. Hãy thử lại sau.';
}

export function SubmissionForm() {
  const uploadLock = useRef(false);
  const archiveInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [submissions, setSubmissions] = useState<readonly TeamSubmission[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<SubmissionPage['pagination']>({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
  const [preflightQueueLength, setPreflightQueueLength] = useState<number | undefined>(undefined);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [waitingText, setWaitingText] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSubmissions = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const result = await listSubmissions(page, 20);
      setSubmissions(result.items);
      setPagination(result.pagination);
      setPreflightQueueLength(result.preflightQueueLength);
    } catch (error) {
      setListError(failureMessage(error));
    } finally {
      setLoadingList(false);
    }
  }, [page]);

  useEffect(() => { void loadSubmissions(); }, [loadSubmissions]);

  function chooseFile(candidate: File | undefined) {
    setSuccess(null);
    setFormError(null);
    setProgress(null);
    setWaitingText(null);
    if (candidate === undefined) { setFile(null); return; }
    const rejectFile = (message: string) => {
      setFile(null);
      setFormError(message);
      if (archiveInput.current !== null) archiveInput.current.value = '';
    };
    if (candidate.size === 0) { rejectFile('Archive không được để trống.'); return; }
    if (candidate.size > MAX_ARCHIVE_BYTES) { rejectFile('Archive vượt quá giới hạn 256 MiB.'); return; }
    if (!candidate.name.toLowerCase().endsWith('.tar')) { rejectFile('Chọn OCI image archive có đuôi .tar.'); return; }
    setFile(candidate);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadLock.current || file === null) return;
    uploadLock.current = true;
    setUploading(true);
    setProgress(0);
    setWaitingText('Đang tính mã SHA-256…');
    setFormError(null);
    setSuccess(null);
    try {
      const hash = await sha256File(file);
      setWaitingText('Đang giữ chỗ…');
      const reservation = await reserveSubmission(hash);
      setWaitingText(null);

      const uploaded = await uploadSubmission(
        file,
        reservation.id,
        (loaded, total) => {
          setProgress(total > 0 ? Math.min(100, Math.floor((loaded / total) * 100)) : null);
        },
        undefined,
        (_retryAfterSeconds) => {
          setWaitingText('Đang chờ lượt tải lên…');
        }
      );

      setFile(null);
      if (archiveInput.current !== null) archiveInput.current.value = '';
      setProgress(100);
      setSuccess(`Đã nhận submission. Trạng thái hiện tại: ${uploaded.status}.`);
      if (page === 1) await loadSubmissions();
      else setPage(1);
    } catch (error) {
      setFormError(failureMessage(error));
      setProgress(null);
    } finally {
      setWaitingText(null);
      uploadLock.current = false;
      setUploading(false);
    }
  }

  return (
    <main className="submission-page">
      <div className="submission-intro">
        <p className="eyebrow">CỔNG ĐỘI THI</p>
        <h1>Nộp bot dự thi</h1>
        <p>Đóng gói bot thành OCI image archive rồi tải lên. Nền tảng sẽ kiểm tra cấu trúc và chạy preflight trước khi bot được sử dụng.</p>
      </div>

      <section className="submission-upload" aria-labelledby="submission-upload-title">
        <h2 id="submission-upload-title">Tải OCI archive</h2>
        <p>Chỉ nhận một file `.tar`, tối đa 256 MiB. Không gửi source code, Dockerfile, lệnh chạy hoặc thông tin registry riêng.</p>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="bot-archive">OCI image archive (.tar)</label>
          <input ref={archiveInput} id="bot-archive" type="file" accept=".tar,application/x-tar" disabled={uploading} onChange={(event) => chooseFile(event.currentTarget.files?.[0])} />
          {file !== null && <p className="selected-file">{file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MiB</p>}
          {uploading && (
            <div className="upload-progress" role="status" aria-live="polite">
              <span>{waitingText ?? (progress === null ? 'Đang tải archive…' : `Đang tải archive: ${progress}%`)}</span>
              <progress
                role="progressbar"
                max="100"
                value={progress ?? undefined}
                aria-label="Tiến trình tải archive"
                aria-valuenow={progress ?? undefined}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          )}
          {formError !== null && <p className="submission-error" role="alert">{formError}</p>}
          {success !== null && <p className="submission-success" role="status">{success}</p>}
          <button type="submit" disabled={file === null || uploading}>{uploading ? 'Đang nộp…' : 'Nộp bot'}</button>
        </form>
      </section>

      <SubmissionStatus
        submissions={submissions}
        loading={loadingList}
        error={listError}
        pagination={pagination}
        onPageChange={setPage}
        onRetry={() => void loadSubmissions()}
        preflightQueueLength={preflightQueueLength}
      />
    </main>
  );
}
