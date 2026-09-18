import { describe, expect, it } from '@jest/globals';

import { authErrorMessage, type TranslateFn } from './auth-errors';

const t: TranslateFn = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);

describe('authErrorMessage', () => {
  it('falls back to the generic message when there is no error code', () => {
    expect(authErrorMessage(t, undefined)).toBe('errors.generic');
  });

  it('maps a lockout to its own message', () => {
    expect(authErrorMessage(t, { code: 'ACCOUNT_TEMPORARILY_LOCKED' })).toBe(
      'errors.accountLocked',
    );
  });

  it('maps a rate limit without a retry hint to the generic too-many-requests message', () => {
    expect(authErrorMessage(t, { code: 'TOO_MANY_REQUESTS' })).toBe('errors.tooManyRequests');
  });

  it('maps a rate limit with a retry hint to the message including seconds', () => {
    expect(
      authErrorMessage(t, { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 30 } }),
    ).toBe('errors.tooManyRequestsWithRetry:{"seconds":30}');
  });

  it('ignores a non-numeric retryAfterSeconds', () => {
    expect(
      authErrorMessage(t, { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 'soon' } }),
    ).toBe('errors.tooManyRequests');
  });

  it('maps an unknown code to the generic message', () => {
    expect(authErrorMessage(t, { code: 'SOMETHING_NEW' })).toBe('errors.generic');
  });

  it('maps invalid credentials, invalid code and invalid backup code', () => {
    expect(authErrorMessage(t, { code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe(
      'errors.invalidCredentials',
    );
    expect(authErrorMessage(t, { code: 'INVALID_CODE' })).toBe('errors.invalidCode');
    expect(authErrorMessage(t, { code: 'INVALID_BACKUP_CODE' })).toBe('errors.invalidBackupCode');
  });
});
