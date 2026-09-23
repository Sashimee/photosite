import type { JobApplication, JobOffer, PhotographerProfile, Upload } from '@photoo/db';
import {
  JobApplicationSchema,
  JobApplicationWithOfferSchema,
  JobApplicationWithPhotographerSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { publicVariantUrl } from '../../storage/public-url.js';

const AVATAR_VARIANT_KEY = 'thumb_jpeg';

export interface PhotographerProfileWithAvatar extends PhotographerProfile {
  avatarUpload: Upload | null;
}

export function mapJobApplication(row: JobApplication): z.infer<typeof JobApplicationSchema> {
  return JobApplicationSchema.parse({
    id: row.id,
    jobOfferId: row.jobOfferId,
    photographerId: row.photographerId,
    message: row.message,
    portfolioLink: row.portfolioLink,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  });
}

export function mapJobApplicationWithPhotographer(
  row: JobApplication,
  photographer: PhotographerProfileWithAvatar,
  baseUrl: string,
): z.infer<typeof JobApplicationWithPhotographerSchema> {
  return JobApplicationWithPhotographerSchema.parse({
    ...mapJobApplication(row),
    photographer: {
      id: photographer.id,
      slug: photographer.slug,
      displayName: photographer.displayName,
      avatarUrl: publicVariantUrl(
        baseUrl,
        (photographer.avatarUpload?.variants as Record<string, string> | null | undefined) ?? null,
        AVATAR_VARIANT_KEY,
      ),
      city: photographer.city,
      countryCode: photographer.countryCode,
    },
  });
}

export function mapJobApplicationWithOffer(
  row: JobApplication,
  jobOffer: JobOffer,
): z.infer<typeof JobApplicationWithOfferSchema> {
  return JobApplicationWithOfferSchema.parse({
    ...mapJobApplication(row),
    jobOffer: {
      id: jobOffer.id,
      slug: jobOffer.slug,
      title: jobOffer.title,
      status: jobOffer.status,
    },
  });
}
