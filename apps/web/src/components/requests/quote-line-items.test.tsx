import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuoteLineItems } from './quote-line-items';

describe('QuoteLineItems', () => {
  it('shows quantity and unit price from the API, never a computed total', () => {
    render(
      <QuoteLineItems
        lineItems={[{ label: 'Full day coverage', qty: 2, unitCents: 15000 }]}
        currency="EUR"
        locale="en"
      />,
    );

    expect(screen.getByText('Full day coverage')).toBeInTheDocument();
    expect(screen.getByText('2 × €150.00')).toBeInTheDocument();
    expect(screen.queryByText('€300.00')).not.toBeInTheDocument();
  });
});
