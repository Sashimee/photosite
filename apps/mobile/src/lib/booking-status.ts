import type { components } from '@photoo/api-client';

type GeneratedBooking = components['schemas']['Booking'];

// The generated `location` intersects `LatLng` with `Record<string, never> | null`,
// which a plain `{ lat, lng }` never satisfies; the API sends exactly that shape.
export type Booking = Omit<GeneratedBooking, 'location'> & {
  location: { lat: number; lng: number } | null;
};
export type BookingStatus = GeneratedBooking['status'];

export const BOOKING_MAIN_STEPS: readonly BookingStatus[] = [
  'pending_payment',
  'paid_held',
  'in_progress',
  'delivered',
  'released',
];

export const BOOKING_SIDE_EXITS: readonly BookingStatus[] = ['cancelled', 'refunded', 'disputed'];

const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
  'released',
  'refunded',
  'cancelled',
  'disputed',
];
const DELIVERABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['paid_held', 'in_progress'];
const ACCEPTABLE_DELIVERY_STATUSES: readonly BookingStatus[] = ['delivered'];
const REFUNDABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  'paid_held',
  'in_progress',
  'delivered',
];
const CANCELLABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['pending_payment'];
const DOCUMENT_AVAILABLE_STATUSES: readonly BookingStatus[] = ['released'];

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}

export function canDeliver(status: BookingStatus): boolean {
  return DELIVERABLE_BOOKING_STATUSES.includes(status);
}

export function canAcceptDelivery(status: BookingStatus): boolean {
  return ACCEPTABLE_DELIVERY_STATUSES.includes(status);
}

export function canRequestRefund(status: BookingStatus): boolean {
  return REFUNDABLE_BOOKING_STATUSES.includes(status);
}

export function canCancel(status: BookingStatus): boolean {
  return CANCELLABLE_BOOKING_STATUSES.includes(status);
}

export function areDocumentsAvailable(status: BookingStatus): boolean {
  return DOCUMENT_AVAILABLE_STATUSES.includes(status);
}
