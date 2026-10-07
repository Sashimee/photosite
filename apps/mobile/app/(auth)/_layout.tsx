import { Redirect, Stack, useGlobalSearchParams } from 'expo-router';

import { useAuth } from '../../src/lib/auth-context';
import { sanitizeReturnPath } from '../../src/lib/return-path';

// Reactive Redirect, not `Stack.Protected`, for the same reason as
// src/components/require-session.tsx.
export default function AuthLayout() {
  const { status } = useAuth();
  const { next } = useGlobalSearchParams<{ next?: string }>();

  if (status === 'loading') {
    return null;
  }

  if (status === 'signed-in') {
    return <Redirect href={sanitizeReturnPath(next) ?? '/'} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
