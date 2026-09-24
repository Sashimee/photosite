import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const getSessionMock = vi.fn();

vi.mock('@/lib/session', () => ({ getSession: getSessionMock }));
// `redirect`/`notFound` stay real (they just throw, no router needed), but
// `DashboardNav` (a client component) calls `usePathname`, which does need a
// mounted app router - stub only that.
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<typeof import('next/navigation')>('next/navigation');
  return { ...actual, usePathname: () => '/en/dashboard' };
});
vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

async function loadLayout() {
  const mod = await import('./layout');
  return mod.default;
}

async function redirectDigest(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

describe('DashboardLayout', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
  });

  it('redirects to sign-in when signed out', async () => {
    getSessionMock.mockResolvedValue(null);
    const DashboardLayout = await loadLayout();

    const digest = await redirectDigest(
      DashboardLayout({ children: null, params: Promise.resolve({ locale: 'en' }) }),
    );

    expect(digest).toContain(encodeURIComponent('/en/dashboard'));
  });

  it('offers to add the photographer role instead of the dashboard nav', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1', roles: ['client'] });
    const DashboardLayout = await loadLayout();

    const element = await DashboardLayout({
      children: null,
      params: Promise.resolve({ locale: 'en' }),
    });
    render(element);

    expect(
      screen.getByText('Add the photographer role to your account to set up a profile.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add the photographer role' })).toHaveAttribute(
      'href',
      '/en/account',
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders the nav and children for a user with the photographer role', async () => {
    getSessionMock.mockResolvedValue({ id: 'user-1', roles: ['photographer'] });
    const DashboardLayout = await loadLayout();

    const element = await DashboardLayout({
      children: 'checklist content',
      params: Promise.resolve({ locale: 'en' }),
    });
    render(element);

    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/en/dashboard');
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveAttribute(
      'href',
      '/en/dashboard/profile',
    );
    expect(screen.getByRole('link', { name: 'Requests' })).toHaveAttribute(
      'href',
      '/en/dashboard/requests',
    );
    expect(screen.getByRole('link', { name: 'Quotes' })).toHaveAttribute(
      'href',
      '/en/dashboard/quotes',
    );
    expect(screen.getByText('checklist content')).toBeInTheDocument();
  });
});
