import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { store } from 'expo-router/build/global-state/router-store';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

const mockAuth = { current: { status: 'signed-in', user: { roles: ['client'] } } };
jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => mockAuth.current,
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../src/lib/i18n';

beforeEach(() => {
  mockAuth.current = { status: 'signed-in', user: { roles: ['client'] } };
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
    mockAuth.current = { status: 'signed-in', user: { roles: ['client', 'photographer'] } };
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
