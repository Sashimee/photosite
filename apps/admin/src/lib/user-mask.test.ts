import { describe, expect, it } from 'vitest';

import { maskEmail } from './user-mask';

describe('maskEmail', () => {
  it('keeps the first character of the local part and masks the rest', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
  });

  it('keeps the whole domain visible', () => {
    expect(maskEmail('bob@sub.example.co.uk')).toBe('b***@sub.example.co.uk');
  });

  it('handles a single-character local part', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
  });

  it('returns the input unchanged when there is no "@"', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});
