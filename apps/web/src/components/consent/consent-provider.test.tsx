import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDecision, CONSENT_COOKIE_NAME, encodeConsentCookieValue } from '@/lib/consent';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadComponents() {
  const { ConsentProvider } = await import('./consent-provider');
  const { ConsentBanner } = await import('./consent-banner');
  const { ConsentDialog } = await import('./consent-dialog');
  return { ConsentProvider, ConsentBanner, ConsentDialog };
}

function clearAllCookies() {
  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function stubFetch({ consentStatus = 201 }: { consentStatus?: number } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes('/v1/auth/session')) {
      return new Response(null, { status: 401 });
    }
    if (url.includes('/v1/me/consents')) {
      return new Response(JSON.stringify({ consents: [] }), { status: 200 });
    }
    if (url.includes('/v1/consents')) {
      if (consentStatus >= 400) {
        return new Response(JSON.stringify({ code: 'INTERNAL' }), { status: consentStatus });
      }
      return new Response(
        JSON.stringify({
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          purpose: 'analytics',
          granted: true,
          policyVersion: '1',
          recordedAt: new Date().toISOString(),
        }),
        { status: 201 },
      );
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubFetchWithConsentFailure(failingPurpose: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes('/v1/auth/session')) {
      return new Response(null, { status: 401 });
    }
    if (url.includes('/v1/consents')) {
      const body = (await (input as Request).clone().json()) as { purpose: string };
      if (body.purpose === failingPurpose) {
        return new Response(JSON.stringify({ code: 'INTERNAL' }), { status: 500 });
      }
      return new Response(
        JSON.stringify({
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          purpose: body.purpose,
          granted: true,
          policyVersion: '1',
          recordedAt: new Date().toISOString(),
        }),
        { status: 201 },
      );
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ConsentProvider, ConsentBanner and ConsentDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    clearAllCookies();
  });

  it('sets no cookie before a choice, and exactly the consent cookie once one is made', async () => {
    stubFetch();
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );

    expect(document.cookie).toBe('');

    await screen.findByRole('button', { name: 'Accept all' });
    expect(document.cookie).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'Accept all' }));

    await waitFor(() => {
      expect(document.cookie).not.toBe('');
    });
    const cookies = document.cookie.split('; ');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.startsWith(`${CONSENT_COOKIE_NAME}=`)).toBe(true);
  });

  it('presents accept, reject and manage at the same level, none disabled or hidden', async () => {
    stubFetch();
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );

    const acceptButton = await screen.findByRole('button', { name: 'Accept all' });
    const rejectButton = screen.getByRole('button', { name: 'Reject all' });
    const manageButton = screen.getByRole('button', { name: 'Manage preferences' });

    for (const button of [acceptButton, rejectButton, manageButton]) {
      expect(button).toBeVisible();
      expect(button).toBeEnabled();
    }
    expect(rejectButton.parentElement).toBe(acceptButton.parentElement);
    expect(manageButton.parentElement).toBe(acceptButton.parentElement);
  });

  it('records a refusal and keeps analytics/ads-marketing denied, with no tag load', async () => {
    const fetchMock = stubFetch();
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Reject all' }));

    await waitFor(() => {
      const consentCalls = fetchMock.mock.calls.filter(([input]) =>
        requestUrl(input).includes('/v1/consents'),
      );
      expect(consentCalls).toHaveLength(3);
    });

    const decisionCookie = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${CONSENT_COOKIE_NAME}=`));
    expect(decisionCookie).toBeDefined();

    expect(document.querySelectorAll('script[src]')).toHaveLength(0);
  });

  it('records every purpose of one anonymous decision under the same anonymousId', async () => {
    const fetchMock = stubFetch();
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Reject all' }));

    const consentCalls = await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([input]) =>
        requestUrl(input).includes('/v1/consents'),
      );
      expect(calls).toHaveLength(3);
      return calls;
    });

    const bodies = await Promise.all(
      consentCalls.map(async ([input]) => {
        const request = input as Request;
        return (await request.clone().json()) as { anonymousId: string; purpose: string };
      }),
    );

    const anonymousIds = new Set(bodies.map((body) => body.anonymousId));
    expect(anonymousIds.size).toBe(1);
    expect(bodies.map((body) => body.purpose).sort()).toEqual(['ads', 'analytics', 'marketing']);
  });

  it('reports exactly which purposes recorded and which did not on a partial write', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetchWithConsentFailure('ads');
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Reject all' }));

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
    const partialWriteCall = consoleErrorSpy.mock.calls.find(
      ([message]) => typeof message === 'string' && message.includes('not recorded'),
    );
    expect(partialWriteCall?.[0]).toContain('recorded [analytics, marketing]');
    expect(partialWriteCall?.[0]).toContain('not recorded [ads]');

    const decisionCookie = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${CONSENT_COOKIE_NAME}=`));
    expect(decisionCookie).toBeDefined();

    consoleErrorSpy.mockRestore();
  });

  it('does not re-prompt a refusal on the next page view', async () => {
    stubFetch();
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    const first = render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Reject all' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reject all' })).not.toBeInTheDocument();
    });
    first.unmount();

    render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reject all' })).not.toBeInTheDocument();
    });
  });

  it('re-prompts once the published policy version is newer than the stored decision', async () => {
    stubFetch();
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    const first = render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Reject all' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reject all' })).not.toBeInTheDocument();
    });
    first.unmount();

    render(
      <ConsentProvider policyVersion="2">
        <ConsentBanner />
      </ConsentProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Reject all' })).toBeInTheDocument();
  });

  it('clears existing analytics cookies immediately when analytics is withdrawn from Manage', async () => {
    stubFetch();
    // A newer policy version keeps the banner (and its Manage entry point)
    // visible even though a decision was already recorded, exercising the
    // same withdrawal path a re-prompt after a policy bump would use.
    const decision = buildDecision({ analytics: true, adsMarketing: true }, '1');
    document.cookie = `${CONSENT_COOKIE_NAME}=${encodeConsentCookieValue(decision)}; path=/`;
    document.cookie = '_ga=GA1.2.111111111.2222222222; path=/';

    const { ConsentProvider, ConsentBanner, ConsentDialog } = await loadComponents();

    render(
      <ConsentProvider policyVersion="2">
        <ConsentBanner />
        <ConsentDialog />
      </ConsentProvider>,
    );

    expect(document.cookie).toContain('_ga=');

    await userEvent.click(screen.getByRole('button', { name: 'Manage preferences' }));
    const analyticsToggle = await screen.findByRole('checkbox', { name: 'Analytics' });
    expect(analyticsToggle).toBeChecked();
    await userEvent.click(analyticsToggle);
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(document.cookie).not.toContain('_ga=');
    });
  });

  it('still applies the local decision and keeps tags off when the write to the API fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch({ consentStatus: 500 });
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Reject all' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reject all' })).not.toBeInTheDocument();
    });
    const decisionCookie = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${CONSENT_COOKIE_NAME}=`));
    expect(decisionCookie).toBeDefined();
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    consoleErrorSpy.mockRestore();
  });

  it('renders the banner text from the real en catalog', async () => {
    stubFetch();
    const { ConsentProvider, ConsentBanner } = await loadComponents();

    render(
      <ConsentProvider policyVersion="1">
        <ConsentBanner />
      </ConsentProvider>,
    );

    expect(
      await screen.findByText(
        'We use cookies for analytics and ads/marketing only with your consent. Necessary cookies are always on.',
      ),
    ).toBeInTheDocument();
  });
});
