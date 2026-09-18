import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VerificationFilters as VerificationFiltersValue } from './verification-search-params';

const getSessionMock = vi.fn();
vi.mock('@/lib/server-api', () => ({ getSession: getSessionMock }));
vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

const verificationFiltersMock = vi.fn(() => <div data-testid="verification-filters" />);
const verificationTableMock = vi.fn(() => <div data-testid="verification-table" />);
vi.mock('./verification-filters', () => ({ VerificationFilters: verificationFiltersMock }));
vi.mock('./verification-table', () => ({ VerificationTable: verificationTableMock }));

function firstCallProps(mock: typeof verificationFiltersMock | typeof verificationTableMock) {
  return (mock.mock.calls[0] as [VerificationFiltersValue] | undefined)?.[0];
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('VerificationQueuePage', () => {
  it('renders the title and defaults to the submitted filter', async () => {
    getSessionMock.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
    const VerificationQueuePage = await loadPage();

    render(await VerificationQueuePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Verification queue')).toBeInTheDocument();
    expect(screen.getByTestId('verification-filters')).toBeInTheDocument();
    expect(screen.getByTestId('verification-table')).toBeInTheDocument();
    expect(firstCallProps(verificationFiltersMock)).toEqual({ status: 'submitted' });
    expect(firstCallProps(verificationTableMock)).toMatchObject({
      status: 'submitted',
      currentAdminId: 'admin-1',
    });
  });

  it('passes an explicit status and country through to the table', async () => {
    getSessionMock.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
    const VerificationQueuePage = await loadPage();

    render(
      await VerificationQueuePage({
        searchParams: Promise.resolve({ status: 'approved', countryCode: 'LU' }),
      }),
    );

    expect(firstCallProps(verificationTableMock)).toMatchObject({
      status: 'approved',
      countryCode: 'LU',
    });
  });

  it('throws instead of rendering without a session', async () => {
    getSessionMock.mockResolvedValue(null);
    const VerificationQueuePage = await loadPage();

    await expect(VerificationQueuePage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      /session/,
    );
  });
});
