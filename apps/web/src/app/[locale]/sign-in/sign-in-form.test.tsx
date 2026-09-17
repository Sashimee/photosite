import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

async function loadSignInForm() {
  const { SignInForm } = await import('./sign-in-form');
  return SignInForm;
}

describe('SignInForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('shows a translated error for invalid credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD' }), { status: 401 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const SignInForm = await loadSignInForm();
    const user = userEvent.setup();

    render(<SignInForm locale="en" />);
    await user.type(screen.getByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects to the two-factor challenge, preserving next', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ twoFactorRequired: true }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const SignInForm = await loadSignInForm();
    const user = userEvent.setup();

    render(<SignInForm locale="en" next="/en/requests" />);
    await user.type(screen.getByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/en/sign-in/two-factor?next=%2Fen%2Frequests');
    });
  });

  it('redirects to the sanitized next path on a normal sign-in', async () => {
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
          session: { token: 'sess_ignored', expiresAt: '2026-01-01T00:00:00.000Z' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const SignInForm = await loadSignInForm();
    const user = userEvent.setup();

    render(<SignInForm locale="en" next="//evil.com" />);
    await user.type(screen.getByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/en/account');
    });
    expect(refreshMock).toHaveBeenCalled();
  });
});
