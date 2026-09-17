import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

describe('slugify', () => {
  it('ASCII-folds, lowercases and hyphenates the value', () => {
    expect(slugify('Jàne Döe Photography')).toBe('jane-doe-photography');
  });

  it('truncates to 60 characters by default', () => {
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(60);
  });

  it('truncates to a custom maxLength', () => {
    expect(slugify('abcdefghij', { maxLength: 5 })).toBe('abcde');
  });

  it('falls back to the default base when shorter than the minimum length', () => {
    expect(slugify('ab')).toBe('photographer');
  });

  it('falls back to a custom base when provided', () => {
    expect(slugify('ab', { fallback: 'city' })).toBe('city');
  });

  it('accepts a value shorter than the default minimum with a lower minLength', () => {
    expect(slugify('ab', { minLength: 1 })).toBe('ab');
  });

  it('falls back when the value has no ASCII letters', () => {
    expect(slugify('日本語')).toBe('photographer');
  });
});
