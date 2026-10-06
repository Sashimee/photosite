import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();
const getMock = vi.fn();

vi.mock('@/lib/server-api', () => ({
  getSession: getSessionMock,
  serverApi: () => Promise.resolve({ GET: getMock }),
}));
vi.mock('next-intl/server', async () => {
  const { mockUseFormatter, translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
    getFormatter: () => mockUseFormatter(),
  };
});

const zero = { current: 0, previous: 0 };
const dashboard = {
  window: '30d',
  generatedAt: '2026-10-07T10:00:00.000Z',
  signups: { total: zero, client: zero, photographer: zero, professional: zero },
  activity: { requests: zero, quotes: zero, bookings: zero },
  money: null,
  backlogs: { verification: 0, provenance: 0, reports: 0, dataRequests: 0 },
};

function mockApi() {
  getMock.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/v1/admin/me'
        ? { data: { permissions: [] }, response: { status: 200 } }
        : { data: dashboard, response: { status: 200 } },
    ),
  );
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('AdminHomePage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
    getMock.mockReset();
  });

  it('shows who is signed in', async () => {
    getSessionMock.mockResolvedValue({ email: 'admin@example.com' });
    mockApi();
    const AdminHomePage = await loadPage();

    render(await AdminHomePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Signed in as admin@example.com')).toBeInTheDocument();
  });

  it('throws loudly instead of rendering with no session', async () => {
    getSessionMock.mockResolvedValue(null);
    const AdminHomePage = await loadPage();

    await expect(AdminHomePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /without a session/,
    );
  });
});
