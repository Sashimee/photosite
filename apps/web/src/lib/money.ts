import type { Locale } from '@photoo/shared';

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
    if (!price) {
      continue;
    }
    if (!lowest || price.amountCents < lowest.amountCents) {
      lowest = price;
    }
  }
  return lowest;
}

// The generated `Money` type is nullable because the OpenAPI component it
// references is shared with PhotographerSummary.startingPrice (genuinely
// nullable when a photographer has no products); ProductTier.price and
// Product.basePrice are always present in practice. This turns that
// contract fact into a loud failure instead of a silently-hidden branch.
export function requireMoney(money: Money | null | undefined, context: string): Money {
  if (!money) {
    throw new Error(`Expected ${context} to have a price`);
  }
  return money;
}

// Per docs/PAYMENTS.md the photographer's payout is subtotal minus the
// platform fee (Transfer amount = subtotalCents - platformFeeCents); the API
// only ever returns the two parts, never the net, so this subtracts two
// numbers the server already computed instead of recomputing the fee itself.
export function payoutAmount(subtotal: Money, platformFee: Money): Money {
  if (subtotal.currency !== platformFee.currency) {
    throw new Error(
      `payoutAmount: currency mismatch (${subtotal.currency} vs ${platformFee.currency})`,
    );
  }
  return {
    amountCents: subtotal.amountCents - platformFee.amountCents,
    currency: subtotal.currency,
  };
}
