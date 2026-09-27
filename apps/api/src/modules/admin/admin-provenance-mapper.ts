import { AdminProvenanceCheckSchema, AdminProvenanceCheckSummarySchema } from '@photoo/shared';
import type { z } from 'zod';
import { PORTFOLIO_VARIANT_KEY, uploadVariants } from '../profiles/profile-mapper.js';
import { publicVariantUrl } from '../../storage/public-url.js';
import type { ProvenanceCheckWithRelations } from './admin-provenance.repository.js';

type AdminProvenanceCheckSummaryDto = z.infer<typeof AdminProvenanceCheckSummarySchema>;
type AdminProvenanceCheckDto = z.infer<typeof AdminProvenanceCheckSchema>;

// A ProvenanceCheck row only ever exists once the worker's image-process job
// has produced variants for the upload (apps/worker enqueues provenance-check
// after image processing), so the portfolio thumbnail is always present here.
function requireThumbnailUrl(check: ProvenanceCheckWithRelations, baseUrl: string): string {
  const url = publicVariantUrl(
    baseUrl,
    uploadVariants(check.portfolioImage.upload),
    PORTFOLIO_VARIANT_KEY,
  );
  if (!url) {
    throw new Error(`ProvenanceCheck ${check.id} has no portfolio thumbnail variant`);
  }
  return url;
}

// Stored as `{ url, domain, similarity }[]`; only the URL is admin-facing.
function mapReverseMatches(reverseMatches: unknown): string[] | null {
  if (!Array.isArray(reverseMatches)) {
    return null;
  }
  return reverseMatches
    .map((match) =>
      typeof match === 'object' &&
      match !== null &&
      typeof (match as { url?: unknown }).url === 'string'
        ? (match as { url: string }).url
        : null,
    )
    .filter((url): url is string => url !== null);
}

export function mapAdminProvenanceCheckSummary(
  check: ProvenanceCheckWithRelations,
  baseUrl: string,
): AdminProvenanceCheckSummaryDto {
  return AdminProvenanceCheckSummarySchema.parse({
    id: check.id,
    portfolioImageId: check.portfolioImageId,
    portfolioImageStatus: check.portfolioImage.status,
    thumbnailUrl: requireThumbnailUrl(check, baseUrl),
    photographer: {
      id: check.portfolioImage.profile.id,
      displayName: check.portfolioImage.profile.displayName,
      slug: check.portfolioImage.profile.slug,
    },
    verdict: check.verdict,
    score: Number(check.score),
    checkedAt: check.createdAt.toISOString(),
    reviewedAt: check.reviewedAt?.toISOString() ?? null,
  });
}

export function mapAdminProvenanceCheck(
  check: ProvenanceCheckWithRelations,
  baseUrl: string,
): AdminProvenanceCheckDto {
  const summary = mapAdminProvenanceCheckSummary(check, baseUrl);
  return AdminProvenanceCheckSchema.parse({
    ...summary,
    aiScore: check.aiScore !== null ? Number(check.aiScore) : null,
    aiVendor: check.aiVendor,
    reverseMatches: mapReverseMatches(check.reverseMatches),
    c2paValid: check.c2paValid,
    exifCamera: check.exifCamera,
    exifCapturedAt: check.exifCapturedAt?.toISOString() ?? null,
    reviewedByAdminId: check.reviewedByAdminId,
    note: check.note,
  });
}
