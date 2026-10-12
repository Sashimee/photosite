import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
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
import {
  clearTwoFactorChallenge,
  getTwoFactorChallenge,
  setTwoFactorChallenge,
} from '../../src/lib/two-factor-challenge';

const mockedPost = jest.mocked(api.POST);
const mockedGet = jest.mocked(api.GET);

const CHALLENGE_EXPIRED = 'Your sign-in timed out. Enter your email and password again.';

const signedIn = {
  data: {
    user: { id: 'user-1', email: 'client@example.com', roles: ['CLIENT'] },
    session: { token: 'bearer-1', expiresAt: '2030-01-01T00:00:00.000Z' },
  },
  error: undefined,
  response: new Response(null, { status: 200 }),
};

describe('two-factor screen', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedGet.mockResolvedValue({
      data: { items: [], nextCursor: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    setTwoFactorChallenge('challenge-1');
  });

  afterEach(() => {
    clearTwoFactorChallenge();
  });

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
    expect(mockedPost).toHaveBeenCalledWith('/v1/auth/sign-in/totp', {
      body: { code: '123456', challengeToken: 'challenge-1' },
    });
  });

  it('sends the challenge token with the authenticator code and clears it on success', async () => {
    mockedPost.mockResolvedValue(signedIn);

    renderRouter('./app', { initialUrl: '/two-factor' });

    await waitFor(() => screen.getByTestId('two-factor-code'));
    fireEvent.changeText(screen.getByTestId('two-factor-code'), '123456');
    fireEvent.press(screen.getByTestId('two-factor-submit'));

    await waitFor(() => {
      expect(getTwoFactorChallenge()).toBeNull();
    });
    expect(mockedPost).toHaveBeenCalledWith('/v1/auth/sign-in/totp', {
      body: { code: '123456', challengeToken: 'challenge-1' },
    });
  });

  it('sends the challenge token with a backup code', async () => {
    mockedPost.mockResolvedValue(signedIn);

    renderRouter('./app', { initialUrl: '/two-factor' });

    await waitFor(() => screen.getByTestId('two-factor-toggle-mode'));
    fireEvent.press(screen.getByTestId('two-factor-toggle-mode'));
    await waitFor(() => screen.getByTestId('two-factor-backup-code'));
    fireEvent.changeText(screen.getByTestId('two-factor-backup-code'), 'abcd-efgh');
    fireEvent.press(screen.getByTestId('two-factor-submit'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/v1/auth/sign-in/totp', {
        body: { backupCode: 'abcd-efgh', challengeToken: 'challenge-1' },
      });
    });
  });

  it('returns to sign-in with an error when opened without a challenge token', async () => {
    clearTwoFactorChallenge();

    renderRouter('./app', { initialUrl: '/two-factor' });

    await waitFor(() => screen.getByTestId('sign-in-challenge-expired'));
    expect(screen.getByText(CHALLENGE_EXPIRED)).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it.each(['INVALID_TWO_FACTOR_COOKIE', 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'])(
    'returns to sign-in with an error and drops the token on %s',
    async (code) => {
      mockedPost.mockResolvedValue({
        data: undefined,
        error: { code, message: 'dead', requestId: 'req-2' },
        response: new Response(null, { status: code === 'INVALID_TWO_FACTOR_COOKIE' ? 401 : 400 }),
      });

      renderRouter('./app', { initialUrl: '/two-factor' });

      await waitFor(() => screen.getByTestId('two-factor-code'));
      fireEvent.changeText(screen.getByTestId('two-factor-code'), '123456');
      fireEvent.press(screen.getByTestId('two-factor-submit'));

      await waitFor(() => screen.getByTestId('sign-in-challenge-expired'));
      expect(screen.getByText(CHALLENGE_EXPIRED)).toBeTruthy();
      expect(getTwoFactorChallenge()).toBeNull();
    },
  );

  it('stays on the screen and keeps the token for a wrong code returned as 401', async () => {
    mockedPost.mockResolvedValue({
      data: undefined,
      error: { code: 'INVALID_CODE', message: 'nope', requestId: 'req-3' },
      response: new Response(null, { status: 401 }),
    });

    renderRouter('./app', { initialUrl: '/two-factor' });

    await waitFor(() => screen.getByTestId('two-factor-code'));
    fireEvent.changeText(screen.getByTestId('two-factor-code'), '123456');
    fireEvent.press(screen.getByTestId('two-factor-submit'));

    await waitFor(() => screen.getByText("That code isn't correct."));
    expect(screen.queryByTestId('sign-in-challenge-expired')).toBeNull();
    expect(getTwoFactorChallenge()).toBe('challenge-1');
  });

  it('stays on the screen and keeps the token for a wrong backup code returned as 401', async () => {
    mockedPost.mockResolvedValue({
      data: undefined,
      error: { code: 'INVALID_BACKUP_CODE', message: 'nope', requestId: 'req-4' },
      response: new Response(null, { status: 401 }),
    });

    renderRouter('./app', { initialUrl: '/two-factor' });

    await waitFor(() => screen.getByTestId('two-factor-toggle-mode'));
    fireEvent.press(screen.getByTestId('two-factor-toggle-mode'));
    await waitFor(() => screen.getByTestId('two-factor-backup-code'));
    fireEvent.changeText(screen.getByTestId('two-factor-backup-code'), 'abcd-efgh');
    fireEvent.press(screen.getByTestId('two-factor-submit'));

    await waitFor(() => screen.getByText("That backup code isn't correct."));
    expect(getTwoFactorChallenge()).toBe('challenge-1');
  });
});
