import type { Quote } from '@photoo/db';
import { QuoteSchema } from '@photoo/shared';
import type { z } from 'zod';

export function mapQuote(quote: Quote): z.infer<typeof QuoteSchema> {
  return QuoteSchema.parse({
    id: quote.id,
    requestId: quote.requestId,
    photographerId: quote.photographerId,
    clientId: quote.clientId,
    productId: quote.productId,
    productTierId: quote.productTierId,
    lineItems: quote.lineItems,
    subtotal: { amountCents: quote.subtotalCents, currency: quote.currency },
    platformFee: { amountCents: quote.platformFeeCents, currency: quote.currency },
    total: { amountCents: quote.totalCents, currency: quote.currency },
    validUntil: quote.validUntil.toISOString(),
    message: quote.message,
    status: quote.status,
  });
}
