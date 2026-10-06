import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const apiPostMock = vi.fn();

vi.mock('@/lib/api', () => ({ api: { POST: apiPostMock } }));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  const cache = new Map<string, ReturnType<typeof mockUseTranslations>>();
  return {
    useTranslations: (namespace: string) => {
      const cached = cache.get(namespace);
      if (cached) {
        return cached;
      }
      const translator = mockUseTranslations(namespace);
      cache.set(namespace, translator);
      return translator;
    },
  };
});

const NAMESPACE = 'web.dashboard.payouts';
const LINK_URL = 'https://connect.stripe.com/setup/e/acct_1P/abc123';
const originalLocation = window.location;

function stubLocationAssign() {
  const assign = vi.fn();
  const location = Object.create(originalLocation) as Location;
  Object.defineProperty(location, 'assign', { configurable: true, value: assign });
  Object.defineProperty(window, 'location', { configurable: true, value: location });
  return assign;
}

async function loadButton() {
  const { PayoutsButton } = await import('./payouts-button');
  return PayoutsButton;
}

describe('PayoutsButton', () => {
  afterEach(() => {
    apiPostMock.mockReset();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('offers to set up payouts when onboarding has not started', async () => {
    const PayoutsButton = await loadButton();
    render(<PayoutsButton resume={false} />);
    expect(
      screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }),
    ).toBeInTheDocument();
  });

  it('offers to continue setup when resuming', async () => {
    const PayoutsButton = await loadButton();
    render(<PayoutsButton resume />);
    expect(
      screen.getByRole('button', { name: translate(NAMESPACE, 'continueCta') }),
    ).toBeInTheDocument();
  });

  it('creates the account, then the link, then navigates to the link url', async () => {
    const calls: string[] = [];
    apiPostMock.mockImplementation((url: string) => {
      calls.push(url);
      return Promise.resolve(
        url === '/v1/me/stripe/account'
          ? {
              data: {
                stripeAccountId: 'acct_1',
                onboardingComplete: false,
                payoutsEnabled: false,
              },
              error: undefined,
            }
          : { data: { url: LINK_URL }, error: undefined },
      );
    });
    const assign = stubLocationAssign();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume={false} />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));

    expect(calls).toEqual(['/v1/me/stripe/account', '/v1/me/stripe/account-link']);
    expect(assign).toHaveBeenCalledExactlyOnceWith(LINK_URL);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN', 'errors.forbidden'],
    ['EMAIL_NOT_VERIFIED', 'errors.emailNotVerified'],
    ['CONFLICT', 'errors.conflict'],
    ['TOO_MANY_REQUESTS', 'errors.tooManyRequests'],
  ])('shows the %s error from the account call and does not navigate', async (code, key) => {
    apiPostMock.mockResolvedValue({ data: undefined, error: { code } });
    const assign = stubLocationAssign();
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume={false} />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));

    expect(await screen.findByText(translate(NAMESPACE, key))).toBeInTheDocument();
    expect(apiPostMock).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows the retry delay on a rate limit', async () => {
    apiPostMock.mockResolvedValue({
      data: undefined,
      error: { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 30 } },
    });
    stubLocationAssign();
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume={false} />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));

    expect(
      await screen.findByText(
        translate(NAMESPACE, 'errors.tooManyRequestsWithRetry', { seconds: 30 }),
      ),
    ).toBeInTheDocument();
  });

  it('shows the error from the link call and does not navigate', async () => {
    apiPostMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/v1/me/stripe/account'
          ? { data: { stripeAccountId: 'acct_1' }, error: undefined }
          : { data: undefined, error: { code: 'CONFLICT' } },
      ),
    );
    const assign = stubLocationAssign();
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'continueCta') }));

    expect(await screen.findByText(translate(NAMESPACE, 'errors.conflict'))).toBeInTheDocument();
    expect(apiPostMock).toHaveBeenCalledTimes(2);
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows the generic error when the request throws', async () => {
    apiPostMock.mockRejectedValue(new Error('network'));
    const assign = stubLocationAssign();
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume={false} />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));

    expect(await screen.findByText(translate(NAMESPACE, 'errors.generic'))).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
  it('disables the button and ignores a second click while the requests are pending', async () => {
    let resolveAccount: (value: unknown) => void = () => undefined;
    apiPostMock.mockImplementation((url: string) =>
      url === '/v1/me/stripe/account'
        ? new Promise((resolve) => {
            resolveAccount = resolve;
          })
        : Promise.resolve({ data: { url: LINK_URL }, error: undefined }),
    );
    const assign = stubLocationAssign();
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume={false} />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));
    const button = screen.getByRole('button', { name: translate(NAMESPACE, 'pending') });
    await user.click(button);

    expect(button).toBeDisabled();
    expect(apiPostMock).toHaveBeenCalledTimes(1);

    resolveAccount({ data: { stripeAccountId: 'acct_1' }, error: undefined });
    await waitFor(() => {
      expect(assign).toHaveBeenCalledExactlyOnceWith(LINK_URL);
    });
    expect(apiPostMock).toHaveBeenCalledTimes(2);
  });

  it('re-enables the button after an error so the user can retry', async () => {
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'CONFLICT' } });
    stubLocationAssign();
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume={false} />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));

    await screen.findByText(translate(NAMESPACE, 'errors.conflict'));
    expect(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') })).toBeEnabled();
  });

  it('clears the previous error when retrying', async () => {
    apiPostMock.mockResolvedValueOnce({ data: undefined, error: { code: 'CONFLICT' } });
    apiPostMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/v1/me/stripe/account'
          ? { data: { stripeAccountId: 'acct_1' }, error: undefined }
          : { data: { url: LINK_URL }, error: undefined },
      ),
    );
    const assign = stubLocationAssign();
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume={false} />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));
    await screen.findByText(translate(NAMESPACE, 'errors.conflict'));
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledExactlyOnceWith(LINK_URL);
    });
    expect(screen.queryByText(translate(NAMESPACE, 'errors.conflict'))).not.toBeInTheDocument();
  });

  it.each([
    ['a missing url', {}],
    ['an empty url', { url: '' }],
    ['a non-string url', { url: 42 }],
    ['a javascript: url', { url: 'javascript:alert(1)' }],
    ['a relative url', { url: '/dashboard' }],
  ])('does not navigate and shows an error for %s', async (_label, data) => {
    apiPostMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/v1/me/stripe/account'
          ? { data: { stripeAccountId: 'acct_1' }, error: undefined }
          : { data, error: undefined },
      ),
    );
    const assign = stubLocationAssign();
    const PayoutsButton = await loadButton();
    const user = userEvent.setup();

    render(<PayoutsButton resume={false} />);
    await user.click(screen.getByRole('button', { name: translate(NAMESPACE, 'setupCta') }));

    expect(await screen.findByText(translate(NAMESPACE, 'errors.generic'))).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
