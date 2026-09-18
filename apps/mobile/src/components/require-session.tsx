import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { useAuth } from '../lib/auth-context';

// A reactive Redirect, not `Tabs.Protected`: Protected picks the route once,
// before an async `status` can settle, and never reconsiders it.
export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return null;
  }

  if (status === 'signed-out') {
    return <Redirect href="/sign-in" />;
  }

  return <>{children}</>;
}
