export interface ApiErrorLike {
  code?: string;
  message?: string;
  details?: unknown;
}

const ERROR_CODE_KEYS: Record<string, string> = {
  CONFLICT: 'conflict',
  UNPROCESSABLE_ENTITY: 'invalid',
  VALIDATION_ERROR: 'invalid',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
};

function retryAfterSeconds(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null || !('retryAfterSeconds' in details)) {
    return undefined;
  }
  const value = details.retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export type TranslateFn = (key: string, values?: Record<string, string | number | Date>) => string;

// Maps an ApiError from the requests/quotes API onto a translated message.
// `t` is expected to be scoped to `web.requests` or `web.quotes` (their
// `errors.*` keys); see packages/i18n/messages/en.json. Every business-rule
// failure the API can throw for these endpoints uses one of these generic
// codes (see apps/api/src/modules/{requests,quotes}), never a field-specific
// one, so unlike auth there's no larger enumeration to map here.
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
