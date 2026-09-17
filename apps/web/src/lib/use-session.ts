'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from './api';
import type { SessionUser } from './session';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface UseSessionResult {
  user: SessionUser | null;
  status: SessionStatus;
  refresh: () => Promise<void>;
}

// Hydrates from a server-fetched `initialUser` (see getSession()) to avoid a
// loading flash, and exposes `refresh()` so client-side mutations (sign out,
// 2FA changes) can update the session without a full page reload.
export function useSession(initialUser: SessionUser | null = null): UseSessionResult {
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [status, setStatus] = useState<SessionStatus>(initialUser ? 'authenticated' : 'loading');

  const refresh = useCallback(async () => {
    setStatus('loading');
    const { data } = await api.GET('/v1/auth/session', { cache: 'no-store' });
    if (data) {
      setUser(data.user);
      setStatus('authenticated');
    } else {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  // Only run on mount: `initialUser` seeds the very first render, later
  // updates flow through `refresh()` instead.
  useEffect(() => {
    if (initialUser === null) {
      void refresh();
    }
  }, [initialUser, refresh]);

  return { user, status, refresh };
}
