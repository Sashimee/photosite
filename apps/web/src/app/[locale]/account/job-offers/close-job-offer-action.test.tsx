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

async function loadCloseJobOfferAction() {
  const { CloseJobOfferAction } = await import('./close-job-offer-action');
  return CloseJobOfferAction;
}

describe('CloseJobOfferAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
  });

  it.each(['draft', 'closed', 'expired'] as const)(
    'renders nothing when the offer is not published (%s)',
    async (status) => {
      const CloseJobOfferAction = await loadCloseJobOfferAction();

      const { container } = render(<CloseJobOfferAction jobOfferId="offer-1" status={status} />);

      expect(container).toBeEmptyDOMElement();
    },
  );

  it('closes a published offer and refreshes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: 'closed' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const CloseJobOfferAction = await loadCloseJobOfferAction();
    const user = userEvent.setup({ delay: null });

    render(<CloseJobOfferAction jobOfferId="offer-1" status="published" />);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Yes, close' }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/me/job-offers/offer-1/close');
    expect(refreshMock).toHaveBeenCalled();
  });

  it('maps a 409 to "not open to close" and keeps the dialog open', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const CloseJobOfferAction = await loadCloseJobOfferAction();
    const user = userEvent.setup({ delay: null });

    render(<CloseJobOfferAction jobOfferId="offer-1" status="published" />);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Yes, close' }));

    expect(
      await screen.findByText(translate('web.jobOffers', 'errors.notOpenToClose')),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
