import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuotePhotographer } from './quote-photographer';

const basePhotographer = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66dddd',
  slug: 'jane-doe',
  displayName: 'Jane Doe',
  avatarUrl: null,
  city: 'Luxembourg',
  countryCode: 'LU',
  ratingAvg: 4.5,
  ratingCount: 12,
};

describe('QuotePhotographer', () => {
  it('links to the photographer profile and shows their name, city and rating label', () => {
    render(
      <QuotePhotographer
        photographer={basePhotographer}
        locale="en"
        ratingLabel="4.5 (12 reviews)"
      />,
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/en/photographers/jane-doe');
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/Luxembourg/)).toBeInTheDocument();
    expect(screen.getByText(/4\.5 \(12 reviews\)/)).toBeInTheDocument();
  });

  it('shows the avatar image when one is set', () => {
    render(
      <QuotePhotographer
        photographer={{ ...basePhotographer, avatarUrl: '/avatar.jpg' }}
        locale="en"
        ratingLabel={null}
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute('alt', basePhotographer.displayName);
  });

  it('omits the rating when there is no label', () => {
    render(<QuotePhotographer photographer={basePhotographer} locale="en" ratingLabel={null} />);

    expect(screen.getByText('Luxembourg')).toBeInTheDocument();
  });
});
