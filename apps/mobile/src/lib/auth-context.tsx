import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import type { components } from '@photoo/api-client';

import { api, setUnauthorizedListener } from './api';
import {
  clearStoredSession,
  getStoredSession,
  setStoredSession,
  type StoredSession,
} from './session';

export type SessionUser = components['schemas']['User'];

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  signIn: (user: SessionUser, session: StoredSession) => Promise<void>;
  signOut: () => Promise<void>;
  // Re-checks GET /v1/auth/session against whatever token is already stored,
  // for the "check your email" continue button: no-op when there is none.
  checkSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isExpired(expiresAt: string): boolean {
  const time = Date.parse(expiresAt);
  return Number.isNaN(time) || time <= Date.now();
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  const signOut = useCallback(async () => {
    await clearStoredSession();
    setUser(null);
    setStatus('signed-out');
  }, []);

  const signIn = useCallback(async (nextUser: SessionUser, session: StoredSession) => {
    await setStoredSession(session);
    setUser(nextUser);
    setStatus('signed-in');
  }, []);

  const checkSession = useCallback(async () => {
    const { data } = await api.GET('/v1/auth/session');
    if (!data) {
      return false;
    }
    setUser(data.user);
    setStatus('signed-in');
    return true;
  }, []);

  useEffect(() => {
    setUnauthorizedListener(() => {
      void signOut();
    });
    return () => {
      setUnauthorizedListener(null);
    };
  }, [signOut]);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const stored = await getStoredSession();
      if (!stored || isExpired(stored.expiresAt)) {
        if (stored) {
          await clearStoredSession();
        }
        if (!cancelled) {
          setStatus('signed-out');
        }
        return;
      }

      const { data, response } = await api.GET('/v1/auth/session');
      if (cancelled) {
        return;
      }
      if (data) {
        setUser(data.user);
        setStatus('signed-in');
        return;
      }
      if (response.status === 401) {
        // The shared 401 hook (src/lib/api.ts) already cleared the stored
        // session and will drive the state transition.
        return;
      }
      // A non-401 failure (network error, 5xx) doesn't prove the session is
      // invalid, so the stored token is kept for the next launch to retry.
      setStatus('signed-out');
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, signIn, signOut, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
