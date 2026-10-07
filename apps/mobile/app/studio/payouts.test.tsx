import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { roles: ['photographer'] } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

import '../../src/lib/i18n';
import * as WebBrowser from 'expo-web-browser';

import { api } from '../../src/lib/api';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);
const mockedOpen = jest.mocked(WebBrowser.openBrowserAsync);

const LINK_URL = 'https://connect.stripe.com/setup/e/acct_1P/abc123';

function ok(data: unknown, status = 200) {
  return Promise.resolve({ data, error: undefined, response: new Response(null, { status }) });
}

function failed(status: number, error: unknown = {}) {
  return Promise.resolve({ data: undefined, error, response: new Response(null, { status }) });
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    stripeOnboardingComplete: false,
    stripePayoutsEnabled: false,
    stripeAccountConnected: false,
    ...overrides,
  };
}

function mockProfiles(...responses: Promise<unknown>[]) {
  let call = 0;
  mockedGet.mockImplementation(((path: string) => {
    if (path !== '/v1/me/photographer-profile') {
      return failed(500);
    }
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return response;
  }) as never);
}

function mockStripe(link: () => Promise<unknown> = () => ok({ url: LINK_URL })) {
  mockedPost.mockImplementation(((path: string) =>
    path === '/v1/me/stripe/account'
      ? ok({ stripeAccountId: 'acct_1', onboardingComplete: false, payoutsEnabled: false })
      : link()) as never);
}

function open(url = '/studio/payouts') {
  renderRouter('./app', { initialUrl: url });
}

function profileReads() {
  return mockedGet.mock.calls.filter((call) => call[0] === '/v1/me/photographer-profile').length;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedOpen.mockResolvedValue({ type: 'cancel' } as never);
});

describe('payouts states', () => {
  it('shows not started with the setup button', async () => {
    mockProfiles(ok(profile()));
    open();

    await screen.findByTestId('payouts-panel');
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.getByText('Set up payouts')).toBeTruthy();
  });

  it.each([
    ['onboarding complete but payouts not enabled', { stripeOnboardingComplete: true }],
    ['an account that exists', { stripeAccountConnected: true }],
  ])('shows in review with continue for %s', async (_label, flags) => {
    mockProfiles(ok(profile(flags)));
    open();

    await screen.findByTestId('payouts-panel');
    expect(screen.getByText('In review')).toBeTruthy();
    expect(screen.getByText('Continue setup')).toBeTruthy();
    expect(screen.queryByText('Not started')).toBeNull();
  });

  it('shows enabled without a button', async () => {
    mockProfiles(
      ok(
        profile({
          stripeOnboardingComplete: true,
          stripePayoutsEnabled: true,
          stripeAccountConnected: true,
        }),
      ),
    );
    open();

    await screen.findByTestId('payouts-panel');
    expect(screen.getByText('Payouts enabled')).toBeTruthy();
    expect(screen.queryByTestId('payouts-start')).toBeNull();
  });

  it('shows loading, then a session message on 401', async () => {
    mockProfiles(failed(401));
    open();

    expect(screen.getByTestId('payouts-loading')).toBeTruthy();
    await screen.findByTestId('payouts-unauthorized');
  });

  it('shows an error that retries', async () => {
    mockProfiles(failed(500), ok(profile()));
    open();

    fireEvent.press(await screen.findByTestId('payouts-retry'));

    await screen.findByTestId('payouts-panel');
  });

  it('asks for a profile first and offers no button without one', async () => {
    mockProfiles(failed(404));
    open();

    await screen.findByTestId('payouts-needs-profile');
    expect(screen.queryByTestId('payouts-start')).toBeNull();
    expect(screen.getByTestId('payouts-create-profile')).toBeTruthy();
  });
});

describe('studio hub', () => {
  it('links to the payouts screen', async () => {
    mockProfiles(ok(profile()));
    open('/studio');

    fireEvent.press(await screen.findByTestId('studio-entry-payouts'));

    await screen.findByTestId('payouts-panel');
  });
});

