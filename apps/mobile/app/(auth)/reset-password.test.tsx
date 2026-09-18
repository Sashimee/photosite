import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

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

import { api } from '../../src/lib/api';

const mockedPost = jest.mocked(api.POST);

describe('reset-password screen', () => {
  it('prefills the token from the route params and shows success', async () => {
    mockedPost.mockResolvedValue({
      data: { message: 'Password updated.' },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    renderRouter('./app', { initialUrl: '/reset-password?token=a1b2c3d4e5' });

    await waitFor(() => screen.getByTestId('reset-password-password'));
    fireEvent.changeText(
      screen.getByTestId('reset-password-password'),
      'correct horse battery staple',
    );
    fireEvent.press(screen.getByTestId('reset-password-submit'));

    await waitFor(() => screen.getByTestId('reset-password-success'));
    expect(mockedPost).toHaveBeenCalledWith('/v1/auth/password-reset/confirm', {
      body: { token: 'a1b2c3d4e5', password: 'correct horse battery staple' },
    });
  });

  it('shows the mapped error for an expired token', async () => {
    mockedPost.mockResolvedValue({
      data: undefined,
      error: { code: 'TOKEN_EXPIRED', message: 'expired', requestId: 'req-1' },
      response: new Response(null, { status: 409 }),
    });

    renderRouter('./app', { initialUrl: '/reset-password' });

    await waitFor(() => screen.getByTestId('reset-password-token'));
    fireEvent.changeText(screen.getByTestId('reset-password-token'), 'stale-token');
    fireEvent.changeText(
      screen.getByTestId('reset-password-password'),
      'correct horse battery staple',
    );
    fireEvent.press(screen.getByTestId('reset-password-submit'));

    await waitFor(() => screen.getByText('This code has expired. Request a new one.'));
  });
});
