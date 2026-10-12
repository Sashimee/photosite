import type { TFunction } from 'i18next';

import { authErrorMessage, scopedAuthTranslate, type ApiErrorLike } from './auth-errors';

export function twoFactorErrorMessage(t: TFunction, error: ApiErrorLike | undefined): string {
  if (error?.code === 'INVALID_PASSWORD') {
    return t('mobile.account.twoFactor.errors.invalidPassword');
  }
  return authErrorMessage(scopedAuthTranslate(t), error);
}
