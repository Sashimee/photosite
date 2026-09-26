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
});
