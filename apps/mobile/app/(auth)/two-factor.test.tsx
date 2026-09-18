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

describe('two-factor screen', () => {
  it('shows the mapped error for a wrong code', async () => {
    mockedPost.mockResolvedValue({
      data: undefined,
      error: { code: 'INVALID_CODE', message: 'nope', requestId: 'req-1' },
      response: new Response(null, { status: 400 }),
    });

    renderRouter('./app', { initialUrl: '/two-factor' });

    await waitFor(() => screen.getByTestId('two-factor-code'));
    fireEvent.changeText(screen.getByTestId('two-factor-code'), '123456');
    fireEvent.press(screen.getByTestId('two-factor-submit'));

    await waitFor(() => screen.getByText("That code isn't correct."));
    expect(mockedPost).toHaveBeenCalledWith('/v1/auth/sign-in/totp', { body: { code: '123456' } });
  });
});
