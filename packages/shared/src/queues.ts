import { z } from 'zod';
import { IdSchema } from './contract/common.js';

export const QUEUE_NAMES = [
  'email',
  'file-scan',
  'image-process',
  'uploads-cleanup',
  'portfolio-image-cleanup',
  'quote-expiry',
  'notify',
  'notify-sweep',
  'push-receipts',
  'notifications-cleanup',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export const EMAIL_QUEUE_NAME = 'email' as const satisfies QueueName;
export const FILE_SCAN_QUEUE_NAME = 'file-scan' as const satisfies QueueName;
export const IMAGE_PROCESS_QUEUE_NAME = 'image-process' as const satisfies QueueName;
export const UPLOADS_CLEANUP_QUEUE_NAME = 'uploads-cleanup' as const satisfies QueueName;
export const PORTFOLIO_IMAGE_CLEANUP_QUEUE_NAME =
  'portfolio-image-cleanup' as const satisfies QueueName;
export const QUOTE_EXPIRY_QUEUE_NAME = 'quote-expiry' as const satisfies QueueName;
export const NOTIFY_QUEUE_NAME = 'notify' as const satisfies QueueName;
export const NOTIFY_SWEEP_QUEUE_NAME = 'notify-sweep' as const satisfies QueueName;
export const PUSH_RECEIPTS_QUEUE_NAME = 'push-receipts' as const satisfies QueueName;
export const NOTIFICATIONS_CLEANUP_QUEUE_NAME =
  'notifications-cleanup' as const satisfies QueueName;

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

export const QuoteExpiryJobSchema = z.object({}).strict();

export type QuoteExpiryJob = z.infer<typeof QuoteExpiryJobSchema>;

// Carries only the notificationId; the worker loads the user, locale,
// preferences and devices at send time, so no personal data sits in Redis.
export const NotifyJobSchema = z.object({ notificationId: IdSchema }).strict();

export type NotifyJob = z.infer<typeof NotifyJobSchema>;

// A repeatable sweep of stale pending notifications, not a lookup of one
// row, so it carries no notificationId.
export const NotifySweepJobSchema = z.object({}).strict();

export type NotifySweepJob = z.infer<typeof NotifySweepJobSchema>;

export const PushReceiptsJobSchema = z.object({}).strict();

export type PushReceiptsJob = z.infer<typeof PushReceiptsJobSchema>;

export const NotificationsCleanupJobSchema = z.object({}).strict();

export type NotificationsCleanupJob = z.infer<typeof NotificationsCleanupJobSchema>;

export const QUEUE_JOB_SCHEMAS = {
  [EMAIL_QUEUE_NAME]: EmailJobSchema,
  [FILE_SCAN_QUEUE_NAME]: FileScanJobSchema,
  [IMAGE_PROCESS_QUEUE_NAME]: ImageProcessJobSchema,
  [UPLOADS_CLEANUP_QUEUE_NAME]: UploadsCleanupJobSchema,
  [PORTFOLIO_IMAGE_CLEANUP_QUEUE_NAME]: PortfolioImageCleanupJobSchema,
  [QUOTE_EXPIRY_QUEUE_NAME]: QuoteExpiryJobSchema,
  [NOTIFY_QUEUE_NAME]: NotifyJobSchema,
  [NOTIFY_SWEEP_QUEUE_NAME]: NotifySweepJobSchema,
  [PUSH_RECEIPTS_QUEUE_NAME]: PushReceiptsJobSchema,
  [NOTIFICATIONS_CLEANUP_QUEUE_NAME]: NotificationsCleanupJobSchema,
} as const satisfies Record<QueueName, z.ZodType>;

export type QueueJobPayload<Name extends QueueName> = z.infer<(typeof QUEUE_JOB_SCHEMAS)[Name]>;
