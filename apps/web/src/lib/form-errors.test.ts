import { describe, expect, it, vi } from 'vitest';

import { fieldErrorMessage } from './form-errors';

describe('fieldErrorMessage', () => {
  it('returns undefined when there is no error', () => {
    const t = vi.fn((key: string) => key);
    expect(fieldErrorMessage(t, undefined)).toBeUndefined();
    expect(t).not.toHaveBeenCalled();
  });

  it('maps known zod issue types to a translation key', () => {
    const t = vi.fn((key: string) => key);
    expect(fieldErrorMessage(t, { type: 'invalid_type' })).toBe('validation.required');
    expect(fieldErrorMessage(t, { type: 'too_small' })).toBe('validation.tooShort');
    expect(fieldErrorMessage(t, { type: 'too_big' })).toBe('validation.tooLong');
    expect(fieldErrorMessage(t, { type: 'invalid_format' })).toBe('validation.invalidFormat');
    expect(fieldErrorMessage(t, { type: 'custom' })).toBe('validation.invalid');
  });

  it('falls back to a generic invalid message for an unknown issue type', () => {
    const t = vi.fn((key: string) => key);
    expect(fieldErrorMessage(t, { type: 'unrecognised' })).toBe('validation.invalid');
    expect(fieldErrorMessage(t, {})).toBe('validation.invalid');
  });
});
