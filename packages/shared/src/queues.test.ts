import { describe, expect, it } from 'vitest';
import {
  BOOKING_RELEASE_QUEUE_NAME,
  BookingReleaseJobSchema,
  EMAIL_QUEUE_NAME,
  EmailJobSchema,
  FILE_SCAN_QUEUE_NAME,
  FileScanJobSchema,
  GDPR_EXPORT_QUEUE_NAME,
  GDPR_SWEEP_QUEUE_NAME,
  GdprExportJobSchema,
  GdprSweepJobSchema,
  IMAGE_PROCESS_QUEUE_NAME,
  ImageProcessJobSchema,
  LISTING_EXPIRY_QUEUE_NAME,
  ListingExpiryJobSchema,
  NOTIFICATIONS_CLEANUP_QUEUE_NAME,
  NotificationsCleanupJobSchema,
  NOTIFY_JOB_ATTEMPTS,
  NOTIFY_JOB_BACKOFF_DELAY_MS,
  NOTIFY_JOB_FAILED_RETENTION_SECONDS,
  NOTIFY_QUEUE_NAME,
  NOTIFY_SWEEP_QUEUE_NAME,
  notifyJobOptions,
  NotifyJobSchema,
  NotifySweepJobSchema,
  PORTFOLIO_IMAGE_CLEANUP_QUEUE_NAME,
  PortfolioImageCleanupJobSchema,
  PUSH_RECEIPTS_QUEUE_NAME,
  PushReceiptsJobSchema,
  QUEUE_JOB_SCHEMAS,
  QUEUE_NAMES,
  QUOTE_EXPIRY_QUEUE_NAME,
  QuoteExpiryJobSchema,
  RECEIPT_PDF_QUEUE_NAME,
  ReceiptPdfJobSchema,
  UPLOADS_CLEANUP_QUEUE_NAME,
  UploadsCleanupJobSchema,
} from './queues.js';

const VALID_UPLOAD_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('QUEUE_NAMES', () => {
  it('lists every queue exactly once', () => {
    expect(QUEUE_NAMES).toEqual([
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
    ]);
    expect(new Set(QUEUE_NAMES).size).toBe(QUEUE_NAMES.length);
  });

  it('exposes a named constant per queue matching QUEUE_NAMES', () => {
    expect([
      EMAIL_QUEUE_NAME,
      FILE_SCAN_QUEUE_NAME,
      IMAGE_PROCESS_QUEUE_NAME,
      UPLOADS_CLEANUP_QUEUE_NAME,
      PORTFOLIO_IMAGE_CLEANUP_QUEUE_NAME,
      QUOTE_EXPIRY_QUEUE_NAME,
      NOTIFY_QUEUE_NAME,
      NOTIFY_SWEEP_QUEUE_NAME,
      PUSH_RECEIPTS_QUEUE_NAME,
      NOTIFICATIONS_CLEANUP_QUEUE_NAME,
      BOOKING_RELEASE_QUEUE_NAME,
      RECEIPT_PDF_QUEUE_NAME,
      GDPR_EXPORT_QUEUE_NAME,
      GDPR_SWEEP_QUEUE_NAME,
      LISTING_EXPIRY_QUEUE_NAME,
    ]).toEqual(QUEUE_NAMES);
  });
});

