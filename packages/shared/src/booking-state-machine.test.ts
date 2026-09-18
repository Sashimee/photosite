import { describe, expect, it } from 'vitest';
import { BOOKING_STATUS_TRANSITIONS, isValidBookingTransition } from './booking-state-machine.js';
import { BOOKING_STATUSES } from './enums.js';

describe('BOOKING_STATUS_TRANSITIONS', () => {
  it('has a row for every booking status', () => {
    for (const status of BOOKING_STATUSES) {
      expect(BOOKING_STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('leaves refunded, disputed and cancelled with no outgoing transitions', () => {
    expect(BOOKING_STATUS_TRANSITIONS.refunded).toEqual([]);
    expect(BOOKING_STATUS_TRANSITIONS.disputed).toEqual([]);
    expect(BOOKING_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });
});

describe('isValidBookingTransition', () => {
  it('allows the linear happy path', () => {
    expect(isValidBookingTransition('pending_payment', 'paid_held')).toBe(true);
    expect(isValidBookingTransition('paid_held', 'in_progress')).toBe(true);
    expect(isValidBookingTransition('in_progress', 'delivered')).toBe(true);
    expect(isValidBookingTransition('delivered', 'released')).toBe(true);
  });

  it('allows cancellation only before payment', () => {
    expect(isValidBookingTransition('pending_payment', 'cancelled')).toBe(true);
    expect(isValidBookingTransition('paid_held', 'cancelled')).toBe(false);
    expect(isValidBookingTransition('in_progress', 'cancelled')).toBe(false);
  });

  it('allows refund or dispute from any state where money has moved, including after release', () => {
    for (const from of ['paid_held', 'in_progress', 'delivered', 'released'] as const) {
      expect(isValidBookingTransition(from, 'refunded')).toBe(true);
      expect(isValidBookingTransition(from, 'disputed')).toBe(true);
    }
  });

  it('rejects a refund or dispute before money has moved', () => {
    expect(isValidBookingTransition('pending_payment', 'refunded')).toBe(false);
    expect(isValidBookingTransition('pending_payment', 'disputed')).toBe(false);
  });

  it('rejects any transition out of a terminal state', () => {
    for (const from of ['refunded', 'disputed', 'cancelled'] as const) {
      for (const to of BOOKING_STATUSES) {
        expect(isValidBookingTransition(from, to)).toBe(false);
      }
    }
  });

  it('rejects skipping states in the happy path', () => {
    expect(isValidBookingTransition('pending_payment', 'in_progress')).toBe(false);
    expect(isValidBookingTransition('paid_held', 'delivered')).toBe(false);
    expect(isValidBookingTransition('paid_held', 'released')).toBe(false);
  });

  it('rejects moving backwards', () => {
    expect(isValidBookingTransition('in_progress', 'paid_held')).toBe(false);
    expect(isValidBookingTransition('released', 'delivered')).toBe(false);
  });
});
