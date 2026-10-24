import { useState } from 'react';
import { Page } from '../../ui/index.ts';
import { AuditViewer, QueueOverrides } from './AuditSection.tsx';
import { DuplicateSubmissionsSection } from './DuplicateSubmissionsSection.tsx';
import { PrivilegedActions } from './PrivilegedActions.tsx';
import { ResultBundleImportSection } from './ResultBundleImportSection.tsx';
import { ResultBundleKeysSection } from './ResultBundleKeysSection.tsx';
import { DirectoryProvider } from './shared.tsx';

export function OperationsConsole() {
  const [refreshToken, setRefreshToken] = useState(0);
  return (
    <DirectoryProvider>
      <Page
        title="Vận hành đặc quyền"
        description="Mọi thao tác cần lý do, được xác nhận hai bước và ghi audit chỉ-thêm với correlation ID. Lịch sử kết quả và Elo không bao giờ bị sửa."
      >
        <PrivilegedActions onDone={() => setRefreshToken((token) => token + 1)} />
        <ResultBundleKeysSection refreshToken={refreshToken} />
        <ResultBundleImportSection onDone={() => setRefreshToken((token) => token + 1)} />
        <AuditViewer refreshToken={refreshToken} />
        <QueueOverrides refreshToken={refreshToken} />
        <DuplicateSubmissionsSection refreshToken={refreshToken} />
      </Page>
    </DirectoryProvider>
  );
}
