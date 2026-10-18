import type { TeamSubmission } from './api.ts';
import type { SubmissionPage } from './api.ts';
import { Alert, Badge, Button, Card, Table, type TableColumn } from '../../ui/index.ts';

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

const statusTones: Record<TeamSubmission['status'], 'success' | 'info' | 'danger' | 'neutral'> = {
  UPLOADED: 'info',
  INSPECTING: 'info',
  INVALID: 'danger',
  PREFLIGHT: 'info',
  VALID: 'success',
  ACTIVE: 'success',
  SUPERSEDED: 'neutral',
  REVOKED: 'danger',
};

const dateFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' });

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
  const columns: readonly TableColumn<TeamSubmission>[] = [
    { key: 'time', header: 'Thời điểm', render: (submission) => <time dateTime={submission.createdAt}>{dateFormat.format(new Date(submission.createdAt))}</time> },
    {
      key: 'status',
      header: 'Trạng thái',
      render: (submission) => (
        <span className={`submissions-status submissions-status--${statusTones[submission.status]}`}>
          <Badge>{statusLabels[submission.status]}</Badge>
        </span>
      ),
    },
    {
      key: 'preflight',
      header: 'Vị trí preflight',
      render: (submission) => submission.status === 'PREFLIGHT' && submission.preflightPosition != null
        ? <span>Vị trí preflight: {submission.preflightPosition} / {preflightQueueLength ?? submission.preflightPosition}</span>
        : <span aria-hidden="true">—</span>,
    },
  ];
  return (
    <Card title="Các bot đã nộp" className="submissions-history">
      <div className="submissions-history-bar">
        <p className="eyebrow">HỒ SƠ ĐỘI THI</p>
        <Button variant="secondary" onClick={onRetry} disabled={loading}>
          {loading ? 'Đang tải…' : 'Làm mới'}
        </Button>
      </div>
      {loading && <div role="status" aria-busy="true" className="ui-alert ui-alert--info">Đang tải trạng thái submission…</div>}
      {!loading && error !== null && (
        <Alert tone="danger">
          <p>{error}</p>
          <Button variant="secondary" onClick={onRetry}>Thử lại</Button>
        </Alert>
      )}
      {!loading && error === null && (
        <Table
          caption="Danh sách submission của đội"
          columns={columns}
          rows={submissions}
          rowKey={(submission) => submission.id}
          emptyMessage="Đội chưa có submission nào."
        />
      )}
      {!loading && error === null && pagination.totalPages > 1 && (
        <nav className="submissions-pagination" aria-label="Phân trang submission">
          <Button variant="secondary" disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)}>
            Trang trước
          </Button>
          <span>
            Trang {pagination.page} / {pagination.totalPages} · {pagination.totalItems} submission
          </span>
          <Button variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)}>
            Trang sau
          </Button>
        </nav>
      )}
    </Card>
  );
}
