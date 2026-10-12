import type { PrismaClient } from '@photoo/db';
import {
  bookingDocumentKey,
  LineItemSchema,
  ReceiptPdfJobSchema,
  type BookingDocument,
  type ReceiptPdfJob,
} from '@photoo/shared';
import type { Job, Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { z } from 'zod';
import type { RecordAuditLogInput } from '../common/audit-log.service.js';
import type { PutObjectInput } from '../storage/storage.service.js';
import { deriveBookingAmounts } from './booking-amounts.js';
import { buildDocumentContent } from './document-content.js';
import { renderDocumentPdf } from './render-pdf.js';

export interface ReceiptPdfDeps {
  prisma: { client: PrismaClient };
  storage: {
    config: { privateBucket: string };
    headObject(bucket: string, key: string): Promise<{ sizeBytes: number } | null>;
    putObject(input: PutObjectInput): Promise<void>;
  };
  auditLog: { record(input: RecordAuditLogInput): Promise<void> };
  logger: Logger;
}

const LineItemsSchema = z.array(LineItemSchema);

const AUDIT_ACTION: Record<BookingDocument, string> = {
  receipt: 'booking.receipt_generated',
  'fee-invoice': 'booking.fee_invoice_generated',
};

export function createReceiptPdfProcessor(deps: ReceiptPdfDeps): Processor<ReceiptPdfJob> {
  return async (job: Job<ReceiptPdfJob>) => {
    const { bookingId, document } = ReceiptPdfJobSchema.parse(job.data);
    const bucket = deps.storage.config.privateBucket;
    const key = bookingDocumentKey(bookingId, document);

    // Issued documents are immutable: a retry or a re-enqueue from the
    // download endpoint must not overwrite what the party may already hold.
    if (await deps.storage.headObject(bucket, key)) {
      deps.logger.log({ bookingId, document }, 'receipt-pdf: already generated, skipping');
      return;
    }

    const booking = await deps.prisma.client.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        releasedAt: true,
        quote: {
          select: {
            lineItems: true,
            subtotalCents: true,
            totalCents: true,
            feePercent: true,
            currency: true,
          },
        },
        ledgerEntries: {
          select: { type: true, amountCents: true, currency: true, occurredAt: true },
        },
        client: { select: { name: true, email: true, locale: true } },
        photographer: {
          select: {
            displayName: true,
            city: true,
            country: { select: { name: true, vatRate: true, timezone: true } },
            user: { select: { locale: true } },
          },
        },
      },
    });
    if (!booking) {
      deps.logger.warn({ bookingId, document }, 'receipt-pdf: booking not found, skipping');
      return;
    }
    if (!booking.releasedAt) {
      deps.logger.warn({ bookingId, document }, 'receipt-pdf: booking not released, skipping');
      return;
    }

    const feePercent = Number(booking.quote.feePercent);
    const amounts = deriveBookingAmounts(
      bookingId,
      {
        subtotalCents: booking.quote.subtotalCents,
        totalCents: booking.quote.totalCents,
        feePercent,
        currency: booking.quote.currency,
      },
      booking.ledgerEntries,
      Number(booking.photographer.country.vatRate),
    );
    const content = buildDocumentContent({
      document,
      locale: document === 'receipt' ? booking.client.locale : booking.photographer.user.locale,
      timeZone: booking.photographer.country.timezone,
      bookingId,
      issuedAt: booking.releasedAt,
      amounts,
      feePercent,
      lineItems: LineItemsSchema.parse(booking.quote.lineItems),
      photographer: {
        displayName: booking.photographer.displayName,
        city: booking.photographer.city,
        countryName: booking.photographer.country.name,
      },
      client: { name: booking.client.name, email: booking.client.email },
    });
    const body = await renderDocumentPdf(content, booking.releasedAt);

    await deps.storage.putObject({ bucket, key, body, contentType: 'application/pdf' });
    await deps.auditLog.record({
      actorType: 'system',
      actorId: null,
      action: AUDIT_ACTION[document],
      targetType: 'Booking',
      targetId: bookingId,
      after: { key, ...amounts },
    });
    deps.logger.log({ bookingId, document, sizeBytes: body.length }, 'receipt-pdf: generated');
  };
}
