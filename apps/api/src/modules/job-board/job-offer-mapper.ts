import { JobOfferSchema, PublicJobOfferSchema, PublicJobOfferSummarySchema } from '@photoo/shared';
import type { z } from 'zod';
import { mapPublicCompany } from '../professionals/professional-mapper.js';
import type { JobOfferFullRow, PublicJobOfferRow } from './job-board.repository.js';

function mapLocation(lat: number | null, lng: number | null): { lat: number; lng: number } | null {
  return lat !== null && lng !== null ? { lat, lng } : null;
}

export function mapFullJobOffer(row: JobOfferFullRow): z.infer<typeof JobOfferSchema> {
  return JobOfferSchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    city: row.city,
    countryCode: row.countryCode,
    location: mapLocation(row.lat, row.lng),
    remote: row.remote,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    compensation: row.compensation,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  });
}

export function mapPublicJobOfferSummary(
  row: PublicJobOfferRow,
  baseUrl: string,
): z.infer<typeof PublicJobOfferSummarySchema> {
  return PublicJobOfferSummarySchema.parse({
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    city: row.city,
    countryCode: row.countryCode,
    location: mapLocation(row.lat, row.lng),
    remote: row.remote,
    compensation: row.compensation,
    publishedAt: row.publishedAt.toISOString(),
    company: mapPublicCompany(
      {
        id: row.companyId,
        companyName: row.companyName,
        website: row.companyWebsite,
        logoVariants: row.companyLogoVariants,
        verified: row.companyVerified,
      },
      baseUrl,
    ),
  });
}

export function mapPublicJobOffer(
  row: PublicJobOfferRow,
  baseUrl: string,
): z.infer<typeof PublicJobOfferSchema> {
  return PublicJobOfferSchema.parse({
    ...mapPublicJobOfferSummary(row, baseUrl),
    description: row.description,
    startDate: row.startDate ? row.startDate.toISOString() : null,
    endDate: row.endDate ? row.endDate.toISOString() : null,
    expiresAt: row.expiresAt.toISOString(),
  });
}
