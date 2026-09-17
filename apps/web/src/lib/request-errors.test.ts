import { describe, expect, it, vi } from 'vitest';

import { requestErrorMessage } from './request-errors';

describe('requestErrorMessage', () => {
  it('falls back to a generic message when there is no error', () => {
    const t = vi.fn((key: string) => key);
    expect(requestErrorMessage(t, undefined)).toBe('errors.generic');
  });

  it('falls back to a generic message for an unmapped code', () => {
    const t = vi.fn((key: string) => key);
    expect(requestErrorMessage(t, { code: 'SOME_UNKNOWN_CODE' })).toBe('errors.generic');
  });

  it('maps 409 conflicts, 422 validation and 403/404 to their translation keys', () => {
    const t = vi.fn((key: string) => key);
    expect(requestErrorMessage(t, { code: 'CONFLICT' })).toBe('errors.conflict');
    expect(requestErrorMessage(t, { code: 'UNPROCESSABLE_ENTITY' })).toBe('errors.invalid');
    expect(requestErrorMessage(t, { code: 'FORBIDDEN' })).toBe('errors.forbidden');
    expect(requestErrorMessage(t, { code: 'NOT_FOUND' })).toBe('errors.notFound');
  });

  it('shows the retry time for a rate-limited (429) request', () => {
    const t = vi.fn((key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    );
    expect(
      requestErrorMessage(t, { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 30 } }),
    ).toBe('errors.tooManyRequestsWithRetry:{"seconds":30}');
  });

  it('falls back to a generic rate-limit message with no retry detail', () => {
    const t = vi.fn((key: string) => key);
    expect(requestErrorMessage(t, { code: 'TOO_MANY_REQUESTS' })).toBe('errors.tooManyRequests');
    expect(
      requestErrorMessage(t, { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 'soon' } }),
    ).toBe('errors.tooManyRequests');
  });
});
