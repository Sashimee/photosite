import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockPermissions = jest.fn<() => Promise<{ status: string; canAskAgain: boolean }>>();
const mockRequestPermissions = jest.fn<() => Promise<{ status: string }>>();
const mockGetToken = jest.fn<(options: { projectId: string }) => Promise<{ data: string }>>();
jest.mock('expo-notifications', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getPermissionsAsync: () => mockPermissions(),
  requestPermissionsAsync: () => mockRequestPermissions(),
  getExpoPushTokenAsync: (options: { projectId: string }) => mockGetToken(options),
}));

const mockConstants: { expoConfig: { extra?: { eas?: { projectId?: string } } } } = {
  expoConfig: {},
};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConstants.expoConfig;
    },
  },
}));

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

type ApiCall = (path: string, init?: unknown) => Promise<unknown>;
const mockedPost = jest.fn<ApiCall>();
const mockedDelete = jest.fn<ApiCall>();
jest.mock('./api', () => ({
  api: {
    POST: (path: string, init?: unknown) => mockedPost(path, init),
    DELETE: (path: string, init?: unknown) => mockedDelete(path, init),
  },
}));

import * as Sentry from '@sentry/react-native';
import * as SecureStore from 'expo-secure-store';

import { getPushPermission, registerPushDevice } from './push';

beforeEach(() => {
  jest.clearAllMocks();
  mockConstants.expoConfig = { extra: { eas: { projectId: 'project-1' } } };
  mockPermissions.mockResolvedValue({ status: 'granted', canAskAgain: true });
  mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  mockedPost.mockResolvedValue({ data: { id: 'device-9' } });
  mockedDelete.mockResolvedValue({ response: { ok: true, status: 204 } });
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
});

describe('registerPushDevice', () => {
  it('registers the token and keeps the returned device id when permission is granted', async () => {
    await expect(registerPushDevice()).resolves.toBe('registered');

    expect(mockGetToken).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(mockedPost).toHaveBeenCalledWith('/v1/me/devices', {
      body: { expoPushToken: 'ExponentPushToken[abc]', platform: 'ios' },
    });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'photoo.push.deviceId',
      'device-9',
      expect.anything(),
    );
  });

  it('never asks for a token or registers while permission is not granted', async () => {
    mockPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });

    await expect(registerPushDevice()).resolves.toBe('permission-missing');

    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('deletes the stored device and clears its id when permission was revoked', async () => {
    mockPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('device-9');

    await expect(registerPushDevice()).resolves.toBe('permission-missing');

    expect(mockedDelete).toHaveBeenCalledWith('/v1/me/devices/{id}', {
      params: { path: { id: 'device-9' } },
    });
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'photoo.push.deviceId',
      expect.anything(),
    );
  });

  it('makes no delete call when permission was revoked and no device id is stored', async () => {
    mockPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });

    await expect(registerPushDevice()).resolves.toBe('permission-missing');

    expect(mockedDelete).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('keeps the device id for a retry and reports without the token when the delete fails', async () => {
    mockPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('device-9');
    mockedDelete.mockResolvedValue({ response: { ok: false, status: 500 } });

    await expect(registerPushDevice()).resolves.toBe('permission-missing');

    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(jest.mocked(Sentry.captureMessage).mock.calls)).not.toContain(
      'ExponentPushToken',
    );
  });

  it('keeps the device id for a retry and reports instead of throwing when the delete rejects', async () => {
    mockPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('device-9');
    const failure = new Error('offline');
    mockedDelete.mockRejectedValue(failure);

    await expect(registerPushDevice()).resolves.toBe('permission-missing');

    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
  });

  it('skips quietly with a breadcrumb when there is no EAS project id', async () => {
    mockConstants.expoConfig = {};

    await expect(registerPushDevice()).resolves.toBe('no-project-id');

    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'push' }),
    );
  });

  it('reports instead of throwing when the token request fails', async () => {
    mockGetToken.mockRejectedValue(new Error('no network'));

    await expect(registerPushDevice()).resolves.toBe('failed');

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('does not keep a device id when the API rejects the registration', async () => {
    mockedPost.mockResolvedValue({ data: undefined, error: { code: 'VALIDATION_ERROR' } });

    await expect(registerPushDevice()).resolves.toBe('failed');

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});

describe('getPushPermission', () => {
  it('treats a denied status that cannot be asked again as denied', async () => {
    mockPermissions.mockResolvedValue({ status: 'denied', canAskAgain: false });
    await expect(getPushPermission()).resolves.toBe('denied');
  });

  it('is undetermined only before the OS prompt has been shown', async () => {
    mockPermissions.mockResolvedValue({ status: 'undetermined', canAskAgain: true });
    await expect(getPushPermission()).resolves.toBe('undetermined');
  });
});
