import { render, screen, waitFor } from '@testing-library/react';
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

async function loadDeleteAccountAction() {
  const { DeleteAccountAction } = await import('./delete-account-action');
  return DeleteAccountAction;
}

describe('DeleteAccountAction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    refreshMock.mockReset();
    pushMock.mockReset();
  });

  it('explains the grace period in the confirmation', async () => {
    const DeleteAccountAction = await loadDeleteAccountAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteAccountAction locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(
      screen.getByText(
        "Your account is deactivated immediately and permanently deleted after a 30-day grace period. We'll email you a link to cancel the deletion at any time before then.",
      ),
    ).toBeInTheDocument();
  });

  it('requests deletion and redirects to the confirmation page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'request-1',
          type: 'delete',
          status: 'pending',
          requestedAt: '2026-01-01T00:00:00.000Z',
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const DeleteAccountAction = await loadDeleteAccountAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteAccountAction locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.method).toBe('POST');
    expect(request.url).toContain('/v1/me/data-requests');
    expect((await request.json()) as unknown).toEqual({ type: 'delete' });
    expect(pushMock).toHaveBeenCalledWith('/en/account/deletion/requested');
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows a mapped conflict error and keeps the dialog open', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeleteAccountAction = await loadDeleteAccountAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteAccountAction locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(await screen.findByText("Your account can't be deleted right now.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a generic error and keeps the dialog open when the request fails to send', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const DeleteAccountAction = await loadDeleteAccountAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteAccountAction locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, delete my account' })).toBeEnabled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a retry-seconds message for a rate-limited request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 5 } }),
        {
          status: 429,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const DeleteAccountAction = await loadDeleteAccountAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteAccountAction locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(
      await screen.findByText('Too many attempts. Please try again in 5 seconds.'),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a generic retry-later message for a rate-limited request without a retry time', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'TOO_MANY_REQUESTS' }), { status: 429 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const DeleteAccountAction = await loadDeleteAccountAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteAccountAction locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    expect(
      await screen.findByText('Too many attempts. Please try again later.'),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('clears the previous error when the dialog is reopened', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'CONFLICT' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const DeleteAccountAction = await loadDeleteAccountAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteAccountAction locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));
    expect(await screen.findByText("Your account can't be deleted right now.")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(screen.queryByText("Your account can't be deleted right now.")).not.toBeInTheDocument();
  });

  it('shows the pending label and disables cancel while the request is in flight', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const DeleteAccountAction = await loadDeleteAccountAction();
    const user = userEvent.setup({ delay: null });

    render(<DeleteAccountAction locale="en" />);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete my account' }));

    const pendingButton = await screen.findByRole('button', { name: 'Deleting…' });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(pushMock).not.toHaveBeenCalled();

    resolveFetch(
      new Response(
        JSON.stringify({
          id: 'request-1',
          type: 'delete',
          status: 'pending',
          requestedAt: '2026-01-01T00:00:00.000Z',
        }),
        { status: 201 },
      ),
    );

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/en/account/deletion/requested');
    });
  });
});
