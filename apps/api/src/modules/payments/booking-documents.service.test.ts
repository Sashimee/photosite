import { HttpException } from '@nestjs/common';
import type { BookingDocument } from '@photoo/shared';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { StorageService } from '../../storage/storage.service.js';
import type { BookingDocumentsQueueService } from './booking-documents-queue.service.js';
import { BookingDocumentsService } from './booking-documents.service.js';

const BOOKING_ID = '0192f7a0-0000-7000-8000-000000000001';
const CLIENT = { id: 'client-1' };
const PHOTOGRAPHER = { id: 'photographer-1' };
const STRANGER = { id: 'stranger-1' };
const SIGNED_URL = 'https://s3.example.test/private/signed';

interface BookingRow {
  clientId: string;
  releasedAt: Date | null;
  photographer: { userId: string };
}

function releasedBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    clientId: CLIENT.id,
    releasedAt: new Date('2026-09-20T10:00:00Z'),
    photographer: { userId: PHOTOGRAPHER.id },
    ...overrides,
  };
}

function setup(options: { booking?: BookingRow; stored?: boolean; enqueueFails?: boolean } = {}) {
  const booking = options.booking ?? releasedBooking();
  const findFirst = vi.fn((args: { where: { OR: Record<string, unknown>[] } }) => {
    const userIds = args.where.OR.map((clause) =>
      'clientId' in clause ? clause.clientId : (clause.photographer as { userId: string }).userId,
    );
    const isParty = userIds.some(
      (id) => id === booking.clientId || id === booking.photographer.userId,
    );
    return Promise.resolve(isParty ? booking : null);
  });
  const auditCreate = vi.fn(() => Promise.resolve({}));
  const headObject = vi.fn(() =>
    Promise.resolve(
      options.stored === false ? null : { sizeBytes: 2048, contentType: 'application/pdf' },
    ),
  );
  const presignGet = vi.fn(() => Promise.resolve(SIGNED_URL));
  const enqueue = vi.fn(() =>
    options.enqueueFails ? Promise.reject(new Error('redis down')) : Promise.resolve(),
  );
  const error = vi.fn();

  const service = new BookingDocumentsService(
    {
      client: { booking: { findFirst }, auditLog: { create: auditCreate } },
    } as unknown as PrismaService,
    {
      config: { privateBucket: 'private' },
      headObject,
      presignGet,
    } as unknown as StorageService,
    { enqueue } as unknown as BookingDocumentsQueueService,
    { error, log: vi.fn(), warn: vi.fn() } as unknown as Logger,
  );
  return { service, findFirst, auditCreate, headObject, presignGet, enqueue, error };
}

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return error.getStatus();
    }
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('BookingDocumentsService.issueDownload', () => {
  it.each([
    [CLIENT, 'receipt'],
    [PHOTOGRAPHER, 'fee-invoice'],
  ] as const)('issues a presigned private download to its owner', async (user, document) => {
    const { service, findFirst, headObject, presignGet, auditCreate, enqueue } = setup();
    const before = Date.now();

    const result = await service.issueDownload(user, BOOKING_ID, document);

    const key = `bookings/${BOOKING_ID}/${document}.pdf`;
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: BOOKING_ID,
          OR: [{ clientId: user.id }, { photographer: { userId: user.id } }],
        },
      }),
    );
    expect(headObject).toHaveBeenCalledWith('private', key);
    expect(presignGet).toHaveBeenCalledWith({
      bucket: 'private',
      key,
      expiresInSeconds: 600,
      responseContentType: 'application/pdf',
      responseContentDisposition: `attachment; filename="photoo-${document}-${BOOKING_ID}.pdf"`,
    });
    expect(result.url).toBe(SIGNED_URL);
    const expiresAt = Date.parse(result.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorType: 'user',
        actorId: user.id,
        action: 'booking.document_download_issued',
        targetType: 'Booking',
        targetId: BOOKING_ID,
        after: { document },
      },
    });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(SIGNED_URL);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each(['receipt', 'fee-invoice'] as const)(
    'returns 404 for the %s to a user who is not a party to the booking',
    async (document: BookingDocument) => {
      const { service, headObject, presignGet, auditCreate } = setup();

      expect(await statusOf(service.issueDownload(STRANGER, BOOKING_ID, document))).toBe(404);
      expect(headObject).not.toHaveBeenCalled();
      expect(presignGet).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['client', CLIENT, 'fee-invoice'],
    ['photographer', PHOTOGRAPHER, 'receipt'],
  ] as const)(
    'returns 403 when the %s asks for the other party document',
    async (_label, user, document) => {
      const { service, headObject, presignGet } = setup();

      expect(await statusOf(service.issueDownload(user, BOOKING_ID, document))).toBe(403);
      expect(headObject).not.toHaveBeenCalled();
      expect(presignGet).not.toHaveBeenCalled();
    },
  );

  it('returns 409 before release without looking at storage', async () => {
    const { service, headObject, enqueue } = setup({
      booking: releasedBooking({ releasedAt: null }),
    });

    expect(await statusOf(service.issueDownload(CLIENT, BOOKING_ID, 'receipt'))).toBe(409);
    expect(headObject).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('returns 409 and re-enqueues only the missing document', async () => {
    const { service, presignGet, enqueue, auditCreate } = setup({ stored: false });

    expect(await statusOf(service.issueDownload(PHOTOGRAPHER, BOOKING_ID, 'fee-invoice'))).toBe(
      409,
    );
    expect(enqueue).toHaveBeenCalledWith(BOOKING_ID, ['fee-invoice']);
    expect(presignGet).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('still returns 409 and logs when the re-enqueue fails', async () => {
    const { service, error } = setup({ stored: false, enqueueFails: true });

    expect(await statusOf(service.issueDownload(CLIENT, BOOKING_ID, 'receipt'))).toBe(409);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: BOOKING_ID, document: 'receipt' }),
      'booking documents: could not re-enqueue a missing document',
    );
  });
});
