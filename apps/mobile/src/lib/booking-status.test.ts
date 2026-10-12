import { describe, expect, it } from '@jest/globals';

import {
  areDocumentsAvailable,
  BOOKING_MAIN_STEPS,
  BOOKING_SIDE_EXITS,
  canAcceptDelivery,
  canCancel,
  canDeliver,
  canRequestRefund,
  isTerminalBookingStatus,
  type BookingStatus,
} from './booking-status';

const ALL_STATUSES: readonly BookingStatus[] = [
  'pending_payment',
  'paid_held',
  'in_progress',
  'delivered',
  'released',
  'refunded',
  'disputed',
  'cancelled',
];

describe('booking status mapping', () => {
  it('allows delivery in paid_held and in_progress only', () => {
    expect(ALL_STATUSES.filter(canDeliver)).toEqual(['paid_held', 'in_progress']);
  });

  it('allows accepting a delivery in delivered only', () => {
    expect(ALL_STATUSES.filter(canAcceptDelivery)).toEqual(['delivered']);
  });

  it('allows refund requests in paid_held, in_progress and delivered only', () => {
    expect(ALL_STATUSES.filter(canRequestRefund)).toEqual([
      'paid_held',
      'in_progress',
      'delivered',
    ]);
  });

  it('allows cancelling in pending_payment only', () => {
    expect(ALL_STATUSES.filter(canCancel)).toEqual(['pending_payment']);
  });

  it('offers documents in released only', () => {
    expect(ALL_STATUSES.filter(areDocumentsAvailable)).toEqual(['released']);
  });

  it('treats released, refunded, cancelled and disputed as terminal', () => {
    expect(ALL_STATUSES.filter(isTerminalBookingStatus)).toEqual([
      'released',
      'refunded',
      'disputed',
      'cancelled',
    ]);
  });

  it('covers every status exactly once across the timeline path and the side exits', () => {
    expect([...BOOKING_MAIN_STEPS, ...BOOKING_SIDE_EXITS].sort()).toEqual([...ALL_STATUSES].sort());
  });
});
