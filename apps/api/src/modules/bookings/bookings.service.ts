import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type Booking, type Upload } from '@photoo/db';
import type {
  BookingSchema,
  CancelBookingRequestSchema,
  CreateDeliveryRequestSchema,
  CursorPaginationQuerySchema,
  DeliverySchema,
} from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { PlatformSettingsService } from '../../common/platform-settings/platform-settings.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BookingReleaseService } from '../payments/booking-release.service.js';
import { IllegalBookingTransitionError, transitionBooking } from './booking-state.js';

type BookingDto = z.infer<typeof BookingSchema>;
type DeliveryDto = z.infer<typeof DeliverySchema>;
type ListQuery = z.infer<typeof CursorPaginationQuerySchema>;
type CreateDeliveryInput = z.infer<typeof CreateDeliveryRequestSchema>;
type CancelInput = z.infer<typeof CancelBookingRequestSchema>;

interface SessionUser {
  id: string;
}

type BookingRow = Booking & { quote: { totalCents: number; currency: string } };

interface LocationRow {
  id: string;
  lat: number;
  lng: number;
}

const DAY_MS = 86_400_000;
const BOOKING_INCLUDE = { quote: { select: { totalCents: true, currency: true } } } as const;

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Booking not found' }, 404);
}

function forbidden(message: string): HttpException {
  return new HttpException({ code: 'FORBIDDEN', message }, 403);
}

function unprocessable(message: string): HttpException {
  return new HttpException({ code: 'UNPROCESSABLE_ENTITY', message }, 422);
}

