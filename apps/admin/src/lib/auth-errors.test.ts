import { describe, expect, it, vi } from 'vitest';

import { authErrorMessage } from './auth-errors';

describe('authErrorMessage', () => {
  it('falls back to a generic message when there is no error', () => {
    const t = vi.fn((key: string) => key);
    expect(authErrorMessage(t, undefined)).toBe('errors.generic');
  });

  it('falls back to a generic message for an unmapped code', () => {
    const t = vi.fn((key: string) => key);
    expect(authErrorMessage(t, { code: 'SOME_UNKNOWN_CODE' })).toBe('errors.generic');
  });

  it('maps a known error code to its translation key', () => {
    const t = vi.fn((key: string) => key);
    expect(authErrorMessage(t, { code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe(
      'errors.invalidCredentials',
    );
    expect(authErrorMessage(t, { code: 'USER_ALREADY_EXISTS' })).toBe('errors.emailTaken');
    expect(authErrorMessage(t, { code: 'INVALID_CODE' })).toBe('errors.invalidCode');
  });

  it('shows the retry time for a rate-limited request', () => {
    const t = vi.fn((key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    );
    expect(
      authErrorMessage(t, { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 42 } }),
    ).toBe('errors.tooManyRequestsWithRetry:{"seconds":42}');
  });

  it('falls back to a generic rate-limit message with no retry detail', () => {
    const t = vi.fn((key: string) => key);
    expect(authErrorMessage(t, { code: 'TOO_MANY_REQUESTS' })).toBe('errors.tooManyRequests');
    expect(authErrorMessage(t, { code: 'TOO_MANY_REQUESTS', details: { foo: 'bar' } })).toBe(
      'errors.tooManyRequests',
    );
    expect(
      authErrorMessage(t, { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 'soon' } }),
    ).toBe('errors.tooManyRequests');
  });
});
