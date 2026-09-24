import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DirectTakedownSearchParams } from './direct-takedown-search-params';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

async function renderForm(overrides: DirectTakedownSearchParams) {
  const { DirectTakedownLookupForm } = await import('./direct-takedown-lookup-form');
  return render(await DirectTakedownLookupForm(overrides));
}

describe('DirectTakedownLookupForm', () => {
  it('renders the target type select and slug input', async () => {
    await renderForm({ targetType: 'photographer_profile' });

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Content type')).toBeInTheDocument();
    expect(screen.getByLabelText('Slug')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look up' })).toBeInTheDocument();
  });

  it('preselects the current target type and slug', async () => {
    await renderForm({ targetType: 'job_offer', slug: 'wedding-second-shooter' });

    expect(screen.getByLabelText('Content type')).toHaveValue('job_offer');
    expect(screen.getByLabelText('Slug')).toHaveValue('wedding-second-shooter');
  });
});
