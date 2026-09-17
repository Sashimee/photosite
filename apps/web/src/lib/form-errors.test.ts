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
    expect(fieldErrorMessage(t, { type: 'invalid_type' })).toBe('required');
    expect(fieldErrorMessage(t, { type: 'too_small' })).toBe('tooShort');
    expect(fieldErrorMessage(t, { type: 'too_big' })).toBe('tooLong');
    expect(fieldErrorMessage(t, { type: 'invalid_format' })).toBe('invalidFormat');
    expect(fieldErrorMessage(t, { type: 'custom' })).toBe('invalid');
  });

  it('falls back to a generic invalid message for an unknown issue type', () => {
    const t = vi.fn((key: string) => key);
    expect(fieldErrorMessage(t, { type: 'unrecognised' })).toBe('invalid');
    expect(fieldErrorMessage(t, {})).toBe('invalid');
  });
});
