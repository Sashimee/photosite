import { z } from 'zod';
import { IdSchema } from './contract/common.js';

export const QUEUE_NAMES = [
  'email',
  'file-scan',
  'image-process',
  'uploads-cleanup',
  'portfolio-image-cleanup',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export const EMAIL_QUEUE_NAME = 'email' as const satisfies QueueName;
export const FILE_SCAN_QUEUE_NAME = 'file-scan' as const satisfies QueueName;
export const IMAGE_PROCESS_QUEUE_NAME = 'image-process' as const satisfies QueueName;
export const UPLOADS_CLEANUP_QUEUE_NAME = 'uploads-cleanup' as const satisfies QueueName;
export const PORTFOLIO_IMAGE_CLEANUP_QUEUE_NAME =
  'portfolio-image-cleanup' as const satisfies QueueName;

export const EmailJobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('verify-email'), to: z.email(), url: z.url() }).strict(),
  z.object({ type: z.literal('reset-password'), to: z.email(), url: z.url() }).strict(),
  z.object({ type: z.literal('account-exists'), to: z.email() }).strict(),
]);

export type EmailJob = z.infer<typeof EmailJobSchema>;

export const FileScanJobSchema = z.object({ uploadId: IdSchema }).strict();

export type FileScanJob = z.infer<typeof FileScanJobSchema>;

export const ImageProcessJobSchema = z.object({ uploadId: IdSchema }).strict();

export type ImageProcessJob = z.infer<typeof ImageProcessJobSchema>;

// A repeatable sweep of every expired upload, not a lookup of one row, so
// (unlike file-scan/image-process) it carries no uploadId.
export const UploadsCleanupJobSchema = z.object({}).strict();

export type UploadsCleanupJob = z.infer<typeof UploadsCleanupJobSchema>;

// Removes the public variant objects of a soft-deleted `PortfolioImage`.
// Enqueue-only for now (docs/steps/1A.4-profiles-products.md): no worker
// consumer yet, matching how the `email` queue lands its consumer later.
export const PortfolioImageCleanupJobSchema = z
  .object({ uploadId: IdSchema, variantKeys: z.array(z.string().min(1)) })
  .strict();

export type PortfolioImageCleanupJob = z.infer<typeof PortfolioImageCleanupJobSchema>;

export const QUEUE_JOB_SCHEMAS = {
  [EMAIL_QUEUE_NAME]: EmailJobSchema,
  [FILE_SCAN_QUEUE_NAME]: FileScanJobSchema,
  [IMAGE_PROCESS_QUEUE_NAME]: ImageProcessJobSchema,
  [UPLOADS_CLEANUP_QUEUE_NAME]: UploadsCleanupJobSchema,
  [PORTFOLIO_IMAGE_CLEANUP_QUEUE_NAME]: PortfolioImageCleanupJobSchema,
} as const satisfies Record<QueueName, z.ZodType>;

export type QueueJobPayload<Name extends QueueName> = z.infer<(typeof QUEUE_JOB_SCHEMAS)[Name]>;
