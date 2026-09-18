import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const serverApiMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

const userActionsMock = vi.fn(() => <div data-testid="user-actions" />);
const auditTrailMock = vi.fn(() => <div data-testid="audit-trail" />);
vi.mock('./user-actions', () => ({ UserActions: userActionsMock }));
vi.mock('./audit-trail', () => ({ AuditTrail: auditTrailMock }));

function firstCallProps(mock: { mock: { calls: unknown[][] } }) {
  return (mock.mock.calls[0] as [{ canManageRoles: boolean }] | undefined)?.[0];
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

const user = {
  id: 'user-1',
  email: 'alice@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: true,
  lastLoginAt: null,
};

describe('UserDetailPage', () => {
  it('shows the full email, unlike the masked list view', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: user, response: { status: 200 } })
        .mockResolvedValueOnce({
          data: { items: [], nextCursor: null },
          response: { status: 200 },
        }),
    });
    const UserDetailPage = await loadPage();

    render(await UserDetailPage({ params: Promise.resolve({ id: 'user-1' }) }));

    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('shows the audit trail and passes canManageRoles when the audit-log probe succeeds', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: user, response: { status: 200 } })
        .mockResolvedValueOnce({
          data: { items: [], nextCursor: null },
          response: { status: 200 },
        }),
    });
    const UserDetailPage = await loadPage();

    render(await UserDetailPage({ params: Promise.resolve({ id: 'user-1' }) }));

    expect(screen.getByTestId('audit-trail')).toBeInTheDocument();
    expect(firstCallProps(userActionsMock)).toMatchObject({
      canManageRoles: true,
    });
  });

  it('hides the audit trail and the roles control when the probe is forbidden', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: user, response: { status: 200 } })
        .mockResolvedValueOnce({ data: undefined, response: { status: 403 } }),
    });
    const UserDetailPage = await loadPage();

    render(await UserDetailPage({ params: Promise.resolve({ id: 'user-1' }) }));

    expect(screen.queryByTestId('audit-trail')).not.toBeInTheDocument();
    expect(firstCallProps(userActionsMock)).toMatchObject({
      canManageRoles: false,
    });
  });

  it('calls notFound for a missing user instead of throwing', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi.fn().mockResolvedValueOnce({ data: undefined, response: { status: 404 } }),
    });
    const UserDetailPage = await loadPage();

    await expect(UserDetailPage({ params: Promise.resolve({ id: 'missing' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('throws on an unexpected failure instead of silently degrading permissions', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: user, response: { status: 200 } })
        .mockResolvedValueOnce({ data: undefined, response: { status: 500 } }),
    });
    const UserDetailPage = await loadPage();

    await expect(UserDetailPage({ params: Promise.resolve({ id: 'user-1' }) })).rejects.toThrow(
      /HTTP 500/,
    );
  });
});
