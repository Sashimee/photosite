import { payoutAmount as sharedPayoutAmount, type Locale } from '@photoo/shared';

export interface Money {
  amountCents: number;
  currency: string;
}

export function formatMoney(money: Money, locale: Locale): string;
export function formatMoney(money: Money | null | undefined, locale: Locale): string | null;
export function formatMoney(money: Money | null | undefined, locale: Locale): string | null {
  if (!money) {
    return null;
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(
    money.amountCents / 100,
  );
}

export function lowestPrice(prices: readonly (Money | null)[]): Money | null {
  let lowest: Money | null = null;
  for (const price of prices) {
    if (price && (!lowest || price.amountCents < lowest.amountCents)) {
      lowest = price;
    }
  }
  return lowest;
}

const WHOLE_UNITS = /^\d+$/;

// Anything but a plain non-negative whole number becomes NaN so the shared
// z.int() rejects it with a field error instead of sending a 0-cent budget.
export function wholeUnitsToCents(text: string): number {
  const trimmed = text.trim();
  return WHOLE_UNITS.test(trimmed) ? Number(trimmed) * 100 : Number.NaN;
}

// The generated `Money` type is nullable because the OpenAPI component is
// shared with PhotographerSummary.startingPrice; Product.basePrice and
// ProductTier.price are always present in practice, so a missing one is a
// loud failure instead of a hidden branch.
export function requireMoney(money: Money | null | undefined, context: string): Money {
  if (!money) {
    throw new Error(`Expected ${context} to have a price`);
  }
  return money;
}

// The API's quote preview and quote DTOs carry the subtotal and the platform
// fee but never the net, so the payout is the difference of two numbers the
// server already computed, not a fee recomputation.
export function payoutAmount(subtotal: Money, platformFee: Money): Money {
  if (subtotal.currency !== platformFee.currency) {
    throw new Error(
      `payoutAmount: currency mismatch (${subtotal.currency} vs ${platformFee.currency})`,
    );
  }
  return {
    amountCents: sharedPayoutAmount({
      subtotalCents: subtotal.amountCents,
      platformFeeCents: platformFee.amountCents,
    }),
    currency: subtotal.currency,
  };
}
