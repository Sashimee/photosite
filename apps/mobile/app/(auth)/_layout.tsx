import { Redirect, Stack, useGlobalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '../../src/lib/auth-context';
import { sanitizeReturnPath } from '../../src/lib/return-path';

// Reactive Redirect, not `Stack.Protected`, for the same reason as
// src/components/require-session.tsx.
export default function AuthLayout() {
  const { status } = useAuth();
  const router = useRouter();
  const { next } = useGlobalSearchParams<{ next?: string }>();
  const returnPath = sanitizeReturnPath(next);
  const signedIn = status === 'signed-in';

  useEffect(() => {
    if (signedIn && returnPath) {
      router.dismissTo(returnPath);
    }
  }, [signedIn, returnPath, router]);

  if (status === 'loading') {
    return null;
  }

  if (signedIn) {
    return returnPath ? null : <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
