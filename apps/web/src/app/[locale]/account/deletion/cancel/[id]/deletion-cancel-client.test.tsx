import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadDeletionCancelClient() {
  const { DeletionCancelClient } = await import('./deletion-cancel-client');
  return DeletionCancelClient;
}

function setHash(hash: string) {
  window.history.replaceState(null, '', `/en/account/deletion/cancel/request-1${hash}`);
}

describe('DeletionCancelClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    setHash('');
  });

  it('cancels using the session when the fragment has no token', async () => {
    setHash('');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'request-1',
          type: 'delete',
          status: 'cancelled',
          requestedAt: '2026-01-01T00:00:00.000Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(
      await screen.findByText('Your account deletion has been cancelled.'),
    ).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/me/data-requests/request-1/cancel');
    expect(await request.text()).toBe('');
  });

  it('posts the fragment token and shows success', async () => {
    setHash('#token=a1b2c3');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'request-1',
          type: 'delete',
          status: 'cancelled',
          requestedAt: '2026-01-01T00:00:00.000Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(
      await screen.findByText('Your account deletion has been cancelled.'),
    ).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect((await request.json()) as unknown).toEqual({ token: 'a1b2c3' });
  });

  it('shows an invalid-link message on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(
      await screen.findByText('This cancellation link is invalid or has expired.'),
    ).toBeInTheDocument();
  });

  it('shows a not-found message on 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(
      await screen.findByText('This deletion request could not be found.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['NOT_DELETION', "This request is not an account deletion and can't be cancelled here."],
    ['GRACE_PERIOD_ENDED', 'The 30-day window to cancel this deletion has ended.'],
    ['NOT_PENDING', 'This deletion request has already been cancelled or processed.'],
  ])('shows the %s message', async (code, message) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('shows a generic message for an unmapped error code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'SOMETHING_ELSE' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });
});
