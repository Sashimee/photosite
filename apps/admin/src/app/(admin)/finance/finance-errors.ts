import { apiErrorMessage, type ApiErrorLike } from '@/lib/api-errors';
import type { TranslateFn } from '@/lib/auth-errors';

// `tFinance` is scoped to `admin.finance`, `tAction` to the dialog's own
// namespace (`admin.finance.refund` / `.reverse`) for its `errors.unprocessable`.
export function financeErrorMessage(
  tFinance: TranslateFn,
  tAction: TranslateFn,
  error: ApiErrorLike | undefined,
): string {
  if (error?.code === 'TOO_MANY_REQUESTS') {
    return tFinance('errors.tooManyRequests');
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
