import type { BookingStatus } from './enums.js';

// One shared table so the API, the admin app and the tests never disagree on
// what a `Booking` may transition to (docs/steps/1A.8-payments.md). The happy
// path is linear (`pending_payment -> paid_held -> in_progress -> delivered
// -> released`); `refunded` and `disputed` branch off any state where money
// has already moved (`paid_held` onward, including `released`, since a
// refund/reversal or a card dispute can both still happen after release), and
// `cancelled` only applies before payment, since money never comes from the
// client until `payment_intent.succeeded`. `refunded`, `disputed` and
// `cancelled` are terminal: no row here lists them as a source, matching the
// plan's "terminal branches" wording. Any transition not listed here is a 409
// and writes nothing.
export const BOOKING_STATUS_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> =
  {
    pending_payment: ['paid_held', 'cancelled'],
    paid_held: ['in_progress', 'refunded', 'disputed'],
    in_progress: ['delivered', 'refunded', 'disputed'],
    delivered: ['released', 'refunded', 'disputed'],
    released: ['refunded', 'disputed'],
    refunded: [],
    disputed: [],
    cancelled: [],
  };

export function isValidBookingTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_STATUS_TRANSITIONS[from].includes(to);
}
