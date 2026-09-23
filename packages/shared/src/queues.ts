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
  'booking-release',
  'receipt-pdf',
  'gdpr-export',
  'gdpr-sweep',
  'listing-expiry',
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
export const BOOKING_RELEASE_QUEUE_NAME = 'booking-release' as const satisfies QueueName;
export const RECEIPT_PDF_QUEUE_NAME = 'receipt-pdf' as const satisfies QueueName;
export const GDPR_EXPORT_QUEUE_NAME = 'gdpr-export' as const satisfies QueueName;
export const GDPR_SWEEP_QUEUE_NAME = 'gdpr-sweep' as const satisfies QueueName;
export const LISTING_EXPIRY_QUEUE_NAME = 'listing-expiry' as const satisfies QueueName;

export const EmailJobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('verify-email'), to: z.email(), url: z.url() }).strict(),
  z.object({ type: z.literal('reset-password'), to: z.email(), url: z.url() }).strict(),
  z.object({ type: z.literal('account-exists'), to: z.email() }).strict(),
  // `url` carries the single-use cancel link (docs/steps/1A.12-gdpr.md
  // "Cancellable during the grace period"); like the other auth jobs, this
  // is unconditional (no notification-preference gate) because a deletion
  // confirmation is not optional mail.
  z.object({ type: z.literal('account-deletion-requested'), to: z.email(), url: z.url() }).strict(),
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

// A repeatable sweep of every booking past its `releaseDueAt`, not a lookup
// of one row, so (like `quote-expiry`/`notify-sweep`) it carries no
// bookingId. Disputed bookings and bookings already `released` are skipped
// by the processor, not by this schema.
export const BookingReleaseJobSchema = z.object({}).strict();

export type BookingReleaseJob = z.infer<typeof BookingReleaseJobSchema>;

// Carries only the bookingId; the worker loads the booking, its quote and
// its ledger entries at render time, so no financial data sits in Redis.
export const ReceiptPdfJobSchema = z.object({ bookingId: IdSchema }).strict();

export type ReceiptPdfJob = z.infer<typeof ReceiptPdfJobSchema>;

// Carries only the dataRequestId; `jobId = dataRequestId` and `status` on
// the row is the source of truth (pending/processing/ready/failed/
// cancelled/completed), so a retry resumes rather than duplicating
// (docs/steps/1A.12-gdpr.md "Export job shape carries the id only").
export const GdprExportJobSchema = z.object({ dataRequestId: IdSchema }).strict();

export type GdprExportJob = z.infer<typeof GdprExportJobSchema>;

// A single repeatable sweep with explicit phases (anonymise deletions past
// 30 days, purge chat past 90, expire export objects, fail stuck exports),
// not a lookup of one row, so it carries no id
// (docs/steps/1A.12-gdpr.md "One repeatable sweep, explicit phases").
export const GdprSweepJobSchema = z.object({}).strict();

export type GdprSweepJob = z.infer<typeof GdprSweepJobSchema>;

// A repeatable hourly sweep of every listing whose expiresAt has lapsed, not
// a lookup of one row, so (like quote-expiry/booking-release) it carries no
// listingId (docs/steps/1A.13-professionals.md "Expiry is a repeatable job").
export const ListingExpiryJobSchema = z.object({}).strict();

export type ListingExpiryJob = z.infer<typeof ListingExpiryJobSchema>;

export const NOTIFY_JOB_ATTEMPTS = 5;
export const NOTIFY_JOB_BACKOFF_DELAY_MS = 5000;
export const NOTIFY_JOB_FAILED_RETENTION_SECONDS = 24 * 60 * 60;

export interface NotifyJobOptions {
  jobId: string;
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: boolean;
  removeOnFail: { age: number };
}

// Centralises the `notify` queue's BullMQ options so the API (first
// enqueue), the worker's quote-expiry job (first enqueue) and the
// notify-sweep job (re-enqueue) never drift from each other. `jobId`
// defaults to the notificationId for the first enqueue (idempotent insert);
// the sweep passes a distinct id instead, because a job already terminal
// (failed/completed) under the same id would silently block a re-add, and
// the notify processor's emailSentAt/pushSentAt guards make re-processing
// under a different id safe.
export function notifyJobOptions(jobId: string): NotifyJobOptions {
  return {
    jobId,
    attempts: NOTIFY_JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: NOTIFY_JOB_BACKOFF_DELAY_MS },
    removeOnComplete: true,
    removeOnFail: { age: NOTIFY_JOB_FAILED_RETENTION_SECONDS },
  };
}

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
  [BOOKING_RELEASE_QUEUE_NAME]: BookingReleaseJobSchema,
  [RECEIPT_PDF_QUEUE_NAME]: ReceiptPdfJobSchema,
  [GDPR_EXPORT_QUEUE_NAME]: GdprExportJobSchema,
  [GDPR_SWEEP_QUEUE_NAME]: GdprSweepJobSchema,
  [LISTING_EXPIRY_QUEUE_NAME]: ListingExpiryJobSchema,
} as const satisfies Record<QueueName, z.ZodType>;

export type QueueJobPayload<Name extends QueueName> = z.infer<(typeof QUEUE_JOB_SCHEMAS)[Name]>;
