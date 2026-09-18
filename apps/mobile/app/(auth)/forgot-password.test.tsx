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

describe('forgot-password screen', () => {
  it('shows the neutral success notice after requesting a reset', async () => {
    mockedPost.mockResolvedValue({
      data: { message: 'If an account exists, a reset email has been sent.' },
      error: undefined,
      response: new Response(null, { status: 202 }),
    });

    renderRouter('./app', { initialUrl: '/forgot-password' });

    await waitFor(() => screen.getByTestId('forgot-password-email'));
    fireEvent.changeText(screen.getByTestId('forgot-password-email'), 'client@example.com');
    fireEvent.press(screen.getByTestId('forgot-password-submit'));

    await waitFor(() => screen.getByTestId('forgot-password-success'));
    expect(mockedPost).toHaveBeenCalledWith('/v1/auth/password-reset/request', {
      body: { email: 'client@example.com' },
    });
  });
});
