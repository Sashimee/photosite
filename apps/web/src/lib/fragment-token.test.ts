import { describe, expect, it } from 'vitest';

import { parseFragmentToken } from './fragment-token';

describe('parseFragmentToken', () => {
  it('extracts the token from a hash with a leading #', () => {
    expect(parseFragmentToken('#token=abc123')).toBe('abc123');
  });

  it('extracts the token from a hash value without a leading #', () => {
    expect(parseFragmentToken('token=abc123')).toBe('abc123');
  });

  it('returns null for an empty hash', () => {
    expect(parseFragmentToken('')).toBeNull();
    expect(parseFragmentToken('#')).toBeNull();
  });

  it('returns null when there is no token parameter', () => {
    expect(parseFragmentToken('#foo=bar')).toBeNull();
  });

  it('returns null for an empty token value', () => {
    expect(parseFragmentToken('#token=')).toBeNull();
  });

  it('decodes a percent-encoded token', () => {
    expect(parseFragmentToken('#token=a%2Fb%3Dc')).toBe('a/b=c');
  });
});
