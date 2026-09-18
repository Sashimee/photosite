import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/lib/auth-context';

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
