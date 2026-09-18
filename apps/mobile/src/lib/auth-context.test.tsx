import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

jest.mock('./api', () => ({
  api: { GET: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';

import { api, setUnauthorizedListener } from './api';
import { AuthProvider, useAuth } from './auth-context';

const mockedSecureStore = jest.mocked(SecureStore);
const mockedGet = jest.mocked(api.GET);
const mockedSetUnauthorizedListener = jest.mocked(setUnauthorizedListener);

const TOKEN_KEY = 'photoo.session.token';
const EXPIRES_AT_KEY = 'photoo.session.expiresAt';

const user = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'client@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
};

function Probe() {
  const { status } = useAuth();
  return <Text>{`status:${status}`}</Text>;
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

function currentUnauthorizedListener(): () => void {
  const call = mockedSetUnauthorizedListener.mock.calls.at(-1);
  const listener = call?.[0];
  if (!listener) {
    throw new Error('AuthProvider never registered an unauthorized listener');
  }
  return listener;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedSecureStore.getItemAsync.mockResolvedValue(null);
  });

  it('starts as signed-out with no stored session and never calls the API', async () => {
    renderProbe();

    await waitFor(() => screen.getByText('status:signed-out'));
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('restores a valid stored session by confirming it against GET /v1/auth/session', async () => {
    mockedSecureStore.getItemAsync.mockImplementation((key: string) => {
      if (key === TOKEN_KEY) return Promise.resolve('token-abc');
      if (key === EXPIRES_AT_KEY)
        return Promise.resolve(new Date(Date.now() + 60_000).toISOString());
      return Promise.resolve(null);
    });
    mockedGet.mockResolvedValue({
      data: { user },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });

    renderProbe();

    await waitFor(() => screen.getByText('status:signed-in'));
    expect(mockedGet).toHaveBeenCalledWith('/v1/auth/session');
  });

  it('treats an expired expiresAt as signed out without making a request', async () => {
    mockedSecureStore.getItemAsync.mockImplementation((key: string) => {
      if (key === TOKEN_KEY) return Promise.resolve('token-abc');
      if (key === EXPIRES_AT_KEY) return Promise.resolve(new Date(Date.now() - 1000).toISOString());
      return Promise.resolve(null);
    });

    renderProbe();

    await waitFor(() => screen.getByText('status:signed-out'));
    expect(mockedGet).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, expect.anything());
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(EXPIRES_AT_KEY, expect.anything());
  });

  it('registers a single unauthorized listener that clears the stored session', async () => {
    mockedGet.mockResolvedValue({
      data: undefined,
      error: { code: 'UNAUTHORIZED', message: 'nope', requestId: user.id },
      response: new Response(null, { status: 401 }),
    });

    renderProbe();

    await waitFor(() => screen.getByText('status:signed-out'));
    expect(mockedSetUnauthorizedListener).toHaveBeenCalled();

    act(() => {
      currentUnauthorizedListener()();
    });

    await waitFor(() => {
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, expect.anything());
    });
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(EXPIRES_AT_KEY, expect.anything());
    // The token never lands anywhere but expo-secure-store: no other global
    // storage API exists in this app to assert against.
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('keeps the stored session on a non-401 failure instead of a destructive clear', async () => {
    mockedSecureStore.getItemAsync.mockImplementation((key: string) => {
      if (key === TOKEN_KEY) return Promise.resolve('token-abc');
      if (key === EXPIRES_AT_KEY)
        return Promise.resolve(new Date(Date.now() + 60_000).toISOString());
      return Promise.resolve(null);
    });
    mockedGet.mockResolvedValue({
      data: undefined,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'oops', requestId: user.id },
      response: new Response(null, { status: 500 }),
    });

    renderProbe();

    await waitFor(() => screen.getByText('status:signed-out'));
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('signIn persists the session to secure storage only', async () => {
    let signIn: ((...args: never[]) => unknown) | undefined;
    function Capture() {
      const auth = useAuth();
      signIn = auth.signIn;
      return <Text>{`status:${auth.status}`}</Text>;
    }
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByText('status:signed-out'));

    type SignIn = (
      nextUser: typeof user,
      session: { token: string; expiresAt: string },
    ) => Promise<void>;

    await act(async () => {
      await (signIn as SignIn)(user, {
        token: 'token-xyz',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    });

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      TOKEN_KEY,
      'token-xyz',
      expect.anything(),
    );
    await waitFor(() => screen.getByText('status:signed-in'));
  });
});
