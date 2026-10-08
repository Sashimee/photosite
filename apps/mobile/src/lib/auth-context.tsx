import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

import * as Sentry from '@sentry/react-native';

import type { components } from '@photoo/api-client';

import { api, setUnauthorizedListener } from './api';
import { resetChatSocket } from './chat-socket';
import { unregisterPushDevice } from './push';
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
  signOut: (options?: { remote?: boolean }) => Promise<void>;
  updateUser: (user: SessionUser) => void;
  replaceSession: (session: StoredSession) => Promise<void>;
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

  const signingOutRef = useRef(false);

  const signOut = useCallback(async (options?: { remote?: boolean }) => {
    if (signingOutRef.current) {
      return;
    }
    signingOutRef.current = true;
    try {
      await unregisterPushDevice();
      if (options?.remote) {
        await api.POST('/v1/auth/sign-out').catch(() => undefined);
      }
      resetChatSocket();
      await clearStoredSession();
      setUser(null);
      setStatus('signed-out');
    } finally {
      signingOutRef.current = false;
    }
  }, []);

  const updateUser = useCallback((nextUser: SessionUser) => {
    setUser(nextUser);
  }, []);

  const replaceSession = useCallback(async (session: StoredSession) => {
    await setStoredSession(session);
    resetChatSocket();
  }, []);

  const signIn = useCallback(async (nextUser: SessionUser, session: StoredSession) => {
    await setStoredSession(session);
    setUser(nextUser);
    setStatus('signed-in');
  }, []);

  const checkSession = useCallback(async () => {
    const { data } = await api.GET('/v1/auth/session');
    if (!data?.user) {
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
      let stored: StoredSession | null;
      try {
        stored = await getStoredSession();
      } catch (error) {
        Sentry.captureException(error);
        try {
          await clearStoredSession();
        } catch (clearError) {
          Sentry.captureException(clearError);
        }
        if (!cancelled) {
          setStatus('signed-out');
        }
        return;
      }

      if (!stored || isExpired(stored.expiresAt)) {
        if (stored) {
          try {
            await clearStoredSession();
          } catch (clearError) {
            Sentry.captureException(clearError);
          }
        }
        if (!cancelled) {
          setStatus('signed-out');
        }
        return;
      }

      let result;
      try {
        result = await api.GET('/v1/auth/session');
      } catch (error) {
        Sentry.captureException(error);
        if (!cancelled) {
          setStatus('signed-out');
        }
        return;
      }
      const { data, response } = result;
      if (cancelled) {
        return;
      }
      if (data?.user) {
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
    <AuthContext.Provider
      value={{ status, user, signIn, signOut, updateUser, replaceSession, checkSession }}
    >
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
