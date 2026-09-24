import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

import type { PublicJobOfferSummary } from './job-offer-card';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

const OFFER: PublicJobOfferSummary = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'wedding-photographer-needed',
  title: 'Wedding photographer needed',
  category: 'wedding',
  city: 'Luxembourg City',
  countryCode: 'LU',
  location: { lat: 49.61, lng: 6.13 },
  remote: false,
  compensation: null,
  publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  company: {
    id: '4fa85f64-5717-4562-b3fc-2c963f66afa6',
    companyName: 'Acme Studios',
    website: 'https://acme.example',
    logoUrl: null,
    verified: true,
  },
};

async function renderCard(overrides: Partial<PublicJobOfferSummary> = {}) {
  const { JobOfferCard } = await import('./job-offer-card');
  const element = await JobOfferCard({ offer: { ...OFFER, ...overrides }, locale: 'en' });
  return render(element);
}

describe('JobOfferCard', () => {
  it('links to the offer detail page and shows the title, company and category', async () => {
    await renderCard();

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/en/job-offers/wedding-photographer-needed',
    );
    expect(screen.getByText('Wedding photographer needed')).toBeInTheDocument();
    expect(screen.getByText('Acme Studios')).toBeInTheDocument();
    expect(screen.getByText('Wedding')).toBeInTheDocument();
    expect(screen.getByText('Verified company')).toBeInTheDocument();
  });

  it('shows city and country for a non-remote offer', async () => {
    await renderCard();

    expect(screen.getByText('Luxembourg City, Luxembourg')).toBeInTheDocument();
  });

  it('shows a remote badge alongside the city for a remote offer', async () => {
    await renderCard({ remote: true });

    expect(screen.getByText('Remote (Luxembourg City, Luxembourg)')).toBeInTheDocument();
  });

  it('omits the compensation line when compensation is null', async () => {
    await renderCard({ compensation: null });

    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
  });

  it('shows the compensation range when present', async () => {
    await renderCard({
      compensation: {
        min: { amountCents: 50000, currency: 'EUR' },
        max: { amountCents: 90000, currency: 'EUR' },
      },
    });

    expect(screen.getByText('€500.00 – €900.00')).toBeInTheDocument();
  });

  it('never shows a verified badge for an unverified company', async () => {
    await renderCard({
      company: { ...OFFER.company, verified: false },
    });

    expect(screen.queryByText('Verified company')).not.toBeInTheDocument();
  });
});
