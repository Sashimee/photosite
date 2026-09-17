import type { Quote } from '@photoo/db';
import { QuotePhotographerSchema, QuoteSchema } from '@photoo/shared';
import type { z } from 'zod';
import { publicVariantUrl } from '../../storage/public-url.js';
import type { QuotePhotographerRow } from './quotes.repository.js';

// Matches the variant key profiles.repository.ts uses for avatars, so a
// quote's photographer summary renders the same image as their profile card.
const AVATAR_VARIANT_KEY = 'thumb_jpeg';

export function mapQuotePhotographer(
  row: QuotePhotographerRow,
  baseUrl: string,
): z.infer<typeof QuotePhotographerSchema> {
  return QuotePhotographerSchema.parse({
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    avatarUrl: publicVariantUrl(baseUrl, row.avatarVariants, AVATAR_VARIANT_KEY),
    city: row.city,
    countryCode: row.countryCode,
    ratingAvg: row.ratingAvg,
    ratingCount: row.ratingCount,
  });
}

export function mapQuote(
  quote: Quote,
  photographer: z.infer<typeof QuotePhotographerSchema>,
): z.infer<typeof QuoteSchema> {
  return QuoteSchema.parse({
    id: quote.id,
    requestId: quote.requestId,
    photographerId: quote.photographerId,
    photographer,
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
