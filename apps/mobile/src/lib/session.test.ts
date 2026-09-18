import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

import * as SecureStore from 'expo-secure-store';

import {
  clearSessionToken,
  clearStoredSession,
  getSessionToken,
  getStoredSession,
  setSessionToken,
  setStoredSession,
} from './session';

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

describe('stored session', () => {
  it('reads the token and expiresAt from secure storage only', async () => {
    mockedSecureStore.getItemAsync.mockImplementation((key) => {
      if (key === 'photoo.session.token') return Promise.resolve('token-123');
      if (key === 'photoo.session.expiresAt') return Promise.resolve('2027-01-01T00:00:00.000Z');
      return Promise.resolve(null);
    });

    await expect(getStoredSession()).resolves.toEqual({
      token: 'token-123',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('photoo.session.token', deviceOnly);
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('photoo.session.expiresAt', deviceOnly);
  });

  it('returns null when only the token is present', async () => {
    mockedSecureStore.getItemAsync.mockImplementation((key) =>
      Promise.resolve(key === 'photoo.session.token' ? 'token-123' : null),
    );

    await expect(getStoredSession()).resolves.toBeNull();
  });

  it('returns null when only expiresAt is present', async () => {
    mockedSecureStore.getItemAsync.mockImplementation((key) =>
      Promise.resolve(key === 'photoo.session.expiresAt' ? '2027-01-01T00:00:00.000Z' : null),
    );

    await expect(getStoredSession()).resolves.toBeNull();
  });

  it('writes the token and expiresAt to secure storage only', async () => {
    await setStoredSession({ token: 'token-abc', expiresAt: '2027-01-01T00:00:00.000Z' });

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'photoo.session.token',
      'token-abc',
      deviceOnly,
    );
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'photoo.session.expiresAt',
      '2027-01-01T00:00:00.000Z',
      deviceOnly,
    );
  });

  it('deletes the token and expiresAt from secure storage on clear', async () => {
    await clearStoredSession();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('photoo.session.token', deviceOnly);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'photoo.session.expiresAt',
      deviceOnly,
    );
  });
});
