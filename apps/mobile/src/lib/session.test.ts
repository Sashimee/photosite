import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

import * as SecureStore from 'expo-secure-store';

import { clearSessionToken, getSessionToken, setSessionToken } from './session';

const mockedSecureStore = jest.mocked(SecureStore);

const deviceOnly = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

describe('session', () => {
  it('reads the bearer token from secure storage', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce('token-123');

    await expect(getSessionToken()).resolves.toBe('token-123');
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('photoo.session.token', deviceOnly);
  });

  it('returns null when no token is stored', async () => {
    mockedSecureStore.getItemAsync.mockResolvedValueOnce(null);

    await expect(getSessionToken()).resolves.toBeNull();
  });

  it('writes the bearer token to secure storage', async () => {
    await setSessionToken('token-abc');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'photoo.session.token',
      'token-abc',
      deviceOnly,
    );
  });

  it('deletes the bearer token from secure storage on logout', async () => {
    await clearSessionToken();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('photoo.session.token', deviceOnly);
  });
});
