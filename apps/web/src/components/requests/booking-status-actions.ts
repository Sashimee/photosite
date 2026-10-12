import type { BookingStatus } from '@photoo/shared';

const DELIVERABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['paid_held', 'in_progress'];
const ACCEPTABLE_DELIVERY_STATUSES: readonly BookingStatus[] = ['delivered'];
const REFUNDABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  'paid_held',
  'in_progress',
  'delivered',
];
const CANCELLABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['pending_payment'];
const DOCUMENT_AVAILABLE_STATUSES: readonly BookingStatus[] = ['released'];

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
