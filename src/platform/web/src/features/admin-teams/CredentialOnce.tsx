import { useState } from 'react';
import { Alert, Button } from '../../ui/index.ts';
import type { TeamCredential } from './api.ts';
import './admin-teams.css';

export function CredentialOnce({
  teamName,
  credential,
  onDismiss,
}: Readonly<{ teamName: string; credential: TeamCredential; onDismiss: () => void }>) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  async function copyCredentials() {
    try {
      if (navigator.clipboard === undefined) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(`Tên đăng nhập: ${credential.username}\nMật khẩu: ${credential.password}`);
      setCopyStatus('Đã sao chép thông tin đăng nhập.');
    } catch {
      setCopyStatus('Không thể sao chép trên trình duyệt này. Hãy chọn và sao chép thủ công.');
    }
  }

  return (
    <section className="ui-card teams-credential ui-stack" aria-label="Thông tin đăng nhập tạo một lần">
      <h2>Thông tin đăng nhập — {teamName}</h2>
      <Alert tone="warning">
        Thông tin đăng nhập chỉ hiển thị một lần. Hãy gửi thông tin này cho đội qua kênh riêng. Mật khẩu không thể xem lại sau khi đóng thẻ này.
      </Alert>
      <dl className="teams-credential-list">
        <div><dt>Tên đăng nhập</dt><dd><code>{credential.username}</code></dd></div>
        <div><dt>Mật khẩu</dt><dd><code>{credential.password}</code></dd></div>
      </dl>
      {copyStatus !== null && <p role="status">{copyStatus}</p>}
      <div className="ui-row">
        <Button onClick={() => void copyCredentials()}>Sao chép</Button>
        <Button variant="secondary" onClick={onDismiss}>Đã lưu thông tin đăng nhập</Button>
      </div>
    </section>
  );
}
