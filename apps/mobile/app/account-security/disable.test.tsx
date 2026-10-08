import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

const mockUpdateUser = jest.fn<(user: unknown) => void>();
jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    status: 'signed-in',
    user: { email: 'a@example.com', roles: ['client'], twoFactorEnabled: true },
    updateUser: mockUpdateUser,
  }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';

const mockedPost = jest.mocked(api.POST);

function reply(status: number, body: unknown) {
  return {
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  } as never;
}

async function submit(code: string, password: string) {
  renderRouter('./app', { initialUrl: '/account-security/disable' });
  fireEvent.changeText(await screen.findByTestId('two-factor-disable-code'), code);
  fireEvent.changeText(screen.getByTestId('two-factor-disable-password'), password);
  fireEvent.press(screen.getByTestId('two-factor-disable-submit'));
}

beforeEach(() => {
  mockedPost.mockReset();
  mockUpdateUser.mockReset();
});

describe('disable two-factor screen', () => {
  it('posts the code and password and updates the user', async () => {
    const user = { email: 'a@example.com', roles: ['client'], twoFactorEnabled: false };
    mockedPost.mockResolvedValueOnce(reply(200, { user }));

    await submit('123456', 'hunter2hunter2');

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith(user);
    });
    expect(mockedPost).toHaveBeenCalledWith('/v1/auth/totp/disable', {
      body: { code: '123456', password: 'hunter2hunter2' },
    });
  });

  it('surfaces a wrong password without updating the user', async () => {
    mockedPost.mockResolvedValueOnce(reply(400, { code: 'INVALID_PASSWORD', message: 'bad' }));

    await submit('123456', 'wrongwrong');

    await screen.findByText("That password isn't correct.");
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('surfaces a wrong code without updating the user', async () => {
    mockedPost.mockResolvedValueOnce(reply(401, { code: 'INVALID_CODE', message: 'nope' }));

    await submit('000000', 'hunter2hunter2');

    await screen.findByText("That code isn't correct.");
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('does not post a malformed code', async () => {
    await submit('12', 'hunter2hunter2');

    await waitFor(() => {
      expect(screen.getByTestId('two-factor-disable-code')).toBeTruthy();
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
