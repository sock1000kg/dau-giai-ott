import { useState } from 'react';

export function useLogout(onLogout: () => Promise<void>) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout() {
    setLoggingOut(true);
    setFailed(false);
    try {
      await onLogout();
    } catch {
      setFailed(true);
    } finally {
      setLoggingOut(false);
    }
  }

  return { loggingOut, failed, logout };
}

export const LOGOUT_FAILED_MESSAGE = 'Không thể đăng xuất lúc này. Vui lòng thử lại.';
