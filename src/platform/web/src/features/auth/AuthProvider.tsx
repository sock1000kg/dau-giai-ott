import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  getCurrentSession,
  login as submitLogin,
  loginMfa as submitLoginMfa,
  logout as submitLogout,
  type AuthPrincipal,
  type LoginResult,
} from './api.ts';

type AuthState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'anonymous' }>
  | Readonly<{ status: 'error' }>
  | Readonly<{ status: 'authenticated'; principal: AuthPrincipal }>;

interface AuthContextValue {
  readonly state: AuthState;
  readonly login: (username: string, password: string) => Promise<LoginResult>;
  readonly loginMfa: (payload: { code?: string; recoveryCode?: string }) => Promise<AuthPrincipal>;
  readonly logout: () => Promise<void>;
  readonly passwordChanged: () => void;
  readonly completeLogin: (principal: AuthPrincipal) => void;
  readonly restoreSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const restoreSession = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const principal = await getCurrentSession();
      setState(principal === null ? { status: 'anonymous' } : { status: 'authenticated', principal });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const completeLogin = useCallback((principal: AuthPrincipal) => {
    window.history.replaceState({}, '', principal.role === 'BTC_ADMIN' ? '/admin' : '/team');
    setState({ status: 'authenticated', principal });
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<LoginResult> => {
    const result = await submitLogin(username, password);
    if (!result.mfaRequired) {
      completeLogin(result.principal);
    }
    return result;
  }, [completeLogin]);

  const loginMfa = useCallback(async (payload: { code?: string; recoveryCode?: string }): Promise<AuthPrincipal> => {
    const principal = await submitLoginMfa(payload);
    completeLogin(principal);
    return principal;
  }, [completeLogin]);

  const logout = useCallback(async () => {
    await submitLogout();
    setState({ status: 'anonymous' });
  }, []);

  const passwordChanged = useCallback(() => setState({ status: 'anonymous' }), []);

  const value = useMemo(
    () => ({ state, login, loginMfa, logout, passwordChanged, completeLogin, restoreSession }),
    [state, login, loginMfa, logout, passwordChanged, completeLogin, restoreSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
