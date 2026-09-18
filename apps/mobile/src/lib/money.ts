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
