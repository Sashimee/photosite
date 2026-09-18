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

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('AdminHomePage', () => {
  afterEach(() => {
    vi.resetModules();
    getSessionMock.mockReset();
  });

  it('shows who is signed in', async () => {
    getSessionMock.mockResolvedValue({ email: 'admin@example.com' });
    const AdminHomePage = await loadPage();

    render(await AdminHomePage());

    expect(screen.getByText('Signed in as admin@example.com')).toBeInTheDocument();
  });

  it('throws loudly instead of rendering with no session', async () => {
    getSessionMock.mockResolvedValue(null);
    const AdminHomePage = await loadPage();

    await expect(AdminHomePage()).rejects.toThrow(/without a session/);
  });
});
