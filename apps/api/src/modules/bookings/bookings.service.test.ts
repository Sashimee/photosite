import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformSettingsService } from '../../common/platform-settings/platform-settings.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BookingReleaseService } from '../payments/booking-release.service.js';
import { BookingsService } from './bookings.service.js';

const CLIENT = { id: 'client-user' };
const PHOTOGRAPHER = { id: 'photographer-user' };
const STRANGER = { id: 'stranger-user' };
const DELIVERED_AT = new Date('2026-09-27T12:00:00.000Z');

interface UploadRow {
  id: string;
  ownerId: string;
  purpose: string;
  status: string;
  virusScanStatus: string;
}

interface BookingRow {
  id: string;
  status: string;
  clientId: string;
  photographer: { userId: string };
  delivery: { id: string; acceptedAt: Date | null } | null;
  releaseDueAt: Date | null;
  cancellationReason: string | null;
}

interface UpdateManyArgs {
  where: { status: string };
  data: { status: string; releaseDueAt?: Date; cancellationReason?: string | null };
}

function setup(
  overrides: Partial<BookingRow> = {},
  options: { uploads?: UploadRow[]; deliveredFiles?: number; autoReleaseDays?: number } = {},
) {
  const row: BookingRow = {
    id: 'booking-1',
    status: 'paid_held',
    clientId: CLIENT.id,
    photographer: { userId: PHOTOGRAPHER.id },
    delivery: null,
    releaseDueAt: null,
    cancellationReason: null,
    ...overrides,
  };
  const transitions: string[] = [];
  const audits: { action: string; after: Record<string, unknown> }[] = [];
  const deliveryUpdate = vi.fn((args: { data: { acceptedAt: Date } }) => {
    if (row.delivery) {
      row.delivery.acceptedAt = args.data.acceptedAt;
    }
    return Promise.resolve({});
  });
  const deliveryCreate = vi.fn(
    (args: { data: { bookingId: string; message: string; externalLink: string | null } }) =>
      Promise.resolve({
        id: 'delivery-1',
        ...args.data,
        deliveredAt: DELIVERED_AT,
        acceptedAt: null,
        files: [],
      }),
  );

  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([{ id: row.id }])),
    booking: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...row })),
      updateMany: vi.fn((args: UpdateManyArgs) => {
        if (row.status !== args.where.status) {
          return Promise.resolve({ count: 0 });
        }
        transitions.push(`${row.status}->${args.data.status}`);
        row.status = args.data.status;
        row.releaseDueAt = args.data.releaseDueAt ?? row.releaseDueAt;
        if (args.data.cancellationReason !== undefined) {
          row.cancellationReason = args.data.cancellationReason;
        }
        return Promise.resolve({ count: 1 });
      }),
    },
    upload: { findMany: vi.fn(() => Promise.resolve(options.uploads ?? [])) },
    deliveryFile: { count: vi.fn(() => Promise.resolve(options.deliveredFiles ?? 0)) },
    delivery: { create: deliveryCreate, update: deliveryUpdate },
    auditLog: {
      create: vi.fn((args: { data: { action: string; after: Record<string, unknown> } }) => {
        audits.push(args.data);
        return Promise.resolve({});
      }),
    },
  };
  const readRow = {
    id: row.id,
    quoteId: 'quote-1',
    clientId: CLIENT.id,
    photographerId: 'profile-1',
    scheduledAt: null,
    createdAt: DELIVERED_AT,
    updatedAt: DELIVERED_AT,
    paymentIntentId: null,
    chargeId: null,
    transferId: null,
    deliveredAt: null,
    releasedAt: null,
    cancelledAt: null,
    quote: { totalCents: 25050, currency: 'EUR' },
  };
  const prisma = {
    client: {
      $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      $queryRaw: vi.fn(() => Promise.resolve([])),
      booking: {
        findFirst: vi.fn(() =>
          Promise.resolve({
            ...readRow,
            status: row.status,
            releaseDueAt: row.releaseDueAt,
            cancellationReason: row.cancellationReason,
          }),
        ),
      },
    },
  } as unknown as PrismaService;
  const settings = {
    get: vi.fn(() =>
      Promise.resolve({ feePercent: '5.00', autoReleaseDays: options.autoReleaseDays ?? 7 }),
    ),
  } as unknown as PlatformSettingsService;
  const release = vi.fn(() =>
    Promise.resolve({ status: 'released' as const, transferId: 'tr_1', amountCents: 23797 }),
  );
  const logError = vi.fn();
  const logger = { log: vi.fn(), warn: vi.fn(), error: logError } as unknown as Logger;
  const service = new BookingsService(
    prisma,
    settings,
    { release } as unknown as BookingReleaseService,
    logger,
  );
  return {
    service,
    row,
    tx,
    transitions,
    audits,
    deliveryCreate,
    deliveryUpdate,
    release,
    logError,
  };
}

