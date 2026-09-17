import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { formatMoney } from '@/lib/money';

type LineItem = components['schemas']['LineItem'];

export function QuoteLineItems({
  lineItems,
  currency,
  locale,
}: {
  lineItems: readonly LineItem[];
  currency: string;
  locale: Locale;
}) {
  return (
    <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
      {lineItems.map((item, index) => (
        <li
          key={`${item.label}-${String(index)}`}
          className="flex items-center justify-between gap-2"
        >
          <span>{item.label}</span>
          <span>
            {item.qty} × {formatMoney({ amountCents: item.unitCents, currency }, locale)}
          </span>
        </li>
      ))}
    </ul>
  );
}