describe('EmailJobSchema', () => {
  it('accepts a verify-email job', () => {
    const result = EmailJobSchema.safeParse({
      type: 'verify-email',
      to: 'client@photoo.test',
      url: 'https://photoo.lu/verify/abc',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a reset-password job', () => {
    const result = EmailJobSchema.safeParse({
      type: 'reset-password',
      to: 'client@photoo.test',
      url: 'https://photoo.lu/reset-password/abc',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an account-exists job without a url', () => {
    const result = EmailJobSchema.safeParse({
      type: 'account-exists',
      to: 'client@photoo.test',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an account-deletion-requested job', () => {
    const result = EmailJobSchema.safeParse({
      type: 'account-deletion-requested',
      to: 'client@photoo.test',
      url: 'https://photoo.lu/account/deletion/cancel/abc#token=xyz',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(EmailJobSchema.safeParse({ type: 'newsletter', to: 'a@b.com' }).success).toBe(false);
  });

  it('rejects a verify-email job missing url', () => {
    expect(
      EmailJobSchema.safeParse({ type: 'verify-email', to: 'client@photoo.test' }).success,
    ).toBe(false);
  });

  it('rejects a non-email "to"', () => {
    expect(EmailJobSchema.safeParse({ type: 'account-exists', to: 'not-an-email' }).success).toBe(
      false,
    );
  });

  it('rejects a non-url "url"', () => {
    expect(
      EmailJobSchema.safeParse({
        type: 'verify-email',
        to: 'client@photoo.test',
        url: 'not-a-url',
      }).success,
    ).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(
      EmailJobSchema.safeParse({
        type: 'account-exists',
        to: 'client@photoo.test',
        secret: 'nope',
      }).success,
    ).toBe(false);
  });
});

describe.each([
  ['file-scan', FileScanJobSchema] as const,
  ['image-process', ImageProcessJobSchema] as const,
])('%s job schema', (_name, schema) => {
  it('accepts a valid uploadId', () => {
    expect(schema.safeParse({ uploadId: VALID_UPLOAD_ID }).success).toBe(true);
  });

  it('rejects a missing uploadId', () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-uuid uploadId', () => {
    expect(schema.safeParse({ uploadId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(schema.safeParse({ uploadId: VALID_UPLOAD_ID, extra: 'nope' }).success).toBe(false);
  });
});

describe('uploads-cleanup job schema', () => {
  it('accepts an empty payload', () => {
    expect(UploadsCleanupJobSchema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown extra keys', () => {
    expect(UploadsCleanupJobSchema.safeParse({ uploadId: VALID_UPLOAD_ID }).success).toBe(false);
  });
});

describe('portfolio-image-cleanup job schema', () => {
  it('accepts an uploadId with variant keys', () => {
    expect(
      PortfolioImageCleanupJobSchema.safeParse({
        uploadId: VALID_UPLOAD_ID,
        variantKeys: ['v/abc/thumb.jpg'],
      }).success,
    ).toBe(true);
  });

  it('accepts an empty variantKeys array', () => {
    expect(
      PortfolioImageCleanupJobSchema.safeParse({ uploadId: VALID_UPLOAD_ID, variantKeys: [] })
        .success,
    ).toBe(true);
  });

  it('rejects a missing uploadId', () => {
    expect(PortfolioImageCleanupJobSchema.safeParse({ variantKeys: [] }).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(
      PortfolioImageCleanupJobSchema.safeParse({
        uploadId: VALID_UPLOAD_ID,
        variantKeys: [],
        extra: 'nope',
      }).success,
    ).toBe(false);
  });
});

describe('quote-expiry job schema', () => {
  it('accepts an empty payload', () => {
    expect(QuoteExpiryJobSchema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown extra keys', () => {
    expect(QuoteExpiryJobSchema.safeParse({ uploadId: VALID_UPLOAD_ID }).success).toBe(false);
  });
});

describe('NotifyJobSchema', () => {
  it('accepts a valid notificationId', () => {
    expect(NotifyJobSchema.safeParse({ notificationId: VALID_UPLOAD_ID }).success).toBe(true);
  });

  it('rejects a missing notificationId', () => {
    expect(NotifyJobSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-uuid notificationId', () => {
    expect(NotifyJobSchema.safeParse({ notificationId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(
      NotifyJobSchema.safeParse({ notificationId: VALID_UPLOAD_ID, extra: 'nope' }).success,
    ).toBe(false);
  });
});

describe('notifyJobOptions', () => {
  it('builds BullMQ options with the given jobId, attempts, backoff and retention', () => {
    const options = notifyJobOptions(VALID_UPLOAD_ID);
    expect(options).toEqual({
      jobId: VALID_UPLOAD_ID,
      attempts: NOTIFY_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: NOTIFY_JOB_BACKOFF_DELAY_MS },
      removeOnComplete: true,
      removeOnFail: { age: NOTIFY_JOB_FAILED_RETENTION_SECONDS },
    });
  });

  it('accepts a distinct jobId, not just a notificationId (used by notify-sweep re-enqueues)', () => {
    expect(notifyJobOptions('some-id:sweep:123').jobId).toBe('some-id:sweep:123');
  });
});

describe.each([
  ['notify-sweep', NotifySweepJobSchema] as const,
  ['push-receipts', PushReceiptsJobSchema] as const,
  ['notifications-cleanup', NotificationsCleanupJobSchema] as const,
  ['booking-release', BookingReleaseJobSchema] as const,
])('%s job schema', (_name, schema) => {
  it('accepts an empty payload', () => {
    expect(schema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown extra keys', () => {
    expect(schema.safeParse({ uploadId: VALID_UPLOAD_ID }).success).toBe(false);
  });
});

describe('ReceiptPdfJobSchema', () => {
  it('accepts a valid bookingId', () => {
    expect(ReceiptPdfJobSchema.safeParse({ bookingId: VALID_UPLOAD_ID }).success).toBe(true);
  });

  it('rejects a missing bookingId', () => {
    expect(ReceiptPdfJobSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-uuid bookingId', () => {
    expect(ReceiptPdfJobSchema.safeParse({ bookingId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(
      ReceiptPdfJobSchema.safeParse({ bookingId: VALID_UPLOAD_ID, extra: 'nope' }).success,
    ).toBe(false);
  });
});

describe('GdprExportJobSchema', () => {
  it('accepts a valid dataRequestId', () => {
    expect(GdprExportJobSchema.safeParse({ dataRequestId: VALID_UPLOAD_ID }).success).toBe(true);
  });

  it('rejects a missing dataRequestId', () => {
    expect(GdprExportJobSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-uuid dataRequestId', () => {
    expect(GdprExportJobSchema.safeParse({ dataRequestId: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(
      GdprExportJobSchema.safeParse({ dataRequestId: VALID_UPLOAD_ID, extra: 'nope' }).success,
    ).toBe(false);
  });
});

describe('gdpr-sweep job schema', () => {
  it('accepts an empty payload', () => {
    expect(GdprSweepJobSchema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown extra keys', () => {
    expect(GdprSweepJobSchema.safeParse({ uploadId: VALID_UPLOAD_ID }).success).toBe(false);
  });
});

describe('listing-expiry job schema', () => {
  it('accepts an empty payload', () => {
    expect(ListingExpiryJobSchema.safeParse({}).success).toBe(true);
  });

  it('rejects unknown extra keys', () => {
    expect(ListingExpiryJobSchema.safeParse({ uploadId: VALID_UPLOAD_ID }).success).toBe(false);
  });
});

describe('QUEUE_JOB_SCHEMAS', () => {
  it('has one entry per queue name', () => {
    expect(Object.keys(QUEUE_JOB_SCHEMAS).sort()).toEqual([...QUEUE_NAMES].sort());
  });
});
