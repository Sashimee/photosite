import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { api } from './api';

const DEVICE_ID_KEY = 'photoo.push.deviceId';
const PROMPT_DISMISSED_KEY = 'photoo.push.promptDismissed';
const UNREGISTER_TIMEOUT_MS = 5000;

const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export type RegisterResult =
  'registered' | 'permission-missing' | 'unavailable' | 'no-project-id' | 'failed';

function easProjectId(): string | undefined {
  const eas = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas;
  return typeof eas?.projectId === 'string' && eas.projectId.length > 0 ? eas.projectId : undefined;
}

export async function getPushPermission(): Promise<PushPermission> {
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status === Notifications.PermissionStatus.GRANTED) {
    return 'granted';
  }
  return status === Notifications.PermissionStatus.UNDETERMINED && canAskAgain
    ? 'undetermined'
    : 'denied';
}

export async function requestPushPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === Notifications.PermissionStatus.GRANTED;
}

export async function isPromptDismissed(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PROMPT_DISMISSED_KEY, STORE_OPTIONS)) === '1';
}

export async function dismissPrompt(): Promise<void> {
  await SecureStore.setItemAsync(PROMPT_DISMISSED_KEY, '1', STORE_OPTIONS);
}

async function dropRevokedDevice(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, UNREGISTER_TIMEOUT_MS);
  try {
    const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY, STORE_OPTIONS);
    if (!deviceId) {
      return;
    }
    const { response } = await api.DELETE('/v1/me/devices/{id}', {
      params: { path: { id: deviceId } },
      signal: controller.signal,
    });
    if (response.ok || response.status === 404) {
      await SecureStore.deleteItemAsync(DEVICE_ID_KEY, STORE_OPTIONS);
      return;
    }
    Sentry.captureMessage(
      `Push device removal after revoked permission failed with HTTP ${String(response.status)}`,
      'warning',
    );
  } catch (error) {
    Sentry.captureException(error);
  } finally {
    clearTimeout(timer);
  }
}

export async function registerPushDevice(): Promise<RegisterResult> {
  if (!Device.isDevice || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
    return 'unavailable';
  }
  try {
    if ((await getPushPermission()) !== 'granted') {
      await dropRevokedDevice();
      return 'permission-missing';
    }
    const projectId = easProjectId();
    if (!projectId) {
      Sentry.addBreadcrumb({
        category: 'push',
        level: 'warning',
        message: 'Push registration skipped: extra.eas.projectId is not set',
      });
      return 'no-project-id';
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { data } = await api.POST('/v1/me/devices', {
      body: { expoPushToken: token, platform: Platform.OS },
    });
    if (!data) {
      return 'failed';
    }
    await SecureStore.setItemAsync(DEVICE_ID_KEY, data.id, STORE_OPTIONS);
    return 'registered';
  } catch (error) {
    Sentry.captureException(error);
    return 'failed';
  }
}

export async function unregisterPushDevice(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, UNREGISTER_TIMEOUT_MS);
  try {
    const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY, STORE_OPTIONS);
    if (!deviceId) {
      return;
    }
    const { response } = await api.DELETE('/v1/me/devices/{id}', {
      params: { path: { id: deviceId } },
      signal: controller.signal,
    });
    if (!response.ok) {
      Sentry.captureMessage(
        `Push device unregistration failed with HTTP ${String(response.status)}`,
        'warning',
      );
    }
  } catch (error) {
    Sentry.captureException(error);
  } finally {
    clearTimeout(timer);
    try {
      await SecureStore.deleteItemAsync(DEVICE_ID_KEY, STORE_OPTIONS);
    } catch (error) {
      Sentry.captureException(error);
    }
  }
}
