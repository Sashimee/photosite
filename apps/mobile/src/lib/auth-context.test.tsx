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
  api: { GET: jest.fn(), POST: jest.fn(), DELETE: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

jest.mock('./chat-socket', () => ({ resetChatSocket: jest.fn() }));

import * as SecureStore from 'expo-secure-store';

import * as Sentry from '@sentry/react-native';

import { api, setUnauthorizedListener } from './api';
import { resetChatSocket } from './chat-socket';
import { AuthProvider, useAuth, type AuthContextValue, type SessionUser } from './auth-context';

const mockedSecureStore = jest.mocked(SecureStore);
const mockedGet = jest.mocked(api.GET);
const mockedDelete = jest.mocked(api.DELETE);
const mockedPost = jest.mocked(api.POST);
const mockedSetUnauthorizedListener = jest.mocked(setUnauthorizedListener);

const TOKEN_KEY = 'photoo.session.token';
const EXPIRES_AT_KEY = 'photoo.session.expiresAt';
const DEVICE_ID_KEY = 'photoo.push.deviceId';

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

const sessionUser: SessionUser = {
  ...user,
  locale: 'en',
  roles: ['client'],
  status: 'active',
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

  it('resolves to signed-out and clears the stored session when reading it throws', async () => {
    const failure = new Error('keystore unavailable');
    mockedSecureStore.getItemAsync.mockRejectedValue(failure);
    mockedSecureStore.deleteItemAsync.mockResolvedValue(undefined);

    renderProbe();

    await waitFor(() => screen.getByText('status:signed-out'));
    expect(mockedGet).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, expect.anything());
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(EXPIRES_AT_KEY, expect.anything());
    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
  });

  it('still resolves to signed-out when clearing after a failed read also throws', async () => {
    mockedSecureStore.getItemAsync.mockRejectedValue(new Error('keystore unavailable'));
    const clearFailure = new Error('delete failed');
    mockedSecureStore.deleteItemAsync.mockRejectedValue(clearFailure);

    renderProbe();

    await waitFor(() => screen.getByText('status:signed-out'));
    expect(Sentry.captureException).toHaveBeenCalledWith(clearFailure);
  });

  it('resolves to signed-out and keeps the token when the session request throws', async () => {
    mockedSecureStore.getItemAsync.mockImplementation((key: string) => {
      if (key === TOKEN_KEY) return Promise.resolve('token-abc');
      if (key === EXPIRES_AT_KEY)
        return Promise.resolve(new Date(Date.now() + 60_000).toISOString());
      return Promise.resolve(null);
    });
    const failure = new TypeError('Network request failed');
    mockedGet.mockRejectedValue(failure);

    renderProbe();

    await waitFor(() => screen.getByText('status:signed-out'));
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
  });

  it('does not update state after unmount when the restore throws', async () => {
    let rejectRead: (reason: Error) => void = () => undefined;
    mockedSecureStore.getItemAsync.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRead = reject;
      }),
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const view = renderProbe();
    view.unmount();
    await act(async () => {
      rejectRead(new Error('late failure'));
      await Promise.resolve();
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('checkSession reports false for an anonymous 200 response', async () => {
    mockedGet.mockResolvedValue({
      data: { user: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    let checkSession: (() => Promise<boolean>) | undefined;
    function Capture() {
      const auth = useAuth();
      checkSession = auth.checkSession;
      return <Text>{`status:${auth.status}`}</Text>;
    }

    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByText('status:signed-out'));

    let result: boolean | undefined;
    await act(async () => {
      result = await (checkSession as () => Promise<boolean>)();
    });

    expect(result).toBe(false);
    await waitFor(() => screen.getByText('status:signed-out'));
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
  it('updateUser replaces the session user without touching the status', async () => {
    let updateUser: AuthContextValue['updateUser'] | undefined;
    function Capture() {
      const auth = useAuth();
      updateUser = auth.updateUser;
      return <Text>{`${auth.status}:${auth.user?.roles.join(',') ?? 'none'}`}</Text>;
    }
    mockedSecureStore.getItemAsync.mockImplementation((key: string) =>
      Promise.resolve(
        key === TOKEN_KEY
          ? 'token-abc'
          : key === EXPIRES_AT_KEY
            ? new Date(Date.now() + 60_000).toISOString()
            : null,
      ),
    );
    mockedGet.mockResolvedValue({
      data: { user: sessionUser },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );
    await waitFor(() => screen.getByText('signed-in:client'));

    act(() => {
      updateUser?.({
        ...sessionUser,
        roles: ['client', 'photographer'],
      });
    });

    expect(screen.getByText('signed-in:client,photographer')).toBeTruthy();
  });

  describe('push device unregistration', () => {
    let signOut: (options?: { remote?: boolean }) => Promise<void>;

    function Capture() {
      signOut = useAuth().signOut;
      return null;
    }

    function storeSignedInSession() {
      mockedSecureStore.getItemAsync.mockImplementation((key: string) => {
        if (key === TOKEN_KEY) return Promise.resolve('token-abc');
        if (key === EXPIRES_AT_KEY)
          return Promise.resolve(new Date(Date.now() + 60_000).toISOString());
        if (key === DEVICE_ID_KEY) return Promise.resolve('device-1');
        return Promise.resolve(null);
      });
      mockedGet.mockResolvedValue({
        data: { user },
        error: undefined,
        response: new Response(null, { status: 200 }),
      });
      mockedSecureStore.deleteItemAsync.mockResolvedValue();
    }

    function renderCapture() {
      return render(
        <AuthProvider>
          <Probe />
          <Capture />
        </AuthProvider>,
      );
    }

    it('deletes the device before clearing the session, and resets the chat socket', async () => {
      storeSignedInSession();
      mockedDelete.mockResolvedValue({ response: new Response(null, { status: 204 }) });
      renderCapture();
      await waitFor(() => screen.getByText('status:signed-in'));

      await act(async () => {
        await signOut();
      });

      expect(mockedDelete).toHaveBeenCalledWith('/v1/me/devices/{id}', {
        params: { path: { id: 'device-1' } },
        signal: expect.anything(),
      });
      const deleteOrder = mockedDelete.mock.invocationCallOrder[0] ?? 0;
      const clearOrder =
        mockedSecureStore.deleteItemAsync.mock.invocationCallOrder[
          mockedSecureStore.deleteItemAsync.mock.calls.findIndex(([key]) => key === TOKEN_KEY)
        ] ?? 0;
      expect(deleteOrder).toBeLessThan(clearOrder);
      expect(resetChatSocket).toHaveBeenCalledTimes(1);
      screen.getByText('status:signed-out');
    });

    it('unregisters the device before ending the server session on a remote sign-out', async () => {
      storeSignedInSession();
      mockedDelete.mockResolvedValue({ response: new Response(null, { status: 204 }) });
      mockedPost.mockResolvedValue({ response: new Response(null, { status: 204 }) });
      renderCapture();
      await waitFor(() => screen.getByText('status:signed-in'));

      await act(async () => {
        await signOut({ remote: true });
      });

      expect(mockedDelete).toHaveBeenCalledWith('/v1/me/devices/{id}', {
        params: { path: { id: 'device-1' } },
        signal: expect.anything(),
      });
      expect(mockedPost).toHaveBeenCalledWith('/v1/auth/sign-out');
      expect(mockedDelete.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
        mockedPost.mock.invocationCallOrder[0] ?? 0,
      );
      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, expect.anything());
      screen.getByText('status:signed-out');
    });

    it('still clears the session when the remote sign-out call cannot reach the API', async () => {
      storeSignedInSession();
      mockedDelete.mockResolvedValue({ response: new Response(null, { status: 204 }) });
      mockedPost.mockRejectedValue(new Error('offline'));
      renderCapture();
      await waitFor(() => screen.getByText('status:signed-in'));

      await act(async () => {
        await signOut({ remote: true });
      });

      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, expect.anything());
      screen.getByText('status:signed-out');
    });

    it('does not call POST /v1/auth/sign-out on a local sign-out', async () => {
      storeSignedInSession();
      mockedDelete.mockResolvedValue({ response: new Response(null, { status: 204 }) });
      renderCapture();
      await waitFor(() => screen.getByText('status:signed-in'));

      await act(async () => {
        await signOut();
      });

      expect(mockedPost).not.toHaveBeenCalled();
    });

    it('still clears the session and reports the failure when the DELETE rejects', async () => {
      storeSignedInSession();
      mockedDelete.mockRejectedValue(new Error('network down'));
      renderCapture();
      await waitFor(() => screen.getByText('status:signed-in'));

      await act(async () => {
        await signOut();
      });

      expect(mockedSecureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, expect.anything());
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      screen.getByText('status:signed-out');
    });

    it('reports a non-2xx DELETE and still signs out', async () => {
      storeSignedInSession();
      mockedDelete.mockResolvedValue({ response: new Response(null, { status: 500 }) });
      renderCapture();
      await waitFor(() => screen.getByText('status:signed-in'));

      await act(async () => {
        await signOut();
      });

      expect(Sentry.captureMessage).toHaveBeenCalledWith(expect.stringContaining('500'), 'warning');
      screen.getByText('status:signed-out');
    });

    it('unregisters on the remote-revocation path too, once', async () => {
      storeSignedInSession();
      mockedDelete.mockResolvedValue({ response: new Response(null, { status: 401 }) });
      renderCapture();
      await waitFor(() => screen.getByText('status:signed-in'));

      act(() => {
        currentUnauthorizedListener()();
        currentUnauthorizedListener()();
      });

      await waitFor(() => screen.getByText('status:signed-out'));
      expect(mockedDelete).toHaveBeenCalledTimes(1);
      expect(resetChatSocket).toHaveBeenCalledTimes(1);
    });

    it('does not call the API when no device was registered', async () => {
      storeSignedInSession();
      mockedSecureStore.getItemAsync.mockImplementation((key: string) =>
        Promise.resolve(
          key === TOKEN_KEY
            ? 'token-abc'
            : key === EXPIRES_AT_KEY
              ? new Date(Date.now() + 60_000).toISOString()
              : null,
        ),
      );
      renderCapture();
      await waitFor(() => screen.getByText('status:signed-in'));

      await act(async () => {
        await signOut();
      });

      expect(mockedDelete).not.toHaveBeenCalled();
    });
  });
});
