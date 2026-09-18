import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { useAuth } from '../lib/auth-context';

// Belt-and-braces for the tab bar's `Tabs.Protected` guard (which only stops
// tapping into a hidden tab): this also covers a screen reached by a direct
// deep link before the guard has hidden it.
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
