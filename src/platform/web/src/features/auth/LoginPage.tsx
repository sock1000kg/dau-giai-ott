import { useState, type FormEvent } from 'react';
import { AuthApiError } from './api.ts';
import { useAuth } from './AuthProvider.tsx';

export function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(username, password);
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.status === 429) {
        setError('Bạn đã thử đăng nhập quá nhiều lần. Hãy thử lại sau.');
      } else if (cause instanceof AuthApiError && cause.status === 401) {
        setError('Tên đăng nhập hoặc mật khẩu không đúng.');
      } else {
        setError('Không thể đăng nhập lúc này. Vui lòng thử lại.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="welcome-panel">
      <div className="eyebrow"><span aria-hidden="true" /> CỔNG ĐĂNG NHẬP</div>
      <h1>Đăng nhập</h1>
      <p className="welcome-copy">Dùng thông tin tài khoản do Ban tổ chức cung cấp.</p>
      <form aria-label="Đăng nhập" onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="username">Tên đăng nhập</label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          maxLength={128}
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
        />
        <label htmlFor="password">Mật khẩu</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
      <p className="shell-note">Không có chức năng tự đăng ký hoặc đặt lại mật khẩu.</p>
    </main>
  );
}