function readyUpload(id: string, overrides: Partial<UploadRow> = {}): UploadRow {
  return {
    id,
    ownerId: PHOTOGRAPHER.id,
    purpose: 'delivery_file',
    status: 'clean',
    virusScanStatus: 'clean',
    ...overrides,
  };
}

const LINK_DELIVERY = { message: 'Your photos', externalLink: 'https://example.com/album' };

describe('BookingsService.createDelivery', () => {
  it('moves a paid_held booking through in_progress to delivered and sets releaseDueAt from the settings', async () => {
    const { service, row, transitions } = setup({}, { autoReleaseDays: 3 });

    const result = await service.createDelivery(
      PHOTOGRAPHER,
      'booking-1',
      LINK_DELIVERY,
      '1.2.3.4',
    );

    expect(transitions).toEqual(['paid_held->in_progress', 'in_progress->delivered']);
    expect(row.releaseDueAt?.toISOString()).toBe('2026-09-30T12:00:00.000Z');
    expect(result.delivery).toEqual({
      id: 'delivery-1',
      bookingId: 'booking-1',
      message: 'Your photos',
      fileIds: null,
      externalLink: 'https://example.com/album',
      deliveredAt: DELIVERED_AT.toISOString(),
      acceptedAt: null,
    });
  });

  it('delivers an in_progress booking with a single transition', async () => {
    const { service, transitions } = setup({ status: 'in_progress' });

    await service.createDelivery(PHOTOGRAPHER, 'booking-1', LINK_DELIVERY, null);

    expect(transitions).toEqual(['in_progress->delivered']);
  });

  it.each(['pending_payment', 'delivered', 'released', 'refunded', 'cancelled', 'disputed'])(
    'rejects a delivery on a %s booking with a 409 and creates nothing',
    async (status) => {
      const { service, deliveryCreate } = setup({ status });

      await expect(
        service.createDelivery(PHOTOGRAPHER, 'booking-1', LINK_DELIVERY, null),
      ).rejects.toMatchObject({ status: 409 });
      expect(deliveryCreate).not.toHaveBeenCalled();
    },
  );

  it('rejects the client with a 403 and a stranger with a 404', async () => {
    const { service, deliveryCreate } = setup();

    await expect(
      service.createDelivery(CLIENT, 'booking-1', LINK_DELIVERY, null),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.createDelivery(STRANGER, 'booking-1', LINK_DELIVERY, null),
    ).rejects.toMatchObject({ status: 404 });
    expect(deliveryCreate).not.toHaveBeenCalled();
  });

  it('attaches ready delivery files owned by the photographer', async () => {
    const { service, deliveryCreate } = setup(
      {},
      { uploads: [readyUpload('up-1'), readyUpload('up-2', { status: 'processed' })] },
    );

    await service.createDelivery(
      PHOTOGRAPHER,
      'booking-1',
      { message: 'Files', fileIds: ['up-1', 'up-2'] },
      null,
    );

    expect(deliveryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          files: { create: [{ uploadId: 'up-1' }, { uploadId: 'up-2' }] },
        }) as unknown,
      }),
    );
  });

  it.each([
    ['missing', [] as UploadRow[], 0],
    ['foreign', [readyUpload('up-1', { ownerId: 'someone-else' })], 0],
    ['wrong purpose', [readyUpload('up-1', { purpose: 'avatar' })], 0],
    ['unscanned', [readyUpload('up-1', { virusScanStatus: 'pending' })], 0],
    ['already delivered', [readyUpload('up-1')], 1],
  ])('rejects a %s file with a 422', async (_label, uploads, deliveredFiles) => {
    const { service, deliveryCreate, transitions } = setup({}, { uploads, deliveredFiles });

    await expect(
      service.createDelivery(PHOTOGRAPHER, 'booking-1', { message: 'x', fileIds: ['up-1'] }, null),
    ).rejects.toMatchObject({ status: 422 });
    expect(deliveryCreate).not.toHaveBeenCalled();
    expect(transitions).toEqual([]);
  });

  it('rejects a file listed twice with a 422', async () => {
    const { service } = setup({}, { uploads: [readyUpload('up-1')] });

    await expect(
      service.createDelivery(
        PHOTOGRAPHER,
        'booking-1',
        { message: 'x', fileIds: ['up-1', 'up-1'] },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('BookingsService.acceptDelivery', () => {
  const delivered = {
    status: 'delivered',
    delivery: { id: 'delivery-1', acceptedAt: null },
  };

  it('records the acceptance, audits it and releases through the release service', async () => {
    const { service, row, audits, release } = setup({ ...delivered });

    await service.acceptDelivery(CLIENT, 'booking-1', '1.2.3.4');

    expect(row.delivery?.acceptedAt).toBeInstanceOf(Date);
    expect(audits.map((audit) => audit.action)).toEqual(['delivery.accepted']);
    expect(release).toHaveBeenCalledWith('booking-1', { type: 'user', id: CLIENT.id });
  });

  it('keeps the acceptance when the release fails and leaves it to the sweep', async () => {
    const { service, row, release, logError } = setup({ ...delivered });
    release.mockRejectedValueOnce(new Error('stripe down'));

    const booking = await service.acceptDelivery(CLIENT, 'booking-1', null);

    expect(booking.status).toBe('delivered');
    expect(row.delivery?.acceptedAt).toBeInstanceOf(Date);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'booking-1' }),
      expect.any(String),
    );
  });

  it('does not overwrite an earlier acceptance but still retries the release', async () => {
    const earlier = new Date('2026-09-26T00:00:00.000Z');
    const { service, row, deliveryUpdate, release } = setup({
      status: 'delivered',
      delivery: { id: 'delivery-1', acceptedAt: earlier },
    });

    await service.acceptDelivery(CLIENT, 'booking-1', null);

    expect(deliveryUpdate).not.toHaveBeenCalled();
    expect(row.delivery?.acceptedAt).toBe(earlier);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('rejects the photographer with a 403 and a stranger with a 404', async () => {
    const { service, release } = setup({ ...delivered });

    await expect(service.acceptDelivery(PHOTOGRAPHER, 'booking-1', null)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.acceptDelivery(STRANGER, 'booking-1', null)).rejects.toMatchObject({
      status: 404,
    });
    expect(release).not.toHaveBeenCalled();
  });

  it('rejects a booking that is not delivered with a 409', async () => {
    const { service, release } = setup({ status: 'paid_held' });

    await expect(service.acceptDelivery(CLIENT, 'booking-1', null)).rejects.toMatchObject({
      status: 409,
    });
    expect(release).not.toHaveBeenCalled();
  });
});

describe('BookingsService.cancel', () => {
  it('lets either party cancel a pending_payment booking and stores the reason', async () => {
    const { service, row, audits } = setup({ status: 'pending_payment' });

    const booking = await service.cancel(PHOTOGRAPHER, 'booking-1', { reason: 'ill' }, null);

    expect(row.status).toBe('cancelled');
    expect(booking.cancellationReason).toBe('ill');
    expect(audits[0]).toMatchObject({
      action: 'booking.cancelled',
      after: { status: 'cancelled', role: 'photographer' },
    });
  });

  it.each(['paid_held', 'in_progress', 'delivered', 'released', 'cancelled'])(
    'rejects cancelling a %s booking with a 409',
    async (status) => {
      const { service, row } = setup({ status });

      await expect(service.cancel(CLIENT, 'booking-1', {}, null)).rejects.toMatchObject({
        status: 409,
      });
      expect(row.status).toBe(status);
    },
  );

  it('hides the booking from a stranger with a 404', async () => {
    const { service } = setup({ status: 'pending_payment' });

    await expect(service.cancel(STRANGER, 'booking-1', {}, null)).rejects.toMatchObject({
      status: 404,
    });
  });
});
