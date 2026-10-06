import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

vi.mock('./bookings-table', () => ({
  BookingsTable: () => <div data-testid="bookings-table" />,
}));

describe('FinancePage', () => {
  it('renders the title and the bookings table', async () => {
    const FinancePage = (await import('./page')).default;

    render(await FinancePage());

    expect(screen.getByRole('heading', { name: 'Bookings' })).toBeInTheDocument();
    expect(screen.getByTestId('bookings-table')).toBeInTheDocument();
  });
});
