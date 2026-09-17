import { RequestSchema, RequestSummarySchema } from '@photoo/shared';
import type { z } from 'zod';
import type { RequestFeedRow, RequestFullRow, RequestSummaryRow } from './requests.repository.js';

export function mapFullRequest(row: RequestFullRow): z.infer<typeof RequestSchema> {
  return RequestSchema.parse({
    id: row.id,
    clientId: row.clientId,
    title: row.title,
    category: row.category,
    description: row.description,
    eventDate: row.eventDate.toISOString(),
    dateFlexible: row.dateFlexible,
    location: { lat: row.lat, lng: row.lng },
    address: row.address,
    budgetMin: { amountCents: row.budgetMinCents, currency: row.currency },
    budgetMax: { amountCents: row.budgetMaxCents, currency: row.currency },
    usage: row.usage,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
  });
}

export function mapRequestSummary(
  row: RequestSummaryRow | RequestFeedRow,
): z.infer<typeof RequestSummarySchema> {
  return RequestSummarySchema.parse({
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    eventDate: row.eventDate.toISOString(),
    dateFlexible: row.dateFlexible,
    city: row.city,
    countryCode: row.countryCode,
    location: { lat: row.lat, lng: row.lng },
    budgetMin: { amountCents: row.budgetMinCents, currency: row.currency },
    budgetMax: { amountCents: row.budgetMaxCents, currency: row.currency },
    usage: row.usage,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    hasQuoted: row.hasQuoted,
  });
}
