import { describe, expect, it } from '@jest/globals';

import { apiErrorWithStatus, requestErrorMessage } from './request-errors';

const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

describe('requestErrorMessage', () => {
  it('maps 409, 422 and 429 statuses without an error code', () => {
    expect(requestErrorMessage(t, apiErrorWithStatus(undefined, 409))).toBe('errors.conflict');
    expect(requestErrorMessage(t, apiErrorWithStatus(undefined, 422))).toBe('errors.invalid');
    expect(requestErrorMessage(t, apiErrorWithStatus(undefined, 429))).toBe(
      'errors.tooManyRequests',
    );
  });

  it('uses the retry-after hint when the API supplies one', () => {
    const error = apiErrorWithStatus(
      { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 7 } },
      429,
    );
    expect(requestErrorMessage(t, error)).toBe('errors.tooManyRequestsWithRetry:{"seconds":7}');
  });

  it('keeps an explicit code over the status', () => {
    expect(apiErrorWithStatus({ code: 'FORBIDDEN' }, 409).code).toBe('FORBIDDEN');
  });

  it('falls back to the generic message for unknown failures', () => {
    expect(requestErrorMessage(t, apiErrorWithStatus(undefined, 500))).toBe('errors.generic');
    expect(requestErrorMessage(t, { code: 'WHATEVER' })).toBe('errors.generic');
  });
});
