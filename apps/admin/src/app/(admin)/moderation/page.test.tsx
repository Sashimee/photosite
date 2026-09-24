import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ModerationFilters as ModerationFiltersValue } from './moderation-search-params';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

const moderationFiltersMock = vi.fn(() => <div data-testid="moderation-filters" />);
const moderationTableMock = vi.fn(() => <div data-testid="moderation-table" />);
vi.mock('./moderation-filters', () => ({ ModerationFilters: moderationFiltersMock }));
vi.mock('./moderation-table', () => ({ ModerationTable: moderationTableMock }));

function firstCallProps(mock: typeof moderationFiltersMock | typeof moderationTableMock) {
  return (mock.mock.calls[0] as [ModerationFiltersValue] | undefined)?.[0];
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('ModerationQueuePage', () => {
  it('renders the title and defaults to the open filter, oldest first', async () => {
    const ModerationQueuePage = await loadPage();

    render(await ModerationQueuePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Moderation queue')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-filters')).toBeInTheDocument();
    expect(screen.getByTestId('moderation-table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Take down without a report' })).toHaveAttribute(
      'href',
      '/moderation/direct-takedown',
    );
    expect(firstCallProps(moderationFiltersMock)).toEqual({ status: 'open' });
    expect(firstCallProps(moderationTableMock)).toEqual({ status: 'open' });
  });

  it('passes an explicit status and target type through to the table', async () => {
    const ModerationQueuePage = await loadPage();

    render(
      await ModerationQueuePage({
        searchParams: Promise.resolve({ status: 'resolved', targetType: 'request' }),
      }),
    );

    expect(firstCallProps(moderationTableMock)).toEqual({
      status: 'resolved',
      targetType: 'request',
    });
  });

  it('passes the moderator-initiated toggle through to the table', async () => {
    const ModerationQueuePage = await loadPage();

    render(
      await ModerationQueuePage({
        searchParams: Promise.resolve({ status: 'resolved', moderatorInitiated: 'true' }),
      }),
    );

    expect(firstCallProps(moderationTableMock)).toEqual({
      status: 'resolved',
      moderatorInitiated: true,
    });
  });
});
