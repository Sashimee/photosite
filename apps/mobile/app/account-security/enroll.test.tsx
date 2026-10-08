import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Linking } from 'react-native';
import type { ReactNode } from 'react';

const callOrder: string[] = [];
const mockReplaceSession = jest.fn<(session: unknown) => Promise<void>>();
const mockUpdateUser = jest.fn<(user: unknown) => void>();
const mockSignOut = jest.fn<() => Promise<void>>();
jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    status: 'signed-in',
    user: { email: 'a@example.com', roles: ['client'], twoFactorEnabled: false },
    replaceSession: mockReplaceSession,
    updateUser: mockUpdateUser,
    signOut: mockSignOut,
  }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('../../src/lib/push', () => ({
  registerPushDevice: jest.fn(),
  unregisterPushDevice: jest.fn(),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

import * as Clipboard from 'expo-clipboard';
import '../../src/lib/i18n';
import { api } from '../../src/lib/api';
import { registerPushDevice } from '../../src/lib/push';

const mockedPost = jest.mocked(api.POST);
const mockedRegisterPush = jest.mocked(registerPushDevice);
const mockedSetString = jest.mocked(Clipboard.setStringAsync);

const ENROLLMENT = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUrl: 'otpauth://totp/photoo.lu:a@example.com?secret=JBSWY3DPEHPK3PXP',
  backupCodes: ['abcde-12345', 'fghij-67890'],
};
const ENABLED_USER = { email: 'a@example.com', roles: ['client'], twoFactorEnabled: true };
const ROTATED = { token: 'rotated-token', expiresAt: '2030-01-01T00:00:00.000Z' };

function reply(status: number, body: unknown) {
  return {
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  } as never;
}

async function reachSecretStep() {
  mockedPost.mockResolvedValueOnce(reply(200, ENROLLMENT));
  renderRouter('./app', { initialUrl: '/account-security/enroll' });
  fireEvent.changeText(await screen.findByTestId('two-factor-enroll-password'), 'hunter2hunter2');
  fireEvent.press(screen.getByTestId('two-factor-enroll-password-submit'));
  await screen.findByTestId('two-factor-enroll-secret');
}

async function reachCodeStep() {
  await reachSecretStep();
  fireEvent.press(screen.getByTestId('two-factor-enroll-stored'));
  await screen.findByTestId('two-factor-enroll-code');
  callOrder.length = 0;
}

function submitCode(code: string) {
  fireEvent.changeText(screen.getByTestId('two-factor-enroll-code'), code);
  fireEvent.press(screen.getByTestId('two-factor-enroll-code-submit'));
}

beforeEach(() => {
  callOrder.length = 0;
  mockedPost.mockReset();
  mockedRegisterPush.mockReset();
  mockedSetString.mockReset();
  mockReplaceSession.mockReset();
  mockUpdateUser.mockReset();
  mockSignOut.mockReset();
  mockReplaceSession.mockImplementation(() => {
    callOrder.push('replaceSession');
    return Promise.resolve();
  });
  mockUpdateUser.mockImplementation(() => {
    callOrder.push('updateUser');
  });
  mockedRegisterPush.mockImplementation(() => {
    callOrder.push('registerPush');
    return Promise.resolve('registered');
  });
  mockedSetString.mockResolvedValue(true);
});

describe('enroll two-factor screen', () => {
  it('posts the password and shows the secret and backup codes', async () => {
    await reachSecretStep();

    expect(mockedPost).toHaveBeenCalledWith('/v1/auth/totp/enroll', {
      body: { password: 'hunter2hunter2' },
    });
    expect(screen.getByTestId('two-factor-enroll-secret').props.children).toBe(ENROLLMENT.secret);
    expect(screen.getByTestId('two-factor-enroll-backup-codes').props.children).toBe(
      'abcde-12345\nfghij-67890',
    );
  });

  it('surfaces a wrong password and stays on the password step', async () => {
    mockedPost.mockResolvedValueOnce(reply(400, { code: 'INVALID_PASSWORD', message: 'bad' }));
    renderRouter('./app', { initialUrl: '/account-security/enroll' });

    fireEvent.changeText(await screen.findByTestId('two-factor-enroll-password'), 'wrongwrong');
    fireEvent.press(screen.getByTestId('two-factor-enroll-password-submit'));

    await screen.findByText("That password isn't correct.");
    expect(screen.queryByTestId('two-factor-enroll-secret')).toBeNull();
  });

  it('copies the secret and the backup codes', async () => {
    await reachSecretStep();

    fireEvent.press(screen.getByTestId('two-factor-enroll-copy-secret'));
    await screen.findByTestId('two-factor-enroll-copy-secret-copied');
    fireEvent.press(screen.getByTestId('two-factor-enroll-copy-backup-codes'));
    await screen.findByTestId('two-factor-enroll-copy-backup-codes-copied');

    expect(mockedSetString).toHaveBeenNthCalledWith(1, ENROLLMENT.secret);
    expect(mockedSetString).toHaveBeenNthCalledWith(2, 'abcde-12345\nfghij-67890');
  });

  it('tells the user when the clipboard is unavailable', async () => {
    mockedSetString.mockRejectedValue(new Error('no clipboard'));
    await reachSecretStep();

    fireEvent.press(screen.getByTestId('two-factor-enroll-copy-secret'));

    await screen.findByTestId('two-factor-enroll-copy-secret-failed');
  });

  it('opens the otpauth URL and tolerates a missing handler', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await reachSecretStep();

    fireEvent.press(screen.getByTestId('two-factor-enroll-open'));

    await screen.findByTestId('two-factor-enroll-open-failed');
    expect(openURL).toHaveBeenCalledWith(ENROLLMENT.otpauthUrl);
    openURL.mockRestore();
  });

  it('removes the secret and backup codes once they are confirmed stored', async () => {
    await reachCodeStep();

    expect(screen.queryByTestId('two-factor-enroll-secret')).toBeNull();
    expect(screen.queryByTestId('two-factor-enroll-backup-codes')).toBeNull();
    expect(screen.queryByText('abcde-12345', { exact: false })).toBeNull();
    expect(screen.queryByText(ENROLLMENT.secret, { exact: false })).toBeNull();
  });

  it('stores the rotated session before updating the user, then re-registers push', async () => {
    await reachCodeStep();
    mockedPost.mockResolvedValueOnce(reply(200, { user: ENABLED_USER, session: ROTATED }));

    submitCode('123456');

    await waitFor(() => {
      expect(callOrder).toEqual(['replaceSession', 'updateUser', 'registerPush']);
    });
    expect(mockedPost).toHaveBeenLastCalledWith('/v1/auth/totp/verify', {
      body: { code: '123456' },
    });
    expect(mockReplaceSession).toHaveBeenCalledWith(ROTATED);
    expect(mockUpdateUser).toHaveBeenCalledWith(ENABLED_USER);
  });

  it('keeps the current session when verify returns none', async () => {
    await reachCodeStep();
    mockedPost.mockResolvedValueOnce(reply(200, { user: ENABLED_USER }));

    submitCode('123456');

    await waitFor(() => {
      expect(callOrder).toEqual(['updateUser', 'registerPush']);
    });
    expect(mockReplaceSession).not.toHaveBeenCalled();
  });

  it.each([400, 401])('stays on the code step for INVALID_CODE with status %s', async (status) => {
    await reachCodeStep();
    mockedPost.mockResolvedValueOnce(reply(status, { code: 'INVALID_CODE', message: 'nope' }));

    submitCode('000000');

    await screen.findByText("That code isn't correct.");
    expect(screen.getByTestId('two-factor-enroll-code')).toBeTruthy();
    expect(mockReplaceSession).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('signs out when the rotated session cannot be stored', async () => {
    await reachCodeStep();
    mockReplaceSession.mockRejectedValue(new Error('keychain locked'));
    mockSignOut.mockResolvedValue(undefined);
    mockedPost.mockResolvedValueOnce(reply(200, { user: ENABLED_USER, session: ROTATED }));

    submitCode('123456');

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
