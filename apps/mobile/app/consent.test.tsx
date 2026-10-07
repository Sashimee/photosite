import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

const mockDevice = {
  current: {
    policyVersion: null,
    decidedAt: '2026-10-01T10:00:00.000Z',
    categories: { analytics: false, adsMarketing: false },
  } as object,
};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(key === 'photoo.consent.decision' ? JSON.stringify(mockDevice.current) : null),
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
import * as SecureStore from 'expo-secure-store';

const mockedGet = jest.mocked(api.GET);
const mockedPut = jest.mocked(api.PUT);
const mockedPost = jest.mocked(api.POST);

const entry = (purpose: string, granted: boolean) => ({
  purpose,
  granted,
  policyVersion: '1',
  recordedAt: '2026-10-07T10:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDevice.current = {
    policyVersion: null,
    decidedAt: '2026-10-01T10:00:00.000Z',
    categories: { analytics: false, adsMarketing: false },
  };
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
  it('shows the device decision that governs this device, not the server state', async () => {
    mockDevice.current = {
      policyVersion: null,
      decidedAt: '2026-10-01T10:00:00.000Z',
      categories: { analytics: true, adsMarketing: false },
    };
    mockedGet.mockImplementation((() =>
      Promise.resolve({
        data: {
          consents: [entry('analytics', false), entry('ads', true), entry('marketing', true)],
        },
        error: undefined,
        response: new Response(null, { status: 200 }),
      })) as never);
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

  it('lets a signed-out user reach the screen from the account tab and withdraw', async () => {
    mockAuth.current = { status: 'signed-out', user: null };
    mockDevice.current = {
      policyVersion: null,
      decidedAt: '2026-10-01T10:00:00.000Z',
      categories: { analytics: true, adsMarketing: true },
    };
    mockedPost.mockResolvedValue({
      data: {},
      error: undefined,
      response: new Response(null, { status: 201 }),
    });
    renderRouter('./app', { initialUrl: '/account' });

    fireEvent.press(await screen.findByTestId('account-consent-entry'));
    await screen.findByTestId('consent-analytics');
    expect(screen.getByTestId('consent-analytics')).toBeChecked();
    fireEvent.press(screen.getByTestId('consent-decline-all'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(3);
    });
    expect(mockedPut).not.toHaveBeenCalled();
    const stored = jest
      .mocked(SecureStore.setItemAsync)
      .mock.calls.find(([key]) => key === 'photoo.consent.decision');
    const savedDecision = JSON.parse(String(stored?.[1])) as { categories: object };
    expect(savedDecision.categories).toEqual({
      analytics: false,
      adsMarketing: false,
    });
    await screen.findByText('Your choices are saved.');
  });
});
