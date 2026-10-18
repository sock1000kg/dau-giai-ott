import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Button, Card, Field, Input } from '../../ui/index.ts';
import { AuthApiError } from './api.ts';
import { useAuth } from './AuthProvider.tsx';
import './auth.css';

function AuthFrame({ title, description, children }: Readonly<{ title: string; description: string; children: ReactNode }>) {
  return (
    <main className="auth-page">
      <Card as="div" className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">O</span>
          <span>OTT Arena</span>
        </div>
        <h1>{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
      </Card>
    </main>
  );
}

export function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await auth.login(username, password);
      if (result.mfaRequired) {
        setPassword('');
        setShowPassword(false);
        setMfaRequired(true);
      }
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

  function backToPassword() {
    setMfaRequired(false);
    setUseRecovery(false);
    setMfaCode('');
    setRecoveryCode('');
    setError(null);
  }

  function switchCodeMode(recovery: boolean) {
    setUseRecovery(recovery);
    setError(null);
  }

  async function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (useRecovery) {
        await auth.loginMfa({ recoveryCode });
      } else {
        await auth.loginMfa({ code: mfaCode });
      }
    } catch (cause) {
      if (cause instanceof AuthApiError && cause.status === 429) {
        setError('Bạn đã thử đăng nhập quá nhiều lần. Hãy thử lại sau.');
      } else if (cause instanceof AuthApiError && cause.status === 401) {
        setError('Mã không đúng hoặc đã hết hạn');
      } else {
        setError('Không thể xác thực lúc này. Vui lòng thử lại.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (mfaRequired) {
    return (
      <AuthFrame title="Xác thực 2 bước" description="Nhập mã xác thực từ ứng dụng Authenticator hoặc dùng mã khôi phục.">
        <p className="auth-step">Bước 2/2 — Xác thực 2 bước</p>
        <form className="auth-form" aria-label="Xác thực 2 bước" onSubmit={(event) => void handleMfaSubmit(event)}>
          {!useRecovery ? (
            <>
              <Field label="Mã xác thực 2 bước" help="Mã 6 chữ số trong ứng dụng Authenticator" required>
                <Input
                  className="auth-code"
                  name="mfaCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.currentTarget.value)}
                />
              </Field>
              <Button variant="ghost" onClick={() => switchCodeMode(true)}>
                Dùng mã khôi phục
              </Button>
            </>
          ) : (
            <>
              <Field label="Mã khôi phục" help="Mỗi mã khôi phục chỉ dùng được một lần" required>
                <Input
                  className="auth-code"
                  name="recoveryCode"
                  autoComplete="off"
                  autoFocus
                  maxLength={32}
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.currentTarget.value)}
                />
              </Field>
              <Button variant="ghost" onClick={() => switchCodeMode(false)}>
                Dùng mã xác thực (TOTP)
              </Button>
            </>
          )}
          {error !== null && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Đang xác thực…' : 'Xác nhận'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={backToPassword}>
            Quay lại
          </Button>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Đăng nhập" description="Dùng thông tin tài khoản do Ban tổ chức cung cấp.">
      <form className="auth-form" aria-label="Đăng nhập" onSubmit={(event) => void handlePasswordSubmit(event)}>
        <Field label="Tên đăng nhập" help="Tên đăng nhập do Ban tổ chức cấp cho đội hoặc quản trị viên" required>
          <Input
            name="username"
            id="username"
            autoComplete="username"
            autoFocus
            maxLength={128}
            value={username}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
        </Field>
        <Field label="Mật khẩu" required>
          <Input
            name="password"
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </Field>
        <Button variant="ghost" aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
          Hiện mật khẩu
        </Button>
        {error !== null && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
      </form>
      <p className="auth-note">Không có chức năng tự đăng ký hoặc đặt lại mật khẩu.</p>
    </AuthFrame>
  );
}
