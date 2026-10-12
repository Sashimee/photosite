import { describe, expect, it } from 'vitest';

import { parseAmountToCents } from './booking-refund-dialog-helpers';

describe('parseAmountToCents', () => {
  it('returns null for an empty input', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('   ')).toBeNull();
  });

  it('returns null for zero', () => {
    expect(parseAmountToCents('0')).toBeNull();
    expect(parseAmountToCents('0.00')).toBeNull();
  });

  it('returns null for negative numbers', () => {
    expect(parseAmountToCents('-5')).toBeNull();
    expect(parseAmountToCents('-5.50')).toBeNull();
  });

  it('returns null for more than 2 decimal places', () => {
    expect(parseAmountToCents('10.123')).toBeNull();
    expect(parseAmountToCents('10.999')).toBeNull();
  });

  it('returns null for a dangling decimal separator', () => {
    expect(parseAmountToCents('10.')).toBeNull();
    expect(parseAmountToCents('10,')).toBeNull();
  });

  it('returns null for a decimal separator with no leading digit', () => {
    expect(parseAmountToCents('.5')).toBeNull();
    expect(parseAmountToCents(',5')).toBeNull();
  });

  it('returns null for internal whitespace', () => {
    expect(parseAmountToCents('1 2')).toBeNull();
    expect(parseAmountToCents('12. 50')).toBeNull();
  });

  it('trims surrounding whitespace around a valid amount', () => {
    expect(parseAmountToCents('  12.50  ')).toBe(1250);
  });

  it('accepts a comma decimal separator', () => {
    expect(parseAmountToCents('12,50')).toBe(1250);
    expect(parseAmountToCents('12,5')).toBe(1250);
  });

  it('converts large values correctly', () => {
    expect(parseAmountToCents('123456.78')).toBe(12345678);
    expect(parseAmountToCents('1000000')).toBe(100000000);
    expect(parseAmountToCents('9999999999.99')).toBe(999999999999);
  });

  it('converts plain whole numbers and simple decimals', () => {
    expect(parseAmountToCents('10')).toBe(1000);
    expect(parseAmountToCents('10.5')).toBe(1050);
    expect(parseAmountToCents('10.05')).toBe(1005);
  });

  it('rejects non-numeric input', () => {
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('10abc')).toBeNull();
  });
});
