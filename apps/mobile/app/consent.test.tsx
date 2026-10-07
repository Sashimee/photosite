import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(
      key === 'photoo.consent.decision'
        ? JSON.stringify({
            policyVersion: null,
            decidedAt: '2026-10-01T10:00:00.000Z',
            categories: { analytics: false, adsMarketing: false },
          })
        : null,
    ),
  ),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 5,
}));

const mockAuth = { current: { status: 'signed-in', user: { id: 'u1', roles: ['client'] } } };
jest.mock('../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => mockAuth.current,
}));

jest.mock('../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn(), PUT: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../src/lib/i18n';

import { api } from '../src/lib/api';

const mockedGet = jest.mocked(api.GET);
const mockedPut = jest.mocked(api.PUT);

const entry = (purpose: string, granted: boolean) => ({
  purpose,
  granted,
  policyVersion: '1',
  recordedAt: '2026-10-07T10:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.current = { status: 'signed-in', user: { id: 'u1', roles: ['client'] } };
  mockedGet.mockImplementation(((path: string) => {
    if (path === '/v1/me/consents') {
      return Promise.resolve({
        data: {
          consents: [entry('analytics', true), entry('ads', true), entry('marketing', false)],
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      });
    }
    return Promise.resolve({
      data: { policyVersion: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
  }) as never);
  mockedPut.mockResolvedValue({
    data: { consents: [] },
    error: undefined,
    response: new Response(null, { status: 200 }),
  } as never);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('consent settings screen', () => {
  it('shows the server state per category, treating ads and marketing as one toggle only when both are granted', async () => {
    renderRouter('./app', { initialUrl: '/consent' });

    await screen.findByTestId('consent-analytics');
    expect(screen.getByTestId('consent-analytics')).toBeChecked();
    expect(screen.getByTestId('consent-ads-marketing')).not.toBeChecked();
  });

  it('saves changed choices through PUT /v1/me/consents', async () => {
    renderRouter('./app', { initialUrl: '/consent' });

    await screen.findByTestId('consent-analytics');
    fireEvent.press(screen.getByTestId('consent-decline-all'));

    await waitFor(() => {
      expect(mockedPut).toHaveBeenCalledWith('/v1/me/consents', {
        body: {
          consents: [
            { purpose: 'analytics', granted: false },
            { purpose: 'ads', granted: false },
            { purpose: 'marketing', granted: false },
          ],
        },
      });
    });
    await screen.findByText('Your choices are saved.');
  });

  it('is reachable from the account tab', async () => {
    renderRouter('./app', { initialUrl: '/account' });

    expect(await screen.findByTestId('account-consent-entry')).toBeTruthy();
  });
});
