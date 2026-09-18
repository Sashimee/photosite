import type { TFunction } from 'i18next';

export interface ApiErrorLike {
  code?: string;
  message?: string;
  details?: unknown;
}

const ERROR_CODE_KEYS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'invalidCredentials',
  INVALID_PASSWORD: 'invalidCredentials',
  USER_NOT_FOUND: 'invalidCredentials',
  USER_ALREADY_EXISTS: 'emailTaken',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'emailTaken',
  EMAIL_NOT_VERIFIED: 'emailNotVerified',
  INVALID_TOKEN: 'invalidToken',
  TOKEN_EXPIRED: 'tokenExpired',
  PASSWORD_TOO_SHORT: 'passwordTooShort',
  PASSWORD_TOO_LONG: 'passwordTooLong',
  PASSWORD_COMPROMISED: 'passwordCompromised',
  INVALID_CODE: 'invalidCode',
  INVALID_BACKUP_CODE: 'invalidBackupCode',
  TOTP_ALREADY_ENABLED: 'totpAlreadyEnabled',
  TWO_FACTOR_NOT_ENABLED: 'twoFactorNotEnabled',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'tooManyAttempts',
  ACCOUNT_TEMPORARILY_LOCKED: 'accountLocked',
  ROLE_ALREADY_ASSIGNED: 'roleAlreadyAssigned',
  VALIDATION_ERROR: 'validationError',
  FORBIDDEN: 'forbidden',
  UNAUTHORIZED: 'unauthorized',
  NOT_FOUND: 'notFound',
  PROVIDER_NOT_CONFIGURED: 'providerNotConfigured',
};

function retryAfterSeconds(details: unknown): number | undefined {
  if (typeof details !== 'object' || details === null || !('retryAfterSeconds' in details)) {
    return undefined;
  }
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

// Scopes a react-i18next `t` to the `mobile.auth` namespace for authErrorMessage,
// forwarding `values` only when present (react-i18next's overloads reject an
// explicit `undefined` under exactOptionalPropertyTypes).
export function scopedAuthTranslate(t: TFunction): TranslateFn {
  return (key, values) => (values ? t(`mobile.auth.${key}`, values) : t(`mobile.auth.${key}`));
}

// Maps an ApiError from the API onto a translated, enumeration-safe message.
// `t` is expected to be scoped to the `mobile.auth` namespace (its `errors.*`
// keys); see packages/i18n/messages/en.json. Mirrors apps/web's auth-errors.ts.
export function authErrorMessage(t: TranslateFn, error: ApiErrorLike | undefined): string {
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
