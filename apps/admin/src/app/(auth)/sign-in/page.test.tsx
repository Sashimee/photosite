import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();

vi.mock('@/lib/server-api', () => ({
  getSession: getSessionMock,
}));
vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) };
});

const ADMIN_USER = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'admin@example.com',
  roles: ['admin'],
  twoFactorEnabled: true,
};

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

async function redirectDigest(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

describe('SignInPage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
  });

  it('shows the password form when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const SignInPage = await loadPage();

    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('redirects an already signed-in visitor to the sanitized next path', async () => {
    getSessionMock.mockResolvedValue(ADMIN_USER);
    const SignInPage = await loadPage();

    const digest = await redirectDigest(SignInPage({ searchParams: Promise.resolve({}) }));

    expect(digest).toBe('NEXT_REDIRECT;replace;/;307;');
  });

  it('redirects an already signed-in visitor to a safe next path', async () => {
    getSessionMock.mockResolvedValue(ADMIN_USER);
    const SignInPage = await loadPage();

    const digest = await redirectDigest(
      SignInPage({ searchParams: Promise.resolve({ next: '/reports' }) }),
    );

    expect(digest).toBe('NEXT_REDIRECT;replace;/reports;307;');
  });

  it('shows the reverify stage for a signed-in admin with an expired second factor', async () => {
    getSessionMock.mockResolvedValue(ADMIN_USER);
    const SignInPage = await loadPage();

    render(
      await SignInPage({
        searchParams: Promise.resolve({ next: '/reports', reverify: '1' }),
      }),
    );

    expect(screen.getByText("Confirm it's you")).toBeInTheDocument();
  });

  it('ignores a reverify flag for an account with no second factor', async () => {
    getSessionMock.mockResolvedValue({ ...ADMIN_USER, twoFactorEnabled: false });
    const SignInPage = await loadPage();

    const digest = await redirectDigest(
      SignInPage({ searchParams: Promise.resolve({ reverify: '1' }) }),
    );

    expect(digest).toBeDefined();
  });

  it('shows the enroll stage for a signed-in admin with no second factor', async () => {
    getSessionMock.mockResolvedValue({ ...ADMIN_USER, twoFactorEnabled: false });
    const SignInPage = await loadPage();

    render(await SignInPage({ searchParams: Promise.resolve({ enroll: '1' }) }));

    expect(
      screen.getByText('Admin accounts require two-factor authentication'),
    ).toBeInTheDocument();
  });
});
