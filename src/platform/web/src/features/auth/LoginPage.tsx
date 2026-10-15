import { useState, type FormEvent } from 'react';
import { AuthApiError } from './api.ts';
import { useAuth } from './AuthProvider.tsx';

export function LoginPage() {
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await auth.login(username, password);
      if (result.mfaRequired) {
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
      <main className="welcome-panel">
        <div className="eyebrow"><span aria-hidden="true" /> XÁC THỰC 2 BƯỚC</div>
        <h1>Xác thực 2 bước</h1>
        <p className="welcome-copy">Nhập mã xác thực từ ứng dụng Authenticator hoặc dùng mã khôi phục.</p>
        <form aria-label="Xác thực 2 bước" onSubmit={(event) => void handleMfaSubmit(event)}>
          {!useRecovery ? (
            <>
              <label htmlFor="mfaCode">Mã xác thực 2 bước</label>
              <input
                id="mfaCode"
                name="mfaCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                value={mfaCode}
                onChange={(event) => setMfaCode(event.currentTarget.value)}
              />
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setUseRecovery(true);
                  setError(null);
                }}
              >
                Dùng mã khôi phục
              </button>
            </>
          ) : (
            <>
              <label htmlFor="recoveryCode">Mã khôi phục</label>
              <input
                id="recoveryCode"
                name="recoveryCode"
                required
                maxLength={32}
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.currentTarget.value)}
              />
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setUseRecovery(false);
                  setError(null);
                }}
              >
                Dùng mã xác thực (TOTP)
              </button>
            </>
          )}
          {error !== null && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'Đang xác thực…' : 'Xác nhận'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="welcome-panel">
      <div className="eyebrow"><span aria-hidden="true" /> CỔNG ĐĂNG NHẬP</div>
      <h1>Đăng nhập</h1>
      <p className="welcome-copy">Dùng thông tin tài khoản do Ban tổ chức cung cấp.</p>
      <form aria-label="Đăng nhập" onSubmit={(event) => void handlePasswordSubmit(event)}>
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
