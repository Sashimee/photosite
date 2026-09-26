import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
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

async function confirm() {
  const user = userEvent.setup({ delay: null });
  await user.click(screen.getByRole('button', { name: 'Yes, cancel my account deletion' }));
}

describe('DeletionCancelClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    setHash('');
  });

  it('does not send a request until the confirm button is clicked', async () => {
    setHash('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(
      screen.getByText(
        "You're about to cancel your account deletion. Confirm below to keep your account.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send a request on mount even with a token in the fragment', async () => {
    setHash('#token=a1b2c3');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(
      screen.getByText(
        "You're about to cancel your account deletion. Confirm below to keep your account.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('strips the fragment token from the URL on mount', async () => {
    setHash('#token=a1b2c3');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);

    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/en/account/deletion/cancel/request-1');
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
    await confirm();

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
    await confirm();

    expect(
      await screen.findByText('Your account deletion has been cancelled.'),
    ).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect((await request.json()) as unknown).toEqual({ token: 'a1b2c3' });
  });

  it('shows an invalid-link message with no retry button on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(
      await screen.findByText('This cancellation link is invalid or has expired.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Yes, cancel my account deletion' }),
    ).not.toBeInTheDocument();
  });

  it('shows a not-found message with no retry button on 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(
      await screen.findByText('This deletion request could not be found.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Yes, cancel my account deletion' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['NOT_DELETION', "This request is not an account deletion and can't be cancelled here."],
    ['GRACE_PERIOD_ENDED', 'The 30-day window to cancel this deletion has ended.'],
    ['NOT_PENDING', 'This deletion request has already been cancelled or processed.'],
  ])('shows the %s message with no retry button', async (code, message) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Yes, cancel my account deletion' }),
    ).not.toBeInTheDocument();
  });

  it('shows a rate-limit message and a retry button when none is given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'TOO_MANY_REQUESTS' }), { status: 429 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(
      await screen.findByText('Too many attempts. Please try again later.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Yes, cancel my account deletion' }),
    ).toBeInTheDocument();
  });

  it('shows a rate-limit message with the retry time when given', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 30 } }),
          { status: 429 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(
      await screen.findByText('Too many attempts. Please try again in 30 seconds.'),
    ).toBeInTheDocument();
  });

  it('shows an invalid-link message with no retry button on 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'VALIDATION_ERROR' }), { status: 400 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(await screen.findByText('This cancellation link is invalid.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Yes, cancel my account deletion' }),
    ).not.toBeInTheDocument();
  });

  it('shows a generic message and a retry button for an unmapped error code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'SOMETHING_ELSE' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Yes, cancel my account deletion' }),
    ).toBeInTheDocument();
  });

  it('shows a generic message and a retry button for an error body with no code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Yes, cancel my account deletion' }),
    ).toBeInTheDocument();
  });

  it('fires the cancel request exactly once under React StrictMode double-invoke', async () => {
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

    render(
      <StrictMode>
        <DeletionCancelClient locale="en" id="request-1" />
      </StrictMode>,
    );
    await confirm();

    expect(
      await screen.findByText('Your account deletion has been cancelled.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect((await request.json()) as unknown).toEqual({ token: 'a1b2c3' });
  });

  it('sends only one request on a double click', async () => {
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
    const button = screen.getByRole('button', { name: 'Yes, cancel my account deletion' });
    act(() => {
      button.click();
      button.click();
    });

    expect(
      await screen.findByText('Your account deletion has been cancelled.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recovers from a network failure instead of hanging on pending', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const DeletionCancelClient = await loadDeletionCancelClient();

    render(<DeletionCancelClient locale="en" id="request-1" />);
    await confirm();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Yes, cancel my account deletion' }),
    ).toBeInTheDocument();
  });

  it('retries after a network failure and sends the token again', async () => {
    setHash('#token=a1b2c3');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
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
    await confirm();
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();

    await confirm();

    expect(
      await screen.findByText('Your account deletion has been cancelled.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondRequest] = fetchMock.mock.calls[1] as [Request];
    expect((await secondRequest.json()) as unknown).toEqual({ token: 'a1b2c3' });
  });
});
