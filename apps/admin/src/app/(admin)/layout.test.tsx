import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();
const headersMock = vi.fn();

vi.mock('@/lib/server-api', () => ({
  getSession: getSessionMock,
}));
vi.mock('next/headers', () => ({
  headers: headersMock,
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

function makeHeaders(pathname: string | null) {
  return {
    get: (name: string) => (name === 'x-pathname' ? pathname : null),
  };
}

async function loadLayout() {
  const mod = await import('./layout');
  return mod.default;
}

async function digestOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  return (error as { digest?: string }).digest;
}

describe('AdminLayout', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    headersMock.mockReset();
  });

  it('redirects a signed-out visitor to sign-in, preserving the path', async () => {
    getSessionMock.mockResolvedValue(null);
    headersMock.mockResolvedValue(makeHeaders('/reports'));
    const AdminLayout = await loadLayout();

    const digest = await digestOf(AdminLayout({ children: null }));

    expect(digest).toContain(encodeURIComponent('/reports'));
  });

  it('404s a signed-in non-admin instead of confirming the route exists', async () => {
    getSessionMock.mockResolvedValue({
      email: 'client@example.com',
      roles: ['client'],
      twoFactorEnabled: false,
    });
    headersMock.mockResolvedValue(makeHeaders('/'));
    const AdminLayout = await loadLayout();

    const digest = await digestOf(AdminLayout({ children: null }));

    expect(digest).toMatch(/;404$/);
  });

  it('routes an admin with no TOTP to enrollment instead of the shell', async () => {
    getSessionMock.mockResolvedValue({
      email: 'admin@example.com',
      roles: ['admin'],
      twoFactorEnabled: false,
    });
    headersMock.mockResolvedValue(makeHeaders('/reports'));
    const AdminLayout = await loadLayout();

    const digest = await digestOf(AdminLayout({ children: null }));

    expect(digest).toContain('enroll=1');
    expect(digest).toContain(encodeURIComponent('/reports'));
  });

  it('renders the shell for an admin with a verified second factor', async () => {
    getSessionMock.mockResolvedValue({
      email: 'admin@example.com',
      roles: ['admin'],
      twoFactorEnabled: true,
    });
    headersMock.mockResolvedValue(makeHeaders('/'));
    const AdminLayout = await loadLayout();

    render(await AdminLayout({ children: <p>shell-content</p> }));

    expect(screen.getByText('shell-content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
