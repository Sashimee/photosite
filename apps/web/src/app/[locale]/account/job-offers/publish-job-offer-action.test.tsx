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

async function loadPublishJobOfferAction() {
  const { PublishJobOfferAction } = await import('./publish-job-offer-action');
  return PublishJobOfferAction;
}

describe('PublishJobOfferAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
  });

  it('renders nothing once the offer is already published', async () => {
    const PublishJobOfferAction = await loadPublishJobOfferAction();

    const { container } = render(<PublishJobOfferAction jobOfferId="offer-1" status="published" />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each(['draft', 'closed', 'expired'] as const)(
    'publishes a %s offer and refreshes',
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ status: 'published' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const PublishJobOfferAction = await loadPublishJobOfferAction();
      const user = userEvent.setup({ delay: null });

      render(<PublishJobOfferAction jobOfferId="offer-1" status={status} />);

      await user.click(screen.getByRole('button', { name: 'Publish' }));
      await user.click(screen.getByRole('button', { name: 'Yes, publish' }));

      const [request] = fetchMock.mock.calls[0] as [Request];
      expect(request.url).toContain('/v1/me/job-offers/offer-1/publish');
      expect(refreshMock).toHaveBeenCalled();
    },
  );

  it('maps a 409 to "already published" and keeps the dialog open', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const PublishJobOfferAction = await loadPublishJobOfferAction();
    const user = userEvent.setup({ delay: null });

    render(<PublishJobOfferAction jobOfferId="offer-1" status="draft" />);

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Yes, publish' }));

    expect(
      await screen.findByText(translate('web.jobOffers', 'errors.alreadyPublished')),
    ).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
