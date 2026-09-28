import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

describe('BookingStatusTimeline', () => {
  it('renders the ordered main steps with the current step marked as aria-current', async () => {
    const { BookingStatusTimeline } = await import('./booking-status-timeline');
    const element = await BookingStatusTimeline({ status: 'in_progress', locale: 'en' });
    render(element);

    const current = screen.getByText(translate('web.bookings.status', 'in_progress'));
    expect(current).toHaveAttribute('aria-current', 'step');

    const paidHeld = screen.getByText(translate('web.bookings.status', 'paid_held'));
    expect(paidHeld).not.toHaveAttribute('aria-current', 'step');

    const delivered = screen.getByText(translate('web.bookings.status', 'delivered'));
    expect(delivered).not.toHaveAttribute('aria-current', 'step');

    expect(
      screen.getByRole('list', { name: translate('web.bookings.detail', 'statusTimelineLabel') }),
    ).toBeInTheDocument();
  });

  it('marks the first step as current when the booking is pending payment', async () => {
    const { BookingStatusTimeline } = await import('./booking-status-timeline');
    const element = await BookingStatusTimeline({ status: 'pending_payment', locale: 'en' });
    render(element);

    expect(screen.getByText(translate('web.bookings.status', 'pending_payment'))).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('renders every main step struck through plus an exit message for a side-exit status', async () => {
    const { BookingStatusTimeline } = await import('./booking-status-timeline');
    const element = await BookingStatusTimeline({ status: 'refunded', locale: 'en' });
    render(element);

    const list = screen.getByRole('list', {
      name: translate('web.bookings.detail', 'statusTimelineLabel'),
    });
    expect(list.children).toHaveLength(5);
    for (const child of Array.from(list.children)) {
      expect(child).toHaveClass('line-through');
    }

    expect(
      screen.getByText(
        `${translate('web.bookings.detail', 'statusTimelineExited')} ${translate('web.bookings.status', 'refunded')}`,
      ),
    ).toBeInTheDocument();
  });

  it.each([
    ['paid_held', 1],
    ['delivered', 3],
    ['released', 4],
  ] as const)('marks %s as the current step at index %i', async (status, index) => {
    const { BookingStatusTimeline } = await import('./booking-status-timeline');
    const element = await BookingStatusTimeline({ status, locale: 'en' });
    render(element);

    const list = screen.getByRole('list', {
      name: translate('web.bookings.detail', 'statusTimelineLabel'),
    });
    const steps = Array.from(list.children).map((child) => child.querySelector('span'));

    steps.forEach((step, stepIndex) => {
      if (stepIndex === index) {
        expect(step).toHaveAttribute('aria-current', 'step');
      } else {
        expect(step).not.toHaveAttribute('aria-current', 'step');
      }
    });
  });

  it.each(['cancelled', 'disputed'] as const)(
    'renders every main step struck through plus an exit message for %s',
    async (status) => {
      const { BookingStatusTimeline } = await import('./booking-status-timeline');
      const element = await BookingStatusTimeline({ status, locale: 'en' });
      render(element);

      const list = screen.getByRole('list', {
        name: translate('web.bookings.detail', 'statusTimelineLabel'),
      });
      expect(list.children).toHaveLength(5);
      for (const child of Array.from(list.children)) {
        expect(child).toHaveClass('line-through');
      }

      expect(
        screen.getByText(
          `${translate('web.bookings.detail', 'statusTimelineExited')} ${translate('web.bookings.status', status)}`,
        ),
      ).toBeInTheDocument();
    },
  );
});
