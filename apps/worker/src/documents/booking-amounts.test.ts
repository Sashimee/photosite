import { calculatePlatformFee, payoutAmount } from '@photoo/shared';
import { describe, expect, it } from 'vitest';
import { deriveBookingAmounts, type LedgerRow, type QuoteSnapshot } from './booking-amounts.js';

const quote: QuoteSnapshot = {
  subtotalCents: 12_345,
  totalCents: 12_345,
  feePercent: 5,
  currency: 'EUR',
};

const FEE = calculatePlatformFee(quote.subtotalCents, quote.feePercent);

function released(extra: LedgerRow[] = [], refundedBeforeRelease = 0): LedgerRow[] {
  return [
    { type: 'charge', amountCents: quote.totalCents, currency: 'EUR' },
    ...(refundedBeforeRelease > 0
      ? [{ type: 'refund' as const, amountCents: -refundedBeforeRelease, currency: 'EUR' }]
      : []),
    {
      type: 'transfer',
      amountCents: -(quote.subtotalCents - FEE - refundedBeforeRelease),
      currency: 'EUR',
    },
    { type: 'platform_fee', amountCents: -FEE, currency: 'EUR' },
    ...extra,
  ];
}

describe('deriveBookingAmounts', () => {
  it('matches the quote payout to the cent when nothing was refunded', () => {
    const amounts = deriveBookingAmounts('b1', quote, released(), 17);

    expect(FEE).toBe(617);
    expect(amounts).toEqual({
      currency: 'EUR',
      chargedCents: 12_345,
      refundedCents: 0,
      netPaidCents: 12_345,
      baseFeeCents: 617,
      vatOnFeeCents: 0,
      vatOnFeeRatePercent: null,
      feeCents: 617,
      transferredCents: 11_728,
      reversedCents: 0,
      payoutCents: 11_728,
    });
    expect(amounts.payoutCents).toBe(
      payoutAmount({ subtotalCents: quote.subtotalCents, platformFeeCents: FEE }),
    );
  });

  it('takes a refund before release out of the transfer, keeping the fee', () => {
    const amounts = deriveBookingAmounts('b1', quote, released([], 2_000), 17);

    expect(amounts.refundedCents).toBe(2_000);
    expect(amounts.netPaidCents).toBe(10_345);
    expect(amounts.feeCents).toBe(617);
    expect(amounts.transferredCents).toBe(9_728);
    expect(amounts.reversedCents).toBe(0);
    expect(amounts.payoutCents).toBe(9_728);
  });

  it('nets a refund after release against the reversal of the transfer', () => {
    const amounts = deriveBookingAmounts(
      'b1',
      quote,
      released([
        { type: 'reversal', amountCents: 1_500, currency: 'EUR' },
        { type: 'refund', amountCents: -1_500, currency: 'EUR' },
      ]),
      17,
    );

    expect(amounts.refundedCents).toBe(1_500);
    expect(amounts.transferredCents).toBe(11_728);
    expect(amounts.reversedCents).toBe(1_500);
    expect(amounts.payoutCents).toBe(10_228);
    expect(amounts.netPaidCents - amounts.feeCents).toBe(amounts.payoutCents);
  });

  it('splits VAT on the fee out of the ledger fee with the country rate', () => {
    const vatQuote: QuoteSnapshot = {
      subtotalCents: 2_000,
      totalCents: 2_000,
      feePercent: 5,
      currency: 'eur',
    };
    const fee = calculatePlatformFee(2_000, 5, { vatOnFeeRatePercent: 17 });
    const amounts = deriveBookingAmounts(
      'b1',
      vatQuote,
      [
        { type: 'charge', amountCents: 2_000, currency: 'eur' },
        { type: 'transfer', amountCents: -(2_000 - fee), currency: 'eur' },
        { type: 'platform_fee', amountCents: -fee, currency: 'eur' },
      ],
      17,
    );

    expect(fee).toBe(117);
    expect(amounts.currency).toBe('EUR');
    expect(amounts.baseFeeCents).toBe(100);
    expect(amounts.vatOnFeeCents).toBe(17);
    expect(amounts.vatOnFeeRatePercent).toBe(17);
    expect(amounts.feeCents).toBe(117);
    expect(amounts.payoutCents).toBe(1_883);
  });

  it('rounds a sub-cent base fee half up before comparing', () => {
    const tiny: QuoteSnapshot = {
      subtotalCents: 1_010,
      totalCents: 1_010,
      feePercent: 5,
      currency: 'EUR',
    };
    const amounts = deriveBookingAmounts(
      'b1',
      tiny,
      [
        { type: 'charge', amountCents: 1_010, currency: 'EUR' },
        { type: 'transfer', amountCents: -959, currency: 'EUR' },
        { type: 'platform_fee', amountCents: -51, currency: 'EUR' },
      ],
      0,
    );

    expect(amounts.baseFeeCents).toBe(51);
    expect(amounts.vatOnFeeCents).toBe(0);
    expect(amounts.payoutCents).toBe(959);
  });

  it('throws when the ledger does not balance', () => {
    expect(() =>
      deriveBookingAmounts(
        'b1',
        quote,
        released([{ type: 'reversal', amountCents: 1_500, currency: 'EUR' }]),
        17,
      ),
    ).toThrow(/does not balance/);
  });

  it('throws when the charge differs from the quote total', () => {
    const rows = released().map((row) =>
      row.type === 'charge' ? { ...row, amountCents: row.amountCents - 1 } : row,
    );
    expect(() => deriveBookingAmounts('b1', quote, rows, 17)).toThrow(/quote total/);
  });

  it('throws when there is no transfer yet', () => {
    expect(() =>
      deriveBookingAmounts(
        'b1',
        quote,
        [{ type: 'charge', amountCents: quote.totalCents, currency: 'EUR' }],
        17,
      ),
    ).toThrow(/no transfer/);
  });

  it('throws when a ledger row is in another currency', () => {
    const rows = released().map((row) =>
      row.type === 'platform_fee' ? { ...row, currency: 'USD' } : row,
    );
    expect(() => deriveBookingAmounts('b1', quote, rows, 17)).toThrow(/in USD/);
  });

  it('throws when the fee is below the base fee', () => {
    const rows: LedgerRow[] = [
      { type: 'charge', amountCents: quote.totalCents, currency: 'EUR' },
      { type: 'transfer', amountCents: -(quote.subtotalCents - 600), currency: 'EUR' },
      { type: 'platform_fee', amountCents: -600, currency: 'EUR' },
    ];
    expect(() => deriveBookingAmounts('b1', quote, rows, 17)).toThrow(/below/);
  });

  it('throws when the extra fee is not VAT at the country rate', () => {
    const rows: LedgerRow[] = [
      { type: 'charge', amountCents: quote.totalCents, currency: 'EUR' },
      { type: 'transfer', amountCents: -(quote.subtotalCents - 700), currency: 'EUR' },
      { type: 'platform_fee', amountCents: -700, currency: 'EUR' },
    ];
    expect(() => deriveBookingAmounts('b1', quote, rows, 17)).toThrow(/neither the base fee/);
  });
});
