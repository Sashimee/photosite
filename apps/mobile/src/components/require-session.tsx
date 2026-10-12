import { Redirect, useGlobalSearchParams, usePathname } from 'expo-router';
import type { ReactNode } from 'react';

import { useAuth } from '../lib/auth-context';
import { signInHref } from '../lib/return-path';

// A reactive Redirect, not `Tabs.Protected`: Protected picks the route once,
// before an async `status` can settle, and never reconsiders it.
export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams();

  if (status === 'loading') {
    return null;
  }

  if (status === 'signed-out') {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        query.set(key, value);
      }
    }
    const queryString = query.toString();
    return <Redirect href={signInHref(queryString ? `${pathname}?${queryString}` : pathname)} />;
  }

  return <>{children}</>;
}
