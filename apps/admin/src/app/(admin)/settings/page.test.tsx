import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

const serverApiMock = vi.fn();

vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));
vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

const lastChangedMock = vi.fn(() => <div data-testid="last-changed" />);
vi.mock('./last-changed', () => ({ LastChanged: lastChangedMock }));
vi.mock('./fee-dialog', () => ({ FeeDialog: () => <div data-testid="fee-dialog" /> }));
vi.mock('./auto-release-form', () => ({
  AutoReleaseForm: () => <div data-testid="auto-release-form" />,
}));
vi.mock('./flags-form', () => ({ FlagsForm: () => <div data-testid="flags-form" /> }));
vi.mock('./countries-table', () => ({
  CountriesTable: () => <div data-testid="countries-table" />,
}));

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

type PlatformSettings = components['schemas']['PlatformSettings'];
type AdminCountry = components['schemas']['AdminCountry'];

const country: AdminCountry = {
  code: 'LU',
  name: 'Luxembourg',
  currency: 'EUR',
  enabled: true,
  vatRate: 17,
  defaultLocale: 'fr',
  accountCount: 42,
};

function settingsWithFee(feePercent: number | null): PlatformSettings {
  return { feePercent, autoReleaseDays: 14, featureFlags: [] };
}

describe('SettingsPage', () => {
  it('renders an unconfigured fee as "Not configured", never as a default value', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: settingsWithFee(null), response: { status: 200 } })
        .mockResolvedValueOnce({ data: [country], response: { status: 200 } }),
    });
    const SettingsPage = await loadPage();

    render(await SettingsPage());

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.queryByText('5%')).not.toBeInTheDocument();
    expect(screen.queryByText(/^5$/)).not.toBeInTheDocument();
  });

  it('renders a configured fee as a percentage', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: settingsWithFee(8), response: { status: 200 } })
        .mockResolvedValueOnce({ data: [country], response: { status: 200 } }),
    });
    const SettingsPage = await loadPage();

    render(await SettingsPage());

    expect(screen.getByText('8%')).toBeInTheDocument();
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
  });

  it('throws on an unexpected settings load failure instead of silently defaulting the fee', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: undefined, response: { status: 500 } })
        .mockResolvedValueOnce({ data: [country], response: { status: 200 } }),
    });
    const SettingsPage = await loadPage();

    await expect(SettingsPage()).rejects.toThrow(/HTTP 500/);
  });

  it('renders a forbidden message instead of throwing on a 403', async () => {
    serverApiMock.mockResolvedValue({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: undefined, response: { status: 403 } })
        .mockResolvedValueOnce({ data: undefined, response: { status: 403 } }),
    });
    const SettingsPage = await loadPage();

    render(await SettingsPage());

    expect(screen.getByText("You don't have permission to do this.")).toBeInTheDocument();
    expect(screen.queryByTestId('countries-table')).not.toBeInTheDocument();
  });
});
