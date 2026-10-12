import type { BookingStatus, QuoteStatus, RequestStatus } from '@photoo/shared';

import { cn } from '@/lib/utils';

const TERMINAL_REQUEST_STATUSES: readonly RequestStatus[] = ['closed', 'cancelled'];
const TERMINAL_QUOTE_STATUSES: readonly QuoteStatus[] = ['declined', 'expired', 'withdrawn'];
const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
  'released',
  'refunded',
  'cancelled',
  'disputed',
];

export function isTerminalRequestStatus(status: RequestStatus): boolean {
  return TERMINAL_REQUEST_STATUSES.includes(status);
}

export function isTerminalQuoteStatus(status: QuoteStatus): boolean {
  return TERMINAL_QUOTE_STATUSES.includes(status);
}

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return TERMINAL_BOOKING_STATUSES.includes(status);
}

export function StatusBadge({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        muted
          ? 'border border-border text-muted-foreground'
          : 'bg-secondary text-secondary-foreground',
      )}
    >
      {label}
    </span>
  );
}
