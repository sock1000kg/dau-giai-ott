import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Input } from '../../ui/index.ts';
import { AuthApiError, changePassword } from './api.ts';
import { useAuth } from './AuthProvider.tsx';
import './auth.css';

export function ChangePasswordPage() {
  const auth = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      auth.passwordChanged();
      window.history.replaceState({}, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.code === 'INVALID_CREDENTIALS') {
        setError('Mật khẩu hiện tại không đúng.');
      } else if (cause instanceof AuthApiError && cause.status === 429) {
        setError('Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.');
      } else if (cause instanceof AuthApiError && cause.code === 'INVALID_INPUT') {
        setError('Mật khẩu mới phải dài từ 12 đến 128 ký tự và không chứa ký tự điều khiển.');
      } else {
        setError('Không thể đổi mật khẩu lúc này. Vui lòng thử lại.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ui-page">
      <Card>
        <h1>Đổi mật khẩu</h1>
        <p>Đổi mật khẩu đội. Sau khi hoàn tất, bạn sẽ cần đăng nhập lại.</p>
        <form className="auth-form" aria-label="Đổi mật khẩu" onSubmit={(event) => void submit(event)}>
          <Field label="Mật khẩu hiện tại" required>
            <Input name="currentPassword" type="password" autoComplete="current-password" maxLength={1024} value={currentPassword} onChange={(event) => setCurrentPassword(event.currentTarget.value)} />
          </Field>
          <Field label="Mật khẩu mới" help="Từ 12 đến 128 ký tự." required>
            <Input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.currentTarget.value)} />
          </Field>
          <Field label="Nhập lại mật khẩu mới" required>
            <Input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.currentTarget.value)} />
          </Field>
          {error !== null && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={busy}>{busy ? 'Đang đổi mật khẩu…' : 'Đổi mật khẩu'}</Button>
        </form>
      </Card>
    </main>
  );
}
