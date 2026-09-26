import { PORTFOLIO_IMAGE_STATUSES, PROVENANCE_VERDICTS } from '../enums.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema, SlugSchema } from './common.js';
import { z } from './zod.js';

// No score, vendor, match URLs or admin note: that would be a map of how to
// evade the check (docs/steps/1A.10-provenance.md).
export const PortfolioImageProvenanceSchema = z
  .object({
    verdict: z.enum(PROVENANCE_VERDICTS),
    status: z.enum(PORTFOLIO_IMAGE_STATUSES),
    checkedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('PortfolioImageProvenance');

export const AdminProvenanceQuerySchema = CursorPaginationQuerySchema.extend({
  verdict: z.enum(PROVENANCE_VERDICTS).optional(),
  status: z.enum(PORTFOLIO_IMAGE_STATUSES).optional(),
}).strict();

export const AdminProvenancePhotographerSchema = z
  .object({
    id: IdSchema,
    displayName: z.string().max(120),
    slug: SlugSchema,
  })
  .strict()
  .openapi('AdminProvenancePhotographer');

// The queue view: enough to triage without pulling every forensic signal.
// Carries the photographer's displayName/slug and the image's public
// thumbnail only — no client PII, no private originals.
export const AdminProvenanceCheckSummarySchema = z
  .object({
    id: IdSchema,
    portfolioImageId: IdSchema,
    portfolioImageStatus: z.enum(PORTFOLIO_IMAGE_STATUSES),
    thumbnailUrl: z.url(),
    photographer: AdminProvenancePhotographerSchema,
    verdict: z.enum(PROVENANCE_VERDICTS),
    score: z.number().min(0).max(1).nullable(),
    checkedAt: IsoDateTimeSchema.nullable(),
    reviewedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('AdminProvenanceCheckSummary');

export const AdminProvenanceCheckSchema = AdminProvenanceCheckSummarySchema.extend({
  aiScore: z.number().min(0).max(1).nullable(),
  aiVendor: z.string().min(1).max(60).nullable(),
  reverseMatches: z.array(z.url()).nullable(),
  c2paValid: z.boolean().nullable(),
  exifCamera: z.string().min(1).max(120).nullable(),
  exifCapturedAt: IsoDateTimeSchema.nullable(),
  reviewedByAdminId: IdSchema.nullable(),
  note: z.string().max(2000).nullable(),
})
  .strict()
  .openapi('AdminProvenanceCheck');

export const PROVENANCE_DECISION_STATUSES = ['approved', 'flagged', 'rejected'] as const;

export const ProvenanceDecisionStatusSchema = z
  .enum(PROVENANCE_DECISION_STATUSES)
  .openapi({ example: 'approved' });

// The note is admin-internal and is never returned to the photographer.
export const ProvenanceDecisionRequestSchema = z
  .object({
    status: ProvenanceDecisionStatusSchema,
    note: z.string().min(1).max(2000),
  })
  .strict()
  .openapi('ProvenanceDecisionRequest');
