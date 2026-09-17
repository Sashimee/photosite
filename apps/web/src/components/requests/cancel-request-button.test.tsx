import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadCancelRequestButton() {
  const { CancelRequestButton } = await import('./cancel-request-button');
  return CancelRequestButton;
}

describe('CancelRequestButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
  });

  it('hides the button once the request is booked, closed or cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const CancelRequestButton = await loadCancelRequestButton();

    const { rerender } = render(<CancelRequestButton requestId="req-1" status="booked" />);
    expect(
      screen.queryByRole('button', { name: translate('web.requests.detail', 'cancelCta') }),
    ).not.toBeInTheDocument();

    rerender(<CancelRequestButton requestId="req-1" status="closed" />);
    expect(
      screen.queryByRole('button', { name: translate('web.requests.detail', 'cancelCta') }),
    ).not.toBeInTheDocument();

    rerender(<CancelRequestButton requestId="req-1" status="cancelled" />);
    expect(
      screen.queryByRole('button', { name: translate('web.requests.detail', 'cancelCta') }),
    ).not.toBeInTheDocument();
  });

  it('is enabled for an open or quoted request and cancels on confirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const CancelRequestButton = await loadCancelRequestButton();
    const user = userEvent.setup();

    render(<CancelRequestButton requestId="req-1" status="open" />);
    const trigger = screen.getByRole('button', {
      name: translate('web.requests.detail', 'cancelCta'),
    });
    expect(trigger).toBeEnabled();

    await user.click(trigger);
    await user.click(
      await screen.findByRole('button', {
        name: translate('web.requests.detail', 'cancelConfirmCta'),
      }),
    );

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/requests/req-1/cancel');
    expect(refreshMock).toHaveBeenCalled();
  });

  it('resets pending and shows a generic error when the network request fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const CancelRequestButton = await loadCancelRequestButton();
    const user = userEvent.setup();

    render(<CancelRequestButton requestId="req-1" status="open" />);
    await user.click(
      screen.getByRole('button', { name: translate('web.requests.detail', 'cancelCta') }),
    );
    const confirmButton = await screen.findByRole('button', {
      name: translate('web.requests.detail', 'cancelConfirmCta'),
    });
    await user.click(confirmButton);

    expect(
      await screen.findByText(translate('web.requests', 'errors.generic')),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: translate('web.requests.detail', 'cancelConfirmCta') }),
    ).toBeEnabled();
  });
});
