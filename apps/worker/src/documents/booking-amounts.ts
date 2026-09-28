import { calculatePlatformFee, type LedgerEntryType } from '@photoo/shared';

export interface LedgerRow {
  type: LedgerEntryType;
  amountCents: number;
  currency: string;
  occurredAt: Date;
}

export interface QuoteSnapshot {
  subtotalCents: number;
  totalCents: number;
  feePercent: number;
  currency: string;
}

export interface BookingAmounts {
  currency: string;
  chargedCents: number;
  refundedCents: number;
  netPaidCents: number;
  baseFeeCents: number;
  vatOnFeeCents: number;
  vatOnFeeRatePercent: number | null;
  feeCents: number;
  transferredCents: number;
  reversedCents: number;
  payoutCents: number;
}

function sumOf(rows: readonly LedgerRow[], type: LedgerEntryType, sign: 1 | -1 = 1): number {
  return rows
    .filter((row) => row.type === type)
    .reduce((sum, row) => sum + sign * row.amountCents, 0);
}

// Every figure on the receipt and the fee invoice comes from the ledger, the
// record of what Stripe actually moved, never from payoutAmount(quote): a
// refund before release shrinks the transfer. The documents describe the
// booking as released, so only rows up to the release transfer count; later
// reversals, refunds and disputes belong to credit notes, not to these
// documents. The quote only splits the ledger's fee into the base fee and VAT
// on the fee, through the same helper that priced it.
export function deriveBookingAmounts(
  bookingId: string,
  quote: QuoteSnapshot,
  ledger: readonly LedgerRow[],
  countryVatRatePercent: number,
): BookingAmounts {
  const currency = quote.currency.toUpperCase();
  const releaseTransfer = ledger
    .filter((row) => row.type === 'transfer')
    .reduce<LedgerRow | null>(
      (earliest, row) =>
        earliest === null || row.occurredAt.getTime() < earliest.occurredAt.getTime()
          ? row
          : earliest,
      null,
    );
  if (!releaseTransfer) {
    throw new Error(
      `booking documents: booking ${bookingId} has no transfer in the ledger; documents are only generated after release`,
    );
  }
  const releasedAtMs = releaseTransfer.occurredAt.getTime();
  const snapshot = ledger.filter((row) => row.occurredAt.getTime() <= releasedAtMs);

  const foreign = snapshot.find((row) => row.currency.toUpperCase() !== currency);
  if (foreign) {
    throw new Error(
      `booking documents: booking ${bookingId} has a ${foreign.type} ledger row in ${foreign.currency} but the quote is in ${quote.currency}; reconcile the ledger before generating documents`,
    );
  }

  const chargedCents = sumOf(snapshot, 'charge');
  const refundedCents = sumOf(snapshot, 'refund', -1);
  const feeCents = sumOf(snapshot, 'platform_fee', -1);
  const transferredCents = sumOf(snapshot, 'transfer', -1);
  const reversedCents = sumOf(snapshot, 'reversal');
  const payoutCents = transferredCents - reversedCents;
  const netPaidCents = chargedCents - refundedCents;

  if (chargedCents !== quote.totalCents) {
    throw new Error(
      `booking documents: booking ${bookingId} has ${String(chargedCents)} charged in the ledger up to release but the quote total is ${String(quote.totalCents)}; reconcile the charge before generating documents`,
    );
  }
  if (
    transferredCents <= 0 ||
    refundedCents < 0 ||
    feeCents < 0 ||
    reversedCents !== 0 ||
    netPaidCents - feeCents !== transferredCents
  ) {
    throw new Error(
      `booking documents: ledger of booking ${bookingId} does not balance at release (charged ${String(chargedCents)}, refunded ${String(refundedCents)}, fee ${String(feeCents)}, transferred ${String(transferredCents)}, reversed ${String(reversedCents)}); reconcile it before generating documents`,
    );
  }

  const baseFeeCents = calculatePlatformFee(quote.subtotalCents, quote.feePercent);
  const vatOnFeeCents = feeCents - baseFeeCents;
  if (vatOnFeeCents < 0) {
    throw new Error(
      `booking documents: booking ${bookingId} has a platform fee of ${String(feeCents)} in the ledger, below the ${String(baseFeeCents)} the quote's fee percent gives; reconcile the fee before generating documents`,
    );
  }
  if (vatOnFeeCents > 0) {
    const withVat = calculatePlatformFee(quote.subtotalCents, quote.feePercent, {
      vatOnFeeRatePercent: countryVatRatePercent,
    });
    if (withVat !== feeCents) {
      throw new Error(
        `booking documents: booking ${bookingId} has a platform fee of ${String(feeCents)} in the ledger, which is neither the base fee ${String(baseFeeCents)} nor the fee with ${String(countryVatRatePercent)} % VAT (${String(withVat)}); reconcile the fee before generating documents`,
      );
    }
  }

  return {
    currency,
    chargedCents,
    refundedCents,
    netPaidCents,
    baseFeeCents,
    vatOnFeeCents,
    vatOnFeeRatePercent: vatOnFeeCents > 0 ? countryVatRatePercent : null,
    feeCents,
    transferredCents,
    reversedCents,
    payoutCents,
  };
}
