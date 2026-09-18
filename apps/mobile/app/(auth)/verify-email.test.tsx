import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

const TOKEN_KEY = 'photoo.session.token';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

jest.mock('../../src/lib/api', () => ({
  api: { POST: jest.fn(), GET: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

import { api } from '../../src/lib/api';

const mockedGetItemAsync = jest.mocked(SecureStore.getItemAsync);
const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);

describe('verify-email screen', () => {
  it('offers to sign in directly when there is no stored token', async () => {
    renderRouter('./app', { initialUrl: '/verify-email' });

    await waitFor(() => screen.getByTestId('verify-email-go-to-sign-in'));
    expect(screen.queryByTestId('verify-email-continue')).toBeNull();

    fireEvent.press(screen.getByTestId('verify-email-go-to-sign-in'));

    await waitFor(() => screen.getByTestId('sign-in-submit'));
  });

  it('retries the session check and shows a not-verified-yet notice when a token exists', async () => {
    mockedGetItemAsync.mockImplementation((key: string) =>
      Promise.resolve(key === TOKEN_KEY ? 'token-abc' : null),
    );
    mockedGet.mockResolvedValue({
      data: undefined,
      error: { code: 'UNAUTHORIZED', message: 'no session', requestId: 'req-1' },
      response: new Response(null, { status: 401 }),
    });

    renderRouter('./app', { initialUrl: '/verify-email' });

    await waitFor(() => screen.getByTestId('verify-email-continue'));
    fireEvent.press(screen.getByTestId('verify-email-continue'));

    await waitFor(() => screen.getByTestId('verify-email-notice'));
  });

  it('verifies with a pasted token and shows success', async () => {
    mockedPost.mockResolvedValue({
      data: {
        user: {
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          email: 'client@example.com',
          emailVerifiedAt: '2027-01-01T00:00:00.000Z',
          locale: 'en',
          country: 'LU',
          roles: ['client'],
          status: 'active',
          twoFactorEnabled: false,
          lastLoginAt: null,
        },
      },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    renderRouter('./app', { initialUrl: '/verify-email' });

    await waitFor(() => screen.getByTestId('verify-email-token'));
    fireEvent.changeText(screen.getByTestId('verify-email-token'), 'a1b2c3d4e5f6');
    fireEvent.press(screen.getByTestId('verify-email-token-submit'));

    await waitFor(() => screen.getByTestId('verify-email-success'));
    expect(mockedPost).toHaveBeenCalledWith('/v1/auth/verify-email', {
      body: { token: 'a1b2c3d4e5f6' },
    });
  });
});
