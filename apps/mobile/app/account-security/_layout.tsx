import { Stack } from 'expo-router';

import { RequireSession } from '../../src/components/require-session';

export default function AccountSecurityLayout() {
  return (
    <RequireSession>
      <Stack screenOptions={{ headerShown: false }} />
    </RequireSession>
  );
}
