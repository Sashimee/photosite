import type { PhotographerProfile, PortfolioImage as DbPortfolioImage, Upload } from '@photoo/db';
import {
  OwnPhotographerProfileSchema,
  PhotographerSummarySchema,
  PortfolioImageSchema,
  PublicPhotographerProfileSchema,
  PublicPortfolioImageSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { toWireCategory } from '../../common/enums/photographer-category.js';
import { publicVariantUrl } from '../../storage/public-url.js';
import type { SearchResultRow } from './profiles.repository.js';

// Chosen once here so every response uses the same variant for a given
// image role; the worker always produces thumb/medium/large in jpeg and
// webp (docs/steps/1A.3-uploads.md), format negotiation is not implemented.
const AVATAR_VARIANT_KEY = 'thumb_jpeg';
const COVER_VARIANT_KEY = 'large_jpeg';
export const PORTFOLIO_VARIANT_KEY = 'medium_jpeg';

export function uploadVariants(upload: Upload | null | undefined): Record<string, string> | null {
  return (upload?.variants as Record<string, string> | null | undefined) ?? null;
}

export function mapSummaryRow(
  row: SearchResultRow,
  baseUrl: string,
): z.infer<typeof PhotographerSummarySchema> {
  return PhotographerSummarySchema.parse({
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    headline: row.headline,
    avatarUrl: publicVariantUrl(baseUrl, row.avatarVariants, AVATAR_VARIANT_KEY),
    categories: row.categories.map(toWireCategory),
    languages: row.languages,
    city: row.city,
    countryCode: row.countryCode,
    ratingAvg: row.ratingAvg,
    ratingCount: row.ratingCount,
    startingPrice:
      row.minPriceCents !== null && row.priceCurrency !== null
        ? { amountCents: row.minPriceCents, currency: row.priceCurrency }
        : null,
  });
}

export interface ProfileWithUploads extends PhotographerProfile {
  avatarUpload: Upload | null;
  coverUpload: Upload | null;
}

export function mapPortfolioImage(
  image: DbPortfolioImage,
  upload: Upload,
  baseUrl: string,
): z.infer<typeof PortfolioImageSchema> {
  return PortfolioImageSchema.parse({
    id: image.id,
    url: publicVariantUrl(baseUrl, uploadVariants(upload), PORTFOLIO_VARIANT_KEY),
    width: image.width,
    height: image.height,
    order: image.order,
    status: image.status,
    provenance: null,
  });
}

export function mapPublicPortfolioImage(
  image: DbPortfolioImage,
  upload: Upload,
  baseUrl: string,
): z.infer<typeof PublicPortfolioImageSchema> {
  return PublicPortfolioImageSchema.parse({
    id: image.id,
    url: publicVariantUrl(baseUrl, uploadVariants(upload), PORTFOLIO_VARIANT_KEY),
    width: image.width,
    height: image.height,
    order: image.order,
  });
}

export function mapPublicProfile(
  profile: ProfileWithUploads,
  portfolio: readonly z.infer<typeof PublicPortfolioImageSchema>[],
  baseUrl: string,
): z.infer<typeof PublicPhotographerProfileSchema> {
  return PublicPhotographerProfileSchema.parse({
    id: profile.id,
    slug: profile.slug,
    displayName: profile.displayName,
    headline: profile.headline,
    bio: profile.bio,
    avatarUrl: publicVariantUrl(baseUrl, uploadVariants(profile.avatarUpload), AVATAR_VARIANT_KEY),
    coverUrl: publicVariantUrl(baseUrl, uploadVariants(profile.coverUpload), COVER_VARIANT_KEY),
    links: profile.links,
    categories: profile.categories.map(toWireCategory),
    languages: profile.languages,
    serviceRadiusKm: profile.serviceRadiusKm,
    city: profile.city,
    countryCode: profile.countryCode,
    ratingAvg: Number(profile.ratingAvg),
    ratingCount: profile.ratingCount,
    portfolio,
  });
}

export function mapOwnProfile(
  profile: ProfileWithUploads,
  location: { lat: number; lng: number },
  baseUrl: string,
): z.infer<typeof OwnPhotographerProfileSchema> {
  return OwnPhotographerProfileSchema.parse({
    id: profile.id,
    slug: profile.slug,
    displayName: profile.displayName,
    headline: profile.headline,
    bio: profile.bio,
    avatarUrl: publicVariantUrl(baseUrl, uploadVariants(profile.avatarUpload), AVATAR_VARIANT_KEY),
    coverUrl: publicVariantUrl(baseUrl, uploadVariants(profile.coverUpload), COVER_VARIANT_KEY),
    links: profile.links,
    categories: profile.categories.map(toWireCategory),
    languages: profile.languages,
    location,
    serviceRadiusKm: profile.serviceRadiusKm,
    city: profile.city,
    countryCode: profile.countryCode,
    ratingAvg: Number(profile.ratingAvg),
    ratingCount: profile.ratingCount,
    verificationStatus: profile.verificationStatus,
    isPublished: profile.isPublished,
    stripeOnboardingComplete: profile.stripeOnboardingComplete,
    stripePayoutsEnabled: profile.stripePayoutsEnabled,
  });
}
