import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/lib/auth-context';

// Reactive Redirect, not `Stack.Protected`, for the same reason as
// src/components/require-session.tsx.
export default function AuthLayout() {
  const { status } = useAuth();

  if (status === 'loading') {
    return null;
  }

  if (status === 'signed-in') {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