function isUploadReady(upload: Pick<Upload, 'status' | 'virusScanStatus'>): boolean {
  return (
    upload.virusScanStatus === 'clean' &&
    (upload.status === 'clean' || upload.status === 'processed')
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function partyWhere(userId: string): Prisma.BookingWhereInput {
  return { OR: [{ clientId: userId }, { photographer: { userId } }] };
}

@Injectable()
export class BookingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
    @Inject(BookingReleaseService) private readonly release: BookingReleaseService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async list(
    user: SessionUser,
    query: ListQuery,
  ): Promise<{ items: BookingDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const cursorWhere: Prisma.BookingWhereInput = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
          ],
        }
      : {};
    const rows = await this.prisma.client.booking.findMany({
      where: { AND: [partyWhere(user.id), cursorWhere] },
      include: BOOKING_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      items: await this.toDtos(page),
      nextCursor: hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null,
    };
  }

  async get(user: SessionUser, bookingId: string): Promise<BookingDto> {
    const row = await this.prisma.client.booking.findFirst({
      where: { AND: [{ id: bookingId }, partyWhere(user.id)] },
      include: BOOKING_INCLUDE,
    });
    if (!row) {
      throw notFound();
    }
    const [dto] = await this.toDtos([row]);
    if (!dto) {
      throw notFound();
    }
    return dto;
  }

  async createDelivery(
    user: SessionUser,
    bookingId: string,
    input: CreateDeliveryInput,
    ip: string | null,
  ): Promise<{ delivery: DeliveryDto }> {
    const { autoReleaseDays } = await this.settings.get();
    const fileIds = input.fileIds ?? [];
    try {
      const delivery = await this.prisma.client.$transaction(async (tx) => {
        const booking = await this.lockPartyBooking(tx, user.id, bookingId);
        if (booking.photographer.userId !== user.id) {
          throw forbidden('Only the photographer can deliver a booking');
        }
        if (booking.status !== 'paid_held' && booking.status !== 'in_progress') {
          throw new IllegalBookingTransitionError(booking.id, booking.status, 'delivered');
        }
        await this.assertDeliverableUploads(tx, user.id, fileIds);

        const created = await tx.delivery.create({
          data: {
            bookingId: booking.id,
            message: input.message,
            externalLink: input.externalLink ?? null,
            ...(fileIds.length > 0
              ? { files: { create: fileIds.map((uploadId) => ({ uploadId })) } }
              : {}),
          },
          include: { files: { select: { uploadId: true } } },
        });

        const actor = { type: 'user' as const, id: user.id };
        if (booking.status === 'paid_held') {
          await transitionBooking(tx, {
            bookingId: booking.id,
            from: 'paid_held',
            to: 'in_progress',
            actor,
            ip,
          });
        }
        // autoReleaseDays is read when the delivery lands, so a later settings
        // change does not move the release date of work already delivered.
        const releaseDueAt = new Date(created.deliveredAt.getTime() + autoReleaseDays * DAY_MS);
        await transitionBooking(tx, {
          bookingId: booking.id,
          from: 'in_progress',
          to: 'delivered',
          actor,
          ip,
          data: { releaseDueAt },
          audit: {
            deliveryId: created.id,
            releaseDueAt: releaseDueAt.toISOString(),
            fileCount: fileIds.length,
          },
        });
        return created;
      });
      return {
        delivery: {
          id: delivery.id,
          bookingId: delivery.bookingId,
          message: delivery.message,
          fileIds: delivery.files.length > 0 ? delivery.files.map((file) => file.uploadId) : null,
          externalLink: delivery.externalLink,
          deliveredAt: delivery.deliveredAt.toISOString(),
          acceptedAt: delivery.acceptedAt?.toISOString() ?? null,
        },
      };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw unprocessable('A file can only be part of one delivery');
      }
      throw error;
    }
  }

  async acceptDelivery(
    user: SessionUser,
    bookingId: string,
    ip: string | null,
  ): Promise<BookingDto> {
    await this.prisma.client.$transaction(async (tx) => {
      const booking = await this.lockPartyBooking(tx, user.id, bookingId);
      if (booking.clientId !== user.id) {
        throw forbidden('Only the client can accept a delivery');
      }
      if (booking.status !== 'delivered' || !booking.delivery) {
        throw new IllegalBookingTransitionError(
          booking.id,
          booking.status,
          'released',
          `Booking is ${booking.status}; only a delivered booking can have its delivery accepted`,
        );
      }
      if (booking.delivery.acceptedAt !== null) {
        return;
      }
      const acceptedAt = new Date();
      await tx.delivery.update({ where: { id: booking.delivery.id }, data: { acceptedAt } });
      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'delivery.accepted',
          targetType: 'Booking',
          targetId: booking.id,
          before: { acceptedAt: null },
          after: { deliveryId: booking.delivery.id, acceptedAt: acceptedAt.toISOString() },
          ip,
        },
      });
    });

    // The acceptance is committed on its own so a failed transfer (Stripe
    // down, photographer account missing) never undoes the client's decision;
    // the release sweep picks up accepted deliveries and retries.
    try {
      await this.release.release(bookingId, { type: 'user', id: user.id });
    } catch (error) {
      this.logger.error(
        { bookingId, err: error },
        'accept delivery: release failed, left for the release sweep',
      );
    }
    return this.get(user, bookingId);
  }

  async cancel(
    user: SessionUser,
    bookingId: string,
    input: CancelInput,
    ip: string | null,
  ): Promise<BookingDto> {
    await this.prisma.client.$transaction(async (tx) => {
      const booking = await this.lockPartyBooking(tx, user.id, bookingId);
      await transitionBooking(tx, {
        bookingId: booking.id,
        from: booking.status,
        to: 'cancelled',
        actor: { type: 'user', id: user.id },
        ip,
        data: { cancellationReason: input.reason ?? null },
        audit: { role: booking.clientId === user.id ? 'client' : 'photographer' },
      });
    });
    return this.get(user, bookingId);
  }

  private async lockPartyBooking(tx: Prisma.TransactionClient, userId: string, bookingId: string) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
    if (!locked) {
      throw notFound();
    }
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: locked.id },
      include: {
        photographer: { select: { userId: true } },
        delivery: { select: { id: true, acceptedAt: true } },
      },
    });
    if (booking.clientId !== userId && booking.photographer.userId !== userId) {
      throw notFound();
    }
    return booking;
  }

  private async assertDeliverableUploads(
    tx: Prisma.TransactionClient,
    userId: string,
    fileIds: string[],
  ): Promise<void> {
    if (fileIds.length === 0) {
      return;
    }
    if (new Set(fileIds).size !== fileIds.length) {
      throw unprocessable('A file is listed more than once');
    }
    const uploads = await tx.upload.findMany({ where: { id: { in: fileIds } } });
    if (uploads.length !== fileIds.length) {
      throw unprocessable('One or more files were not found');
    }
    for (const upload of uploads) {
      if (upload.ownerId !== userId) {
        throw unprocessable('You can only deliver your own uploads');
      }
      if (upload.purpose !== 'delivery_file') {
        throw unprocessable('Only delivery files can be part of a delivery');
      }
      if (!isUploadReady(upload)) {
        throw unprocessable('A file has not finished scanning yet');
      }
    }
    const alreadyDelivered = await tx.deliveryFile.count({ where: { uploadId: { in: fileIds } } });
    if (alreadyDelivered > 0) {
      throw unprocessable('A file can only be part of one delivery');
    }
  }

  private async toDtos(rows: BookingRow[]): Promise<BookingDto[]> {
    if (rows.length === 0) {
      return [];
    }
    // Booking.location is a PostGIS column Prisma cannot select.
    const locations = await this.prisma.client.$queryRaw<LocationRow[]>`
      SELECT id, ST_Y(location::geometry) AS "lat", ST_X(location::geometry) AS "lng"
      FROM "Booking"
      WHERE id IN (${Prisma.join(rows.map((row) => row.id))}) AND location IS NOT NULL`;
    const byId = new Map(locations.map((row) => [row.id, { lat: row.lat, lng: row.lng }]));
    return rows.map((row) => ({
      id: row.id,
      quoteId: row.quoteId,
      clientId: row.clientId,
      photographerId: row.photographerId,
      scheduledAt: row.scheduledAt?.toISOString() ?? null,
      location: byId.get(row.id) ?? null,
      total: { amountCents: row.quote.totalCents, currency: row.quote.currency },
      status: row.status,
      releaseDueAt: row.releaseDueAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      releasedAt: row.releasedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancellationReason: row.cancellationReason,
    }));
  }
}
