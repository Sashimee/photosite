import { describe, expect, it, vi } from 'vitest';

import { apiErrorMessage } from './api-errors';

describe('apiErrorMessage', () => {
  it('returns the fallback when there is no error', () => {
    const t = vi.fn((key: string) => key);
    expect(apiErrorMessage(t, 'generic', undefined)).toBe('generic');
  });

  it('returns the fallback for a codeless error', () => {
    const t = vi.fn((key: string) => key);
    expect(apiErrorMessage(t, 'generic', { message: 'boom' })).toBe('generic');
  });

  it('returns the fallback for an unmapped code', () => {
    const t = vi.fn((key: string) => key);
    expect(apiErrorMessage(t, 'generic', { code: 'SOME_UNKNOWN_CODE' })).toBe('generic');
  });

  it('maps a known error code to its translation key', () => {
    const t = vi.fn((key: string) => key);
    expect(apiErrorMessage(t, 'generic', { code: 'FORBIDDEN' })).toBe('errors.forbidden');
    expect(apiErrorMessage(t, 'generic', { code: 'NOT_FOUND' })).toBe('errors.notFound');
    expect(apiErrorMessage(t, 'generic', { code: 'VALIDATION_ERROR' })).toBe('errors.invalid');
    expect(apiErrorMessage(t, 'generic', { code: 'UNPROCESSABLE_ENTITY' })).toBe('errors.invalid');
    expect(apiErrorMessage(t, 'generic', { code: 'CONFLICT' })).toBe('errors.conflict');
  });
});
