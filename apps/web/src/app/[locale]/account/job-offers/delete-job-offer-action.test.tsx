import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const refreshMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
}));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadDeleteJobOfferAction() {
  const { DeleteJobOfferAction } = await import('./delete-job-offer-action');
  return DeleteJobOfferAction;
}

describe('DeleteJobOfferAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
    pushMock.mockReset();
  });

  it('names that applications are removed with the offer in the confirmation', async () => {
    const DeleteJobOfferAction = await loadDeleteJobOfferAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteJobOfferAction jobOfferId="offer-1" />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(
      screen.getByText(
        "This can't be undone. Any applications received for this offer are removed with it.",
      ),
    ).toBeInTheDocument();
  });

  it('deletes and refreshes when no redirect target is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeleteJobOfferAction = await loadDeleteJobOfferAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteJobOfferAction jobOfferId="offer-1" />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.method).toBe('DELETE');
    expect(request.url).toContain('/v1/me/job-offers/offer-1');
    expect(refreshMock).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects instead of refreshing when a redirect target is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeleteJobOfferAction = await loadDeleteJobOfferAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteJobOfferAction jobOfferId="offer-1" redirectTo="/en/account/job-offers" />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(pushMock).toHaveBeenCalledWith('/en/account/job-offers');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('shows a mapped error and keeps the dialog open on failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeleteJobOfferAction = await loadDeleteJobOfferAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteJobOfferAction jobOfferId="offer-1" />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    expect(await screen.findByText('This job offer could not be found.')).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
