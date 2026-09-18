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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

const ADMIN_USER = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'admin@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  locale: 'en',
  country: 'LU',
  roles: ['admin'],
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
};

const SESSION = { token: 'sess_ignored', expiresAt: '2026-01-01T00:00:00.000Z' };

async function loadSignInForm() {
  const { SignInForm } = await import('./sign-in-form');
  return SignInForm;
}

// userEvent's default per-keystroke delay puts these renders within a few
// hundred ms of vitest's 5s timeout locally, and over it on a slower CI
// runner; the typing delay buys nothing here because nothing in the form is
// debounced.
function setupUser() {
  return userEvent.setup({ delay: null });
}

describe('SignInForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('shows a translated error for invalid credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 401)),
    );
    const SignInForm = await loadSignInForm();
    const user = setupUser();

    render(<SignInForm initialMode="signIn" />);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('routes to the code stage when the account has two-factor enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ twoFactorRequired: true }, 200)),
    );
    const SignInForm = await loadSignInForm();
    const user = setupUser();

    render(<SignInForm initialMode="signIn" next="/reports" />);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByLabelText('Authenticator code')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows the mapped error for a wrong two-factor code', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ twoFactorRequired: true }, 200))
      .mockResolvedValueOnce(jsonResponse({ code: 'INVALID_CODE' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const SignInForm = await loadSignInForm();
    const user = setupUser();

    render(<SignInForm initialMode="signIn" />);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText("That code isn't correct.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('sends an admin with no second factor to enrollment instead of the shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ user: ADMIN_USER, session: SESSION }, 200)),
    );
    const SignInForm = await loadSignInForm();
    const user = setupUser();

    render(<SignInForm initialMode="signIn" />);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('Admin accounts require two-factor authentication'),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('redirects a non-admin away without offering enrollment', async () => {
    const nonAdminUser = { ...ADMIN_USER, roles: ['client'] };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ user: nonAdminUser, session: SESSION }, 200)),
    );
    const SignInForm = await loadSignInForm();
    const user = setupUser();

    render(<SignInForm initialMode="signIn" next="//evil.com" />);
    await user.type(screen.getByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/');
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it('completes enrollment through password, secret and verify', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://x', backupCodes: ['aaa-111'] },
          200,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ user: ADMIN_USER }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const SignInForm = await loadSignInForm();
    const user = setupUser();

    render(<SignInForm initialMode="enroll" next="/reports" />);
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    await user.click(screen.getByLabelText("I've saved my backup codes"));
    await user.type(screen.getByLabelText('6-digit code from your authenticator app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Enable two-factor authentication' }));

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/reports');
    });
  });

  it('re-verifies a stale second factor and returns to the intended page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ user: ADMIN_USER }, 200)));
    const SignInForm = await loadSignInForm();
    const user = setupUser();

    render(<SignInForm initialMode="reverify" next="/reports" />);
    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    await vi.waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/reports');
    });
  });

  it('shows the mapped error for a wrong re-verify code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ code: 'INVALID_CODE' }, 401)));
    const SignInForm = await loadSignInForm();
    const user = setupUser();

    render(<SignInForm initialMode="reverify" />);
    await user.type(screen.getByLabelText('Authenticator code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText("That code isn't correct.")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
