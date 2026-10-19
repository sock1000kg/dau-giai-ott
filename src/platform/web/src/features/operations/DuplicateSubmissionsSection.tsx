import { useEffect, useState } from 'react';
import { Alert, Badge } from '../../ui/index.ts';
import {
  listFlaggedSubmissions,
  operationsErrorMessage,
  type FlaggedSubmissionItem,
  type Pagination,
} from './api.ts';
import { DataTable, formatTime, PageControls, Panel, shortId } from './shared.tsx';

export function DuplicateSubmissionsSection({ refreshToken }: Readonly<{ refreshToken: number }>) {
  const [items, setItems] = useState<readonly FlaggedSubmissionItem[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, totalItems: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listFlaggedSubmissions(page).then(
      (result) => {
        if (live) {
          setItems(result.items);
          setPagination(result.pagination);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (live) setError(operationsErrorMessage(cause));
      },
    );
    return () => {
      live = false;
    };
  }, [page, refreshToken]);

  return (
    <Panel
      id="ops-flagged-submissions"
      title="Bản nộp có thể trùng"
      description="Các bản nộp bot có thể trùng — cần BTC xem xét trước vòng đấu. Hệ thống không tự động loại bot."
    >
      {error !== null && <Alert tone="danger">{error}</Alert>}
      <DataTable
        caption="Danh sách submission có thể trùng"
        rows={items}
        rowKey={(item) => item.submissionId}
        emptyMessage="Chưa có bản nộp nào có dấu hiệu trùng lặp"
        columns={[
          { key: 'time', header: 'Thời gian', render: (item) => formatTime(item.createdAt) },
          {
            key: 'team',
            header: 'Đội nộp',
            render: (item) => (
              <>
                <span>{item.teamName}</span>{' '}
                <code className="ops-code" title={item.submissionId}>
                  {shortId(item.submissionId)}
                </code>
              </>
            ),
          },
          { key: 'status', header: 'Trạng thái', render: (item) => <Badge accent>{item.status}</Badge> },
          { key: 'matchType', header: 'Kiểu trùng', render: (item) => item.matchType ?? '—' },
          {
            key: 'duplicateOf',
            header: 'Trùng với đội',
            render: (item) => (
              <>
                <span>{item.duplicateOfTeamName ?? '—'}</span>
                {item.duplicateOfSubmissionId && (
                  <>
                    {' '}
                    <code className="ops-code" title={item.duplicateOfSubmissionId}>
                      {shortId(item.duplicateOfSubmissionId)}
                    </code>
                  </>
                )}
              </>
            ),
          },
          { key: 'reason', header: 'Lý do', render: (item) => item.reason ?? '—' },
        ]}
      />
      <PageControls page={pagination.page} totalPages={pagination.totalPages} onPage={setPage} />
    </Panel>
  );
}
