import { beforeAll, describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import type { components } from '@photoo/api-client';

import i18n from '../../lib/i18n';
import { PhotographerCard } from './photographer-card';

type PhotographerSummary = components['schemas']['PhotographerSummary'];

const base: PhotographerSummary = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  slug: 'jane-doe-photography',
  displayName: 'Jane Doe Photography',
  headline: 'Wedding and portrait photographer',
  avatarUrl: null,
  categories: ['wedding', 'portrait'],
  languages: ['en', 'fr'],
  city: 'Luxembourg',
  countryCode: 'LU',
  ratingAvg: 4.8,
  ratingCount: 12,
  startingPrice: { amountCents: 15000, currency: 'EUR' },
};

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      i18n.on('initialized', () => {
        resolve();
      });
    });
  }
});

describe('PhotographerCard', () => {
  it('renders the money helper output for the starting price', () => {
    render(<PhotographerCard photographer={base} />);
    expect(screen.getByText('From €150.00')).toBeTruthy();
  });

  it('renders the display name, city and categories', () => {
    render(<PhotographerCard photographer={base} />);
    expect(screen.getByText('Jane Doe Photography')).toBeTruthy();
    expect(screen.getByText('Luxembourg')).toBeTruthy();
    expect(screen.getByText('Wedding')).toBeTruthy();
    expect(screen.getByText('Portrait')).toBeTruthy();
  });

  it('omits the price line when there is no starting price', () => {
    render(<PhotographerCard photographer={{ ...base, startingPrice: null }} />);
    expect(screen.queryByText(/From/)).toBeNull();
  });

  it('omits the rating line when there are no reviews yet', () => {
    render(<PhotographerCard photographer={{ ...base, ratingCount: 0 }} />);
    expect(screen.queryByText(/review/)).toBeNull();
  });
});
