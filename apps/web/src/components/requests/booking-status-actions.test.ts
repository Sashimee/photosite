import { describe, expect, it } from 'vitest';

import type { BookingStatus } from '@photoo/shared';

import {
  areDocumentsAvailable,
  canAcceptDelivery,
  canCancel,
  canDeliver,
  canRequestRefund,
} from './booking-status-actions';

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

describe('canDeliver', () => {
  it('allows paid_held and in_progress only', () => {
    const allowed = ALL_STATUSES.filter(canDeliver);
    expect(allowed).toEqual(['paid_held', 'in_progress']);
  });
});

describe('canAcceptDelivery', () => {
  it('allows delivered only', () => {
    const allowed = ALL_STATUSES.filter(canAcceptDelivery);
    expect(allowed).toEqual(['delivered']);
  });
});

describe('canRequestRefund', () => {
  it('allows paid_held, in_progress and delivered only', () => {
    const allowed = ALL_STATUSES.filter(canRequestRefund);
    expect(allowed).toEqual(['paid_held', 'in_progress', 'delivered']);
  });
});

describe('canCancel', () => {
  it('allows pending_payment only', () => {
    const allowed = ALL_STATUSES.filter(canCancel);
    expect(allowed).toEqual(['pending_payment']);
  });
});

describe('areDocumentsAvailable', () => {
  it('allows released only', () => {
    const allowed = ALL_STATUSES.filter(areDocumentsAvailable);
    expect(allowed).toEqual(['released']);
  });
});