describe('starting onboarding', () => {
  it('creates the account, then the link, then opens the browser', async () => {
    mockProfiles(ok(profile()));
    mockStripe();
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));

    await waitFor(() => {
      expect(mockedOpen).toHaveBeenCalledTimes(1);
    });
    expect(mockedPost.mock.calls.map((call) => call[0])).toEqual([
      '/v1/me/stripe/account',
      '/v1/me/stripe/account-link',
    ]);
    expect(mockedOpen).toHaveBeenCalledWith(LINK_URL);
  });

  it.each([
    ['an http url', { url: 'http://connect.stripe.com/x' }],
    ['a javascript url', { url: 'javascript:alert(1)' }],
    ['a relative url', { url: '/studio/payouts' }],
    ['a missing url', {}],
  ])('refuses %s without opening the browser', async (_label, data) => {
    mockProfiles(ok(profile()));
    mockStripe(() => ok(data));
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));

    expect(await screen.findByText('Something went wrong. Try again.')).toBeTruthy();
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('re-reads the profile when the browser closes and never claims success on its own', async () => {
    mockProfiles(ok(profile()), ok(profile({ stripeAccountConnected: true })));
    mockStripe();
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));

    await screen.findByTestId('payouts-returned');
    expect(profileReads()).toBe(2);
    expect(screen.getByText(/Verification can take a moment/)).toBeTruthy();
    expect(screen.queryByText('Payouts enabled')).toBeNull();
    expect(screen.getByText('In review')).toBeTruthy();
  });

  it('refreshes on demand and shows enabled only once the server flag says so', async () => {
    mockProfiles(
      ok(profile()),
      ok(profile({ stripeAccountConnected: true })),
      ok(profile({ stripeOnboardingComplete: true, stripePayoutsEnabled: true })),
    );
    mockStripe();
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));
    fireEvent.press(await screen.findByTestId('payouts-refresh'));

    await screen.findByText('Payouts enabled');
    expect(profileReads()).toBe(3);
    expect(screen.queryByTestId('payouts-refresh')).toBeNull();
    expect(screen.queryByTestId('payouts-returned')).toBeNull();
  });

  it('keeps the review state when the refresh still reports incomplete', async () => {
    mockProfiles(ok(profile()), ok(profile({ stripeAccountConnected: true })));
    mockStripe();
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));
    fireEvent.press(await screen.findByTestId('payouts-refresh'));

    await waitFor(() => {
      expect(profileReads()).toBe(3);
    });
    await screen.findByTestId('payouts-refresh');
    expect(screen.queryByText('Payouts enabled')).toBeNull();
  });

  it('ignores a second tap while the requests are pending', async () => {
    mockProfiles(ok(profile()));
    let resolveAccount: (value: unknown) => void = () => undefined;
    mockedPost.mockImplementation(((path: string) =>
      path === '/v1/me/stripe/account'
        ? new Promise((resolve) => {
            resolveAccount = resolve;
          })
        : ok({ url: LINK_URL })) as never);
    open();

    const button = await screen.findByTestId('payouts-start');
    fireEvent.press(button);
    fireEvent.press(button);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveAccount({
        data: { stripeAccountId: 'acct_1' },
        error: undefined,
        response: new Response(null, { status: 200 }),
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockedOpen).toHaveBeenCalledTimes(1);
    });
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['EMAIL_NOT_VERIFIED', 403, 'Verify your email address before setting up payouts.'],
    ['FORBIDDEN', 403, "You don't have access to payouts."],
    ['CONFLICT', 409, 'Payouts setup is not available right now. Try again later.'],
    ['TOO_MANY_REQUESTS', 429, "You're doing that too fast. Slow down and try again."],
  ])(
    'shows the %s error from the account call and does not open the browser',
    async (code, status, message) => {
      mockProfiles(ok(profile()));
      mockedPost.mockImplementation((() => failed(status, { code })) as never);
      open();

      fireEvent.press(await screen.findByTestId('payouts-start'));

      expect(await screen.findByText(message)).toBeTruthy();
      expect(mockedPost).toHaveBeenCalledTimes(1);
      expect(mockedOpen).not.toHaveBeenCalled();
    },
  );

  it('shows the retry delay on a rate limit', async () => {
    mockProfiles(ok(profile()));
    mockedPost.mockImplementation((() =>
      failed(429, { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 30 } })) as never);
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));

    expect(await screen.findByText(/Try again in 30 seconds/)).toBeTruthy();
  });

  it('shows the no-account conflict from the link call as an error state', async () => {
    mockProfiles(ok(profile({ stripeAccountConnected: true })));
    mockStripe(() => failed(409, {}));
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));

    expect(
      await screen.findByText('Payouts setup is not available right now. Try again later.'),
    ).toBeTruthy();
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('shows the generic error when a request throws and allows a retry', async () => {
    mockProfiles(ok(profile()));
    mockedPost.mockRejectedValueOnce(new Error('network'));
    mockStripe();
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));
    await screen.findByTestId('payouts-error');
    fireEvent.press(screen.getByTestId('payouts-start'));

    await waitFor(() => {
      expect(mockedOpen).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId('payouts-error')).toBeNull();
  });

  it('shows the generic error when the browser cannot open', async () => {
    mockProfiles(ok(profile()));
    mockStripe();
    mockedOpen.mockRejectedValue(new Error('no browser'));
    open();

    fireEvent.press(await screen.findByTestId('payouts-start'));

    await screen.findByTestId('payouts-error');
    expect(profileReads()).toBe(1);
  });
});
