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

describe('sign-up screen', () => {
  it('posts the shared schema shape and routes to the check-your-email screen', async () => {
    mockedPost.mockResolvedValue({
      data: {
        user: {
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          email: 'client@example.com',
          emailVerifiedAt: null,
          locale: 'en',
          country: 'LU',
          roles: ['client'],
          status: 'active',
          twoFactorEnabled: false,
          lastLoginAt: null,
        },
      },
      error: undefined,
      response: new Response(null, { status: 201 }),
    });

    renderRouter('./app', { initialUrl: '/sign-up' });

    await waitFor(() => screen.getByTestId('sign-up-email'));
    fireEvent.changeText(screen.getByTestId('sign-up-email'), 'client@example.com');
    fireEvent.changeText(screen.getByTestId('sign-up-password'), 'correct horse battery staple');
    fireEvent.press(screen.getByTestId('sign-up-role-client'));
    fireEvent.press(screen.getByTestId('sign-up-submit'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/v1/auth/sign-up', {
        body: {
          email: 'client@example.com',
          password: 'correct horse battery staple',
          roles: ['client'],
          locale: 'en',
        },
      });
    });

    await waitFor(() => screen.getByText('Check your email'));
  });
});
