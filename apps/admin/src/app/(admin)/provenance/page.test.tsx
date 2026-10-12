import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ProvenanceFilters as ProvenanceFiltersValue } from './provenance-search-params';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

const provenanceFiltersMock = vi.fn(() => <div data-testid="provenance-filters" />);
const provenanceTableMock = vi.fn(() => <div data-testid="provenance-table" />);
vi.mock('./provenance-filters', () => ({ ProvenanceFilters: provenanceFiltersMock }));
vi.mock('./provenance-table', () => ({ ProvenanceTable: provenanceTableMock }));

async function loadPage() {
  return (await import('./page')).default;
}

describe('ProvenanceQueuePage', () => {
  it('renders the title and defaults to pending_review', async () => {
    const ProvenanceQueuePage = await loadPage();

    render(await ProvenanceQueuePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Provenance queue')).toBeInTheDocument();
    const props = (provenanceTableMock.mock.calls[0] as [ProvenanceFiltersValue] | undefined)?.[0];
    expect(props).toMatchObject({ status: 'pending_review' });
  });

  it('passes an explicit verdict through', async () => {
    const ProvenanceQueuePage = await loadPage();

    render(await ProvenanceQueuePage({ searchParams: Promise.resolve({ verdict: 'fail' }) }));

    const props = (
      provenanceTableMock.mock.calls.at(-1) as [ProvenanceFiltersValue] | undefined
    )?.[0];
    expect(props).toMatchObject({ status: 'pending_review', verdict: 'fail' });
  });
});
