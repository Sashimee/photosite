import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  bookingDocumentKey,
  type BookingDocument,
  type BookingDocumentDownloadResponseSchema,
} from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { BookingDocumentsQueueService } from './booking-documents-queue.service.js';

const DOWNLOAD_URL_EXPIRY_SECONDS = 10 * 60;

type BookingDocumentDownloadDto = z.infer<typeof BookingDocumentDownloadResponseSchema>;

interface SessionUser {
  id: string;
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

@Injectable()
export class BookingDocumentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(BookingDocumentsQueueService)
    private readonly documentsQueue: BookingDocumentsQueueService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async issueDownload(
    user: SessionUser,
    bookingId: string,
    document: BookingDocument,
  ): Promise<BookingDocumentDownloadDto> {
    const booking = await this.prisma.client.booking.findFirst({
      where: {
        id: bookingId,
        OR: [{ clientId: user.id }, { photographer: { userId: user.id } }],
      },
      select: { clientId: true, releasedAt: true, photographer: { select: { userId: true } } },
    });
    if (!booking) {
      throw new HttpException({ code: 'NOT_FOUND', message: 'Booking not found' }, 404);
    }
    const allowed =
      document === 'receipt'
        ? booking.clientId === user.id
        : booking.photographer.userId === user.id;
    if (!allowed) {
      throw new HttpException(
        {
          code: 'FORBIDDEN',
          message:
            document === 'receipt'
              ? 'Only the client can download the booking receipt'
              : 'Only the photographer can download the platform fee invoice',
        },
        403,
      );
    }
    if (!booking.releasedAt) {
      throw conflict('Booking documents are issued once the booking is released');
    }

    const bucket = this.storage.config.privateBucket;
    const key = bookingDocumentKey(bookingId, document);
    if (!(await this.storage.headObject(bucket, key))) {
      await this.requeue(bookingId, document);
      throw conflict('This document is not generated yet, retry in a minute');
    }

    const url = await this.storage.presignGet({
      bucket,
      key,
      expiresInSeconds: DOWNLOAD_URL_EXPIRY_SECONDS,
      responseContentType: 'application/pdf',
      responseContentDisposition: `attachment; filename="photoo-${document}-${bookingId}.pdf"`,
    });
    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_EXPIRY_SECONDS * 1000);

    // The presigned URL itself is never written here or anywhere else.
    await this.prisma.client.auditLog.create({
      data: {
        actorType: 'user',
        actorId: user.id,
        action: 'booking.document_download_issued',
        targetType: 'Booking',
        targetId: bookingId,
        after: { document },
      },
    });

    return { url, expiresAt: expiresAt.toISOString() };
  }

  // Recovers a document whose job was lost, e.g. Redis was down at release.
  // The deterministic job id makes repeated downloads collapse into one job.
  private async requeue(bookingId: string, document: BookingDocument): Promise<void> {
    try {
      await this.documentsQueue.enqueue(bookingId, [document]);
    } catch (error) {
      this.logger.error(
        { bookingId, document, err: error },
        'booking documents: could not re-enqueue a missing document',
      );
    }
  }
}
