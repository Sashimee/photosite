import { describe, it, jest } from '@jest/globals';
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

describe('sign-in screen', () => {
  it('routes to the two-factor screen when the API asks for a second factor', async () => {
    mockedPost.mockResolvedValue({
      data: { twoFactorRequired: true },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    renderRouter('./app', { initialUrl: '/sign-in' });

    await waitFor(() => screen.getByTestId('sign-in-email'));
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'client@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => screen.getByTestId('two-factor-code'));
  });

  it('maps a 429 to the too-many-attempts message', async () => {
    mockedPost.mockResolvedValue({
      data: undefined,
      error: { code: 'TOO_MANY_REQUESTS', message: 'slow down', requestId: 'req-1' },
      response: new Response(null, { status: 429 }),
    });

    renderRouter('./app', { initialUrl: '/sign-in' });

    await waitFor(() => screen.getByTestId('sign-in-email'));
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'client@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => screen.getByText('Too many attempts. Try again later.'));
  });

  it('maps a 403 lockout to its own message', async () => {
    mockedPost.mockResolvedValue({
      data: undefined,
      error: { code: 'ACCOUNT_TEMPORARILY_LOCKED', message: 'locked', requestId: 'req-2' },
      response: new Response(null, { status: 403 }),
    });

    renderRouter('./app', { initialUrl: '/sign-in' });

    await waitFor(() => screen.getByTestId('sign-in-email'));
    fireEvent.changeText(screen.getByTestId('sign-in-email'), 'client@example.com');
    fireEvent.changeText(screen.getByTestId('sign-in-password'), 'correct horse battery staple');
    fireEvent.press(screen.getByTestId('sign-in-submit'));

    await waitFor(() => screen.getByText('Your account is temporarily locked. Try again later.'));
  });
});
