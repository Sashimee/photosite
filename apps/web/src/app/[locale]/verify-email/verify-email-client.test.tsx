import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadVerifyEmailClient() {
  const { VerifyEmailClient } = await import('./verify-email-client');
  return VerifyEmailClient;
}

function setHash(hash: string) {
  window.history.replaceState(null, '', `/en/verify-email${hash}`);
}

describe('VerifyEmailClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    setHash('');
  });

  it('shows an error when the fragment has no token', async () => {
    setHash('');
    vi.stubGlobal('fetch', vi.fn());
    const VerifyEmailClient = await loadVerifyEmailClient();

    render(<VerifyEmailClient locale="en" />);

    expect(
      await screen.findByText('This verification link is invalid or has expired.'),
    ).toBeInTheDocument();
  });

  it('posts the fragment token and shows success', async () => {
    setHash('#token=a1b2c3');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
            email: 'client@example.com',
            emailVerifiedAt: '2026-01-01T00:00:00.000Z',
            locale: 'en',
            country: 'LU',
            roles: ['client'],
            status: 'active',
            twoFactorEnabled: false,
            lastLoginAt: null,
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const VerifyEmailClient = await loadVerifyEmailClient();

    render(<VerifyEmailClient locale="en" />);

    expect(await screen.findByText('Your email is verified.')).toBeInTheDocument();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect((await request.json()) as unknown).toEqual({ token: 'a1b2c3' });
  });

  it('shows a translated error when verification fails', async () => {
    setHash('#token=expired-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'TOKEN_EXPIRED' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    const VerifyEmailClient = await loadVerifyEmailClient();

    render(<VerifyEmailClient locale="en" />);

    expect(
      await screen.findByText('This link has expired. Request a new one.'),
    ).toBeInTheDocument();
  });
});
