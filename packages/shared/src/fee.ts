export interface LineItem {
  label: string;
  qty: number;
  unitCents: number;
}

export interface QuoteTotals {
  subtotalCents: number;
  platformFeeCents: number;
  totalCents: number;
}

export function calculatePlatformFee(subtotalCents: number, feePercent: number): number {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new RangeError(
      `calculatePlatformFee: subtotalCents must be a non-negative integer, got ${String(subtotalCents)}`,
    );
  }
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
    throw new RangeError(
      `calculatePlatformFee: feePercent must be a number between 0 and 100, got ${String(feePercent)}`,
    );
  }

  return Math.round((subtotalCents * feePercent) / 100);
}

// Per PAYMENTS.md, the client is charged totalCents = subtotalCents; the platform
// fee is not added on top, it is deducted from the photographer's payout at release
// (Transfer amount = subtotalCents - platformFeeCents).
export function quoteTotals(lineItems: readonly LineItem[], feePercent: number): QuoteTotals {
  const subtotalCents = lineItems.reduce((sum, item) => {
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      throw new RangeError(
        `quoteTotals: lineItem.qty must be a positive integer, got ${String(item.qty)}`,
      );
    }
    if (!Number.isInteger(item.unitCents) || item.unitCents < 0) {
      throw new RangeError(
        `quoteTotals: lineItem.unitCents must be a non-negative integer, got ${String(item.unitCents)}`,
      );
    }

    return sum + item.qty * item.unitCents;
  }, 0);

  const platformFeeCents = calculatePlatformFee(subtotalCents, feePercent);

  return {
    subtotalCents,
    platformFeeCents,
    totalCents: subtotalCents,
  };
}
