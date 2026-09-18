import { describe, expect, it, jest } from '@jest/globals';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

const TOKEN_KEY = 'photoo.session.token';
const EXPIRES_AT_KEY = 'photoo.session.expiresAt';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => {
    if (key === TOKEN_KEY) return Promise.resolve('token-abc');
    if (key === EXPIRES_AT_KEY) {
      return Promise.resolve(new Date(Date.now() + 60_000).toISOString());
    }
    return Promise.resolve(null);
  }),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

jest.mock('../../src/lib/api', () => ({
  api: {
    GET: jest.fn((path: string) => {
      if (path === '/v1/photographers') {
        return Promise.resolve({
          data: { items: [], nextCursor: null },
          error: undefined,
          response: new Response(null, { status: 200 }),
        });
      }
      return Promise.resolve({
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
        response: new Response(null, { status: 200 }),
      });
    }),
    POST: jest.fn(),
  },
  setUnauthorizedListener: jest.fn(),
}));

describe('auth screens while signed in', () => {
  it('redirects away from sign-in to the tabs', async () => {
    renderRouter('./app', { initialUrl: '/sign-in' });

    await waitFor(() => {
      expect(screen.getAllByText('Discover').length).toBeGreaterThan(0);
    });
  });
});
