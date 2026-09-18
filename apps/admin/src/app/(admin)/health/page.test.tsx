import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const getBuildInfoMock = vi.fn();

vi.mock('@/lib/build-info', () => ({ getBuildInfo: getBuildInfoMock }));
vi.mock('./readiness-table', () => ({
  ReadinessTable: () => <div>readiness-table</div>,
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

describe('HealthPage', () => {
  it('shows the build version and time', async () => {
    getBuildInfoMock.mockReturnValue({ version: 'abc1234', builtAt: '2026-09-01T00:00:00.000Z' });
    const HealthPage = await loadPage();

    render(await HealthPage());

    expect(screen.getByText('System health')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01T00:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('readiness-table')).toBeInTheDocument();
  });

  it('shows "unknown" when the build time is not set', async () => {
    getBuildInfoMock.mockReturnValue({ version: 'dev', builtAt: null });
    const HealthPage = await loadPage();

    render(await HealthPage());

    expect(screen.getByText('dev')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
