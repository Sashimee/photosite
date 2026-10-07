import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { store } from 'expo-router/build/global-state/router-store';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

const mockSignOut = jest.fn<() => Promise<void>>();
const mockUpdateUser = jest.fn();
const mockAuth = {
  current: {
    status: 'signed-in',
    user: { email: 'a@example.com', roles: ['client'] },
    signOut: mockSignOut,
    updateUser: mockUpdateUser,
  } as Record<string, unknown>,
};
jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => mockAuth.current,
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('../../src/lib/push', () => ({
  registerPushDevice: jest.fn(),
  unregisterPushDevice: jest.fn(),
}));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';
import { unregisterPushDevice } from '../../src/lib/push';

function signedIn(roles: string[]) {
  return {
    status: 'signed-in',
    user: { email: 'a@example.com', roles },
    signOut: mockSignOut,
    updateUser: mockUpdateUser,
  };
}

function reply(status: number, body?: unknown) {
  return {
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  } as never;
}

beforeEach(() => {
  mockUpdateUser.mockReset();
  jest.mocked(api.POST).mockReset();
  jest.mocked(api.GET).mockReset();
  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue(undefined);
  mockAuth.current = signedIn(['client']);
});

describe('account tab studio entry', () => {
  it('hides Studio from a client without the photographer role', async () => {
    renderRouter('./app', { initialUrl: '/account' });

    await waitFor(() => {
      expect(screen.getAllByText('Account').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('account-studio-entry')).toBeNull();
  });

  it('shows Studio for a photographer and opens it', async () => {
    mockAuth.current = signedIn(['client', 'photographer']);
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-studio-entry'));

    await waitFor(() => {
      expect(store.getRouteInfo().pathname).toBe('/studio');
    });
    await screen.findByTestId('studio-entry-portfolio');
  });

  it('refuses the studio route for a user without the role', async () => {
    renderRouter('./app', { initialUrl: '/studio' });

    await screen.findByTestId('studio-unavailable');
    expect(screen.queryByTestId('studio-entry-profile')).toBeNull();
  });
});

describe('account tab data and deletion', () => {
  it('shows export and deletion to a signed-in user', async () => {
    jest.mocked(api.GET).mockResolvedValue({
      data: [],
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    renderRouter('./app', { initialUrl: '/account' });

    expect(await screen.findByTestId('account-export')).toBeTruthy();
    expect(screen.getByTestId('account-deletion')).toBeTruthy();
  });

  it('hides export and deletion when signed out', async () => {
    mockAuth.current = { status: 'signed-out', user: null };
    renderRouter('./app', { initialUrl: '/account' });

    await screen.findByTestId('account-sign-in');
    expect(screen.queryByTestId('account-export')).toBeNull();
    expect(screen.queryByTestId('account-deletion')).toBeNull();
  });
});

describe('account tab profile and roles', () => {
  it('shows the email and roles', async () => {
    mockAuth.current = signedIn(['client', 'photographer']);
    renderRouter('./app', { initialUrl: '/account' });

    expect((await screen.findByTestId('account-email')).props.children).toBe(
      'Signed in as a@example.com',
    );
    expect(JSON.stringify(screen.getByTestId('account-roles').props.children)).toContain(
      'Client, Photographer',
    );
    expect(screen.queryByTestId('account-become-photographer')).toBeNull();
  });

  it('adds the photographer role and updates the auth context', async () => {
    const user = { email: 'a@example.com', roles: ['client', 'photographer'] };
    jest.mocked(api.POST).mockResolvedValue(reply(200, { user }));
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-become-photographer'));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith(user);
    });
    expect(api.POST).toHaveBeenCalledWith('/v1/auth/roles', { body: { role: 'photographer' } });
  });

  it('maps an already-assigned role to its message', async () => {
    jest.mocked(api.POST).mockResolvedValue(reply(409, { code: 'ROLE_ALREADY_ASSIGNED' }));
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-become-photographer'));

    expect(await screen.findByText('You already have this role.')).toBeTruthy();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('shows a generic error when the request throws', async () => {
    jest.mocked(api.POST).mockRejectedValue(new Error('offline'));
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-become-photographer'));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
  });
});

describe('account tab sign out', () => {
  it('delegates the whole sign-out sequence to the auth provider', async () => {
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-sign-out'));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
    expect(mockSignOut).toHaveBeenCalledWith({ remote: true });
    expect(api.POST).not.toHaveBeenCalled();
  });

  it('asks for confirmation before signing out everywhere', async () => {
    jest.mocked(api.POST).mockResolvedValue(reply(204));
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-sign-out-everywhere'));
    expect(api.POST).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('account-sign-out-everywhere-dismiss'));
    expect(api.POST).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('account-sign-out-everywhere')).toBeTruthy();
  });

  it('revokes every session then clears the local session once confirmed', async () => {
    jest.mocked(api.POST).mockResolvedValue(reply(204));
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-sign-out-everywhere'));
    fireEvent.press(screen.getByTestId('account-sign-out-everywhere-confirm'));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
    expect(api.POST).toHaveBeenCalledWith('/v1/auth/sessions/revoke-all');
    expect(jest.mocked(unregisterPushDevice).mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      jest.mocked(api.POST).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('clears the local session when revoke-all answers 401', async () => {
    jest.mocked(api.POST).mockResolvedValue(reply(401, { code: 'UNAUTHORIZED' }));
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-sign-out-everywhere'));
    fireEvent.press(screen.getByTestId('account-sign-out-everywhere-confirm'));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the session and shows an error when revoke-all fails', async () => {
    jest.mocked(api.POST).mockResolvedValue(reply(500, { code: 'INTERNAL' }));
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-sign-out-everywhere'));
    fireEvent.press(screen.getByTestId('account-sign-out-everywhere-confirm'));

    expect(await screen.findByTestId('account-sign-out-error')).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
