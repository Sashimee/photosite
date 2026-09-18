import { describe, expect, it } from 'vitest';
import { calculatePlatformFee, quoteTotals } from './fee.js';

describe('calculatePlatformFee', () => {
  it('rounds .5 up per PAYMENTS.md (round half up)', () => {
    expect(calculatePlatformFee(1050, 5)).toBe(53);
    expect(calculatePlatformFee(101, 50)).toBe(51);
  });

  it('computes an exact percentage without rounding', () => {
    expect(calculatePlatformFee(150, 50)).toBe(75);
  });

  it('returns zero for a zero subtotal', () => {
    expect(calculatePlatformFee(0, 5)).toBe(0);
  });

  it('returns zero for a zero fee percent', () => {
    expect(calculatePlatformFee(100_000, 0)).toBe(0);
  });

  it('handles large values', () => {
    expect(calculatePlatformFee(1_000_000_00, 5)).toBe(5_000_000);
  });

  it('rejects a non-integer subtotal', () => {
    expect(() => calculatePlatformFee(100.5, 5)).toThrow(RangeError);
  });

  it('rejects a negative subtotal', () => {
    expect(() => calculatePlatformFee(-100, 5)).toThrow(RangeError);
  });

  it('rejects a fee percent below 0', () => {
    expect(() => calculatePlatformFee(1000, -1)).toThrow(RangeError);
  });

  it('rejects a fee percent above 100', () => {
    expect(() => calculatePlatformFee(1000, 101)).toThrow(RangeError);
  });

  it('rejects a non-finite fee percent', () => {
    expect(() => calculatePlatformFee(1000, Number.NaN)).toThrow(RangeError);
    expect(() => calculatePlatformFee(1000, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('calculatePlatformFee with VAT on the fee', () => {
  it('is off by default: passing no options matches passing an empty object', () => {
    expect(calculatePlatformFee(1000, 5)).toBe(calculatePlatformFee(1000, 5, {}));
  });

  it('leaves the fee unchanged when vatOnFeeRatePercent is 0', () => {
    expect(calculatePlatformFee(1000, 5, { vatOnFeeRatePercent: 0 })).toBe(
      calculatePlatformFee(1000, 5),
    );
  });

  it('applies VAT on top of the base fee', () => {
    // baseFee = round(2000 * 5 / 100) = 100; 100 * 1.17 = 117 exactly.
    expect(calculatePlatformFee(2000, 5, { vatOnFeeRatePercent: 17 })).toBe(117);
  });

  it('rounds half up at exactly .5 cents after VAT is applied', () => {
    // baseFee = round(1000 * 5 / 100) = 50; 50 * 1.01 = 50.5 exactly, which
    // must round up to 51, not down to 50 (banker's rounding is not used).
    expect(calculatePlatformFee(1000, 5, { vatOnFeeRatePercent: 1 })).toBe(51);
  });

  it('rejects a negative vatOnFeeRatePercent', () => {
    expect(() => calculatePlatformFee(1000, 5, { vatOnFeeRatePercent: -1 })).toThrow(RangeError);
  });

  it('rejects a non-finite vatOnFeeRatePercent', () => {
    expect(() => calculatePlatformFee(1000, 5, { vatOnFeeRatePercent: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('quoteTotals', () => {
  it('sums line items into a subtotal and computes the fee', () => {
    const totals = quoteTotals(
      [
        { label: 'Session', qty: 1, unitCents: 1050 },
        { label: 'Extra edits', qty: 2, unitCents: 500 },
      ],
      5,
    );

    expect(totals).toEqual({
      subtotalCents: 2050,
      platformFeeCents: 103,
      totalCents: 2050,
    });
  });

  it('sets totalCents equal to subtotalCents (fee deducted from the payout, not added on top)', () => {
    const totals = quoteTotals([{ label: 'Session', qty: 1, unitCents: 100_00 }], 5);
    expect(totals.totalCents).toBe(totals.subtotalCents);
  });

  it('returns zero totals for an empty list of line items', () => {
    expect(quoteTotals([], 5)).toEqual({ subtotalCents: 0, platformFeeCents: 0, totalCents: 0 });
  });

  it('handles large values', () => {
    const totals = quoteTotals(
      [{ label: 'Full year retainer', qty: 1, unitCents: 1_000_000_00 }],
      5,
    );
    expect(totals).toEqual({
      subtotalCents: 1_000_000_00,
      platformFeeCents: 5_000_000,
      totalCents: 1_000_000_00,
    });
  });

  it('rejects a non-positive quantity', () => {
    expect(() => quoteTotals([{ label: 'Session', qty: 0, unitCents: 100 }], 5)).toThrow(
      RangeError,
    );
    expect(() => quoteTotals([{ label: 'Session', qty: -1, unitCents: 100 }], 5)).toThrow(
      RangeError,
    );
  });

  it('rejects a negative unit price', () => {
    expect(() => quoteTotals([{ label: 'Session', qty: 1, unitCents: -1 }], 5)).toThrow(RangeError);
  });

  it('rejects an invalid fee percent', () => {
    expect(() => quoteTotals([{ label: 'Session', qty: 1, unitCents: 100 }], 200)).toThrow(
      RangeError,
    );
  });

  it('passes the VAT-on-fee option through to platformFeeCents', () => {
    const totals = quoteTotals([{ label: 'Session', qty: 1, unitCents: 2000 }], 5, {
      vatOnFeeRatePercent: 17,
    });
    expect(totals.platformFeeCents).toBe(117);
  });
});
