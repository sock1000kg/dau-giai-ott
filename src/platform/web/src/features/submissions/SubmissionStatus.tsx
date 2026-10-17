import type { TeamSubmission } from './api.ts';
import type { SubmissionPage } from './api.ts';

const statusLabels: Record<TeamSubmission['status'], string> = {
  UPLOADED: 'Đã tải lên',
  INSPECTING: 'Đang kiểm tra',
  INVALID: 'Không hợp lệ',
  PREFLIGHT: 'Chờ kiểm tra bot',
  VALID: 'Bot hợp lệ',
  ACTIVE: 'Đang sử dụng',
  SUPERSEDED: 'Đã thay thế',
  REVOKED: 'Đã thu hồi',
};

interface SubmissionStatusProps {
  readonly submissions: readonly TeamSubmission[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly pagination: SubmissionPage['pagination'];
  readonly onPageChange: (page: number) => void;
  readonly preflightQueueLength?: number | undefined;
}

export function SubmissionStatus({
  submissions,
  loading,
  error,
  onRetry,
  pagination,
  onPageChange,
  preflightQueueLength,
}: SubmissionStatusProps) {
  return (
    <section className="submission-history" aria-labelledby="submission-history-title">
      <div className="submission-section-heading">
        <div>
          <p className="eyebrow">HỒ SƠ ĐỘI THI</p>
          <h2 id="submission-history-title">Các bot đã nộp</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onRetry} disabled={loading}>
          {loading ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>
      {loading && <p role="status" aria-busy="true">Đang tải trạng thái submission…</p>}
      {!loading && error !== null && (
        <div className="submission-error" role="alert">
          <p>{error}</p>
          <button type="button" className="secondary-button" onClick={onRetry}>
            Thử lại
          </button>
        </div>
      )}
      {!loading && error === null && submissions.length === 0 && (
        <p className="submission-empty" role="status">
          Đội chưa có submission nào.
        </p>
      )}
      {!loading && error === null && submissions.length > 0 && (
        <ul className="submission-list" aria-label="Danh sách submission của đội">
          {submissions.map((submission) => (
            <li key={submission.id} className="submission-row">
              <div>
                <strong>Submission</strong>
                <time dateTime={submission.createdAt}>{new Date(submission.createdAt).toLocaleString('vi-VN')}</time>
                {submission.status === 'PREFLIGHT' && submission.preflightPosition != null && (
                  <span className="preflight-position">
                    {' · '}Vị trí preflight: {submission.preflightPosition} / {preflightQueueLength ?? submission.preflightPosition}
                  </span>
                )}
              </div>
              <span className={`submission-status status-${submission.status.toLowerCase()}`}>
                {statusLabels[submission.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!loading && error === null && pagination.totalPages > 1 && (
        <nav className="submission-pagination" aria-label="Phân trang submission">
          <button
            type="button"
            className="secondary-button"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange(pagination.page - 1)}
          >
            Trang trước
          </button>
          <span>
            Trang {pagination.page} / {pagination.totalPages} · {pagination.totalItems} submission
          </span>
          <button
            type="button"
            className="secondary-button"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange(pagination.page + 1)}
          >
            Trang sau
          </button>
        </nav>
      )}
    </section>
  );
}
