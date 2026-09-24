import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadComponent() {
  const { EmailVerificationRequired } = await import('./email-verification-required');
  return EmailVerificationRequired;
}

describe('EmailVerificationRequired', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('resends the verification email to the session address and shows a success state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'sent' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const EmailVerificationRequired = await loadComponent();
    const user = userEvent.setup();

    render(<EmailVerificationRequired email="jane@example.com" />);
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));

    expect(
      await screen.findByText('Verification email sent. Check your inbox.'),
    ).toBeInTheDocument();

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toContain('/v1/auth/verify-email/resend');
    expect((await request.json()) as unknown).toEqual({ email: 'jane@example.com' });
  });

  it('shows a distinct rate-limited state with the retry countdown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 30 } }),
          { status: 429 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const EmailVerificationRequired = await loadComponent();
    const user = userEvent.setup();

    render(<EmailVerificationRequired email="jane@example.com" />);
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));

    expect(
      await screen.findByText('Too many attempts. Try again in 30 seconds.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Verification email sent. Check your inbox.'),
    ).not.toBeInTheDocument();
  });

  it('shows a generic error state for anything else', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'VALIDATION_ERROR' }), { status: 422 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const EmailVerificationRequired = await loadComponent();
    const user = userEvent.setup();

    render(<EmailVerificationRequired email="jane@example.com" />);
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));

    expect(await screen.findByText('Please check the highlighted fields.')).toBeInTheDocument();
  });
});
