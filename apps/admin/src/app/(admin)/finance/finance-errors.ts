import { BOOKING_STATUSES } from '@photoo/shared';

import { apiErrorMessage, type ApiErrorLike } from '@/lib/api-errors';
import type { TranslateFn } from '@/lib/auth-errors';

// `tFinance` is scoped to `admin.finance`, `tAction` to the dialog's own
// namespace (`admin.finance.refund` / `.reverse`) for its `errors.unprocessable`.
function detailValue(details: unknown, key: string): unknown {
  return typeof details === 'object' && details !== null && key in details
    ? (details as Record<string, unknown>)[key]
    : undefined;
}

export function pendingReversalCents(error: ApiErrorLike | undefined): number | undefined {
  if (error?.code !== 'PENDING_REVERSAL_MISMATCH') {
    return undefined;
  }
  const value = detailValue(error.details, 'pendingCents');
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function financeErrorMessage(
  tFinance: TranslateFn,
  tAction: TranslateFn,
  error: ApiErrorLike | undefined,
  formatPending?: (cents: number) => string,
): string {
  if (error?.code === 'TOO_MANY_REQUESTS') {
    return tFinance('errors.tooManyRequests');
  }
  if (error?.code === 'LEDGER_CHANGED') {
    return tFinance('errors.ledgerChanged');
  }
  if (error?.code === 'BOOKING_BUSY') {
    return tFinance('errors.bookingBusy');
  }
  if (error?.code === 'BOOKING_STATE') {
    const status = detailValue(error.details, 'status');
    const known = BOOKING_STATUSES.find((value) => value === status);
    return known
      ? tFinance('errors.bookingState', { status: tFinance(`statuses.${known}`) })
      : tFinance('errors.conflict');
  }
  if (error?.code === 'PENDING_REVERSAL_MISMATCH') {
    const pending = pendingReversalCents(error);
    return pending !== undefined && formatPending
      ? tFinance('errors.pendingReversalMismatch', { amount: formatPending(pending) })
      : tFinance('errors.conflict');
  }
  if (error?.code === 'CONFLICT') {
    return tAction('errors.conflict', { detail: error.message ?? '' });
  }
  if (error?.code === 'UNPROCESSABLE_ENTITY') {
    return tAction('errors.unprocessable');
  }
  return apiErrorMessage(tFinance, tFinance('errors.generic'), error);
}

export function isUnknownOutcome(response: { status: number }): boolean {
  return response.status >= 500;
}
