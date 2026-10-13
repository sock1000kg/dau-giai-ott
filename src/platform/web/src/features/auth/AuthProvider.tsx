import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getCurrentSession, login as submitLogin, logout as submitLogout, type AuthPrincipal } from './api.ts';

type AuthState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'anonymous' }>
  | Readonly<{ status: 'error' }>
  | Readonly<{ status: 'authenticated'; principal: AuthPrincipal }>;

interface AuthContextValue {
  readonly state: AuthState;
  readonly login: (username: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
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

  const login = useCallback(async (username: string, password: string) => {
    const principal = await submitLogin(username, password);
    setState({ status: 'authenticated', principal });
  }, []);

  const logout = useCallback(async () => {
    await submitLogout();
    setState({ status: 'anonymous' });
  }, []);

  const value = useMemo(() => ({ state, login, logout, restoreSession }), [state, login, logout, restoreSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
