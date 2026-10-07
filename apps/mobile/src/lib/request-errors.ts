import type { TFunction } from 'i18next';

import { retryAfterSeconds, type ApiErrorLike, type TranslateFn } from './auth-errors';

const ERROR_CODE_KEYS: Record<string, string> = {
  CONFLICT: 'conflict',
  BOOKING_BUSY: 'conflict',
  UNPROCESSABLE_ENTITY: 'invalid',
  VALIDATION_ERROR: 'invalid',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
};

export function requestErrorMessage(t: TranslateFn, error: ApiErrorLike | undefined): string {
  if (!error?.code) {
    return t('errors.generic');
  }

  if (error.code === 'TOO_MANY_REQUESTS') {
    const seconds = retryAfterSeconds(error.details);
    return seconds === undefined
      ? t('errors.tooManyRequests')
      : t('errors.tooManyRequestsWithRetry', { seconds });
  }

  const key = ERROR_CODE_KEYS[error.code];
  return key ? t(`errors.${key}`) : t('errors.generic');
}

const STATUS_CODES: Record<number, string> = {
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
};

export function apiErrorWithStatus(error: ApiErrorLike | undefined, status: number): ApiErrorLike {
  const code = error?.code ?? STATUS_CODES[status];
  return { ...error, ...(code ? { code } : {}) };
}

export function scopedRequestTranslate(t: TFunction): TranslateFn {
  return (key, values) =>
    values ? t(`mobile.requests.${key}`, values) : t(`mobile.requests.${key}`);
}

export function scopedQuoteTranslate(t: TFunction): TranslateFn {
  return (key, values) => (values ? t(`mobile.quotes.${key}`, values) : t(`mobile.quotes.${key}`));
}
