import '../global.css';
import '../src/lib/i18n';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConsentPrompt } from '../src/components/consent/consent-prompt';
import { AuthProvider, useAuth } from '../src/lib/auth-context';
import { ConsentProvider } from '../src/lib/consent-context';
import { initSentry } from '../src/lib/sentry';
import { useNotificationRouting, usePushRegistration } from '../src/lib/use-push-lifecycle';

initSentry();
void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();
  usePushRegistration();
  useNotificationRouting();

  useEffect(() => {
    if (status !== 'loading') {
      void SplashScreen.hideAsync();
    }
  }, [status]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <ConsentPrompt />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ConsentProvider>
            <RootNavigator />
          </ConsentProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
