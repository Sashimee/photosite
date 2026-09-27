import { Prisma } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { BookingReleaseService, transferIdempotencyKey } from './booking-release.service.js';
import { FakeStripeGateway } from './stripe/fake-stripe-gateway.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const PAST = new Date('2026-09-20T12:00:00.000Z');
const FUTURE = new Date('2026-10-04T12:00:00.000Z');

interface BookingRow {
  id: string;
  status: string;
  chargeId: string | null;
  transferId: string | null;
  releaseDueAt: Date | null;
  quote: {
    subtotalCents: number;
    platformFeeCents: number;
    feePercent: Prisma.Decimal;
    totalCents: number;
    currency: string;
  };
  delivery: { acceptedAt: Date | null } | null;
  photographer: { stripeAccountId: string | null };
}

interface LedgerRow {
  bookingId: string;
  type: string;
  amountCents: number;
  currency: string;
  stripeObjectId: string;
}

async function setup(
  overrides: Partial<BookingRow> = {},
  options: { openDisputes?: number; dueIds?: string[] } = {},
) {
  const gateway = new FakeStripeGateway('whsec_unit', () => NOW);
  const account = await gateway.createConnectedAccount({
    country: 'LU',
    metadata: {},
    idempotencyKey: 'acct-unit',
  });
  const createTransfer = vi.spyOn(gateway, 'createTransfer');

  const row: BookingRow = {
    id: 'booking-1',
    status: 'delivered',
    chargeId: 'ch_1',
    transferId: null,
    releaseDueAt: PAST,
    quote: {
      subtotalCents: 25050,
      platformFeeCents: 1253,
      feePercent: new Prisma.Decimal('5.00'),
      totalCents: 25050,
      currency: 'EUR',
    },
    delivery: { acceptedAt: null },
    photographer: { stripeAccountId: account.id },
    ...overrides,
  };
  const ledger: LedgerRow[] = [
    {
      bookingId: row.id,
      type: 'charge',
      amountCents: row.quote.totalCents,
      currency: row.quote.currency,
      stripeObjectId: 'ch_1',
    },
  ];
  const audits: { action: string; after: Record<string, unknown> }[] = [];

  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([{ id: row.id }])),
    booking: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...row })),
      updateMany: vi.fn(
        (args: { where: { status: string }; data: { status: string; transferId?: string } }) => {
          if (row.status !== args.where.status) {
            return Promise.resolve({ count: 0 });
          }
          row.status = args.data.status;
          row.transferId = args.data.transferId ?? row.transferId;
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    dispute: { count: vi.fn(() => Promise.resolve(options.openDisputes ?? 0)) },
    ledgerEntry: {
      createMany: vi.fn((args: { data: LedgerRow[] }) => {
        ledger.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      }),
    },
    auditLog: {
      create: vi.fn((args: { data: { action: string; after: Record<string, unknown> } }) => {
        audits.push(args.data);
        return Promise.resolve({});
      }),
    },
  };
  const prisma = {
    client: {
      $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
      booking: {
        findMany: vi.fn(() => Promise.resolve((options.dueIds ?? [row.id]).map((id) => ({ id })))),
      },
    },
  } as unknown as PrismaService;
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new BookingReleaseService(prisma, gateway, logger as unknown as Logger);
  return { service, row, ledger, audits, tx, createTransfer, account, logger };
}

const user = { type: 'user' as const, id: 'client-1' };

describe('BookingReleaseService.release', () => {
  it('transfers subtotal minus fee from the charge to the photographer and releases the booking', async () => {
    const { service, row, createTransfer, account, audits } = await setup();

    const outcome = await service.release('booking-1', user, NOW);

    expect(outcome).toEqual({ status: 'released', transferId: row.transferId, amountCents: 23797 });
    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(createTransfer).toHaveBeenCalledWith({
      amountCents: 25050 - 1253,
      currency: 'EUR',
      destinationAccountId: account.id,
      sourceTransactionId: 'ch_1',
      transferGroup: 'booking_booking-1',
      metadata: { bookingId: 'booking-1' },
      idempotencyKey: 'booking_booking-1_transfer',
    });
    expect(transferIdempotencyKey('booking-1')).toBe('booking_booking-1_transfer');
    expect(row.status).toBe('released');
    expect(row.transferId).toMatch(/^tr_fake/);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'booking.released',
        after: expect.objectContaining({
          transferId: row.transferId,
          amountCents: 23797,
          platformFeeCents: 1253,
          trigger: 'release_due',
        }) as unknown,
      }),
    ]);
  });

  it('writes transfer and platform_fee ledger rows that sum to zero with the charge', async () => {
    const { service, ledger, row } = await setup();

    await service.release('booking-1', user, NOW);

    expect(ledger.map((entry) => [entry.type, entry.amountCents, entry.stripeObjectId])).toEqual([
      ['charge', 25050, 'ch_1'],
      ['transfer', -23797, row.transferId],
      ['platform_fee', -1253, row.transferId],
    ]);
    expect(ledger.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
  });

  it('releases an accepted delivery before releaseDueAt and records the trigger', async () => {
    const { service, row, audits } = await setup({
      releaseDueAt: FUTURE,
      delivery: { acceptedAt: NOW },
    });

    await service.release('booking-1', user, NOW);

    expect(row.status).toBe('released');
    expect(audits[0]?.after).toMatchObject({ trigger: 'accepted' });
  });

  it('is idempotent: a second run is skipped and creates no second transfer or ledger rows', async () => {
    const { service, ledger, createTransfer } = await setup();

    const first = await service.release('booking-1', user, NOW);
    const second = await service.release('booking-1', { type: 'system', id: null }, NOW);

    expect(first.status).toBe('released');
    expect(second).toEqual({ status: 'skipped', reason: 'already_released' });
    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(ledger).toHaveLength(3);
  });

  it('skips a disputed booking without calling Stripe', async () => {
    const { service, row, ledger, createTransfer } = await setup({ status: 'disputed' });

    const outcome = await service.release('booking-1', user, NOW);

    expect(outcome).toEqual({ status: 'skipped', reason: 'disputed' });
    expect(createTransfer).not.toHaveBeenCalled();
    expect(row.status).toBe('disputed');
    expect(ledger).toHaveLength(1);
  });

  it('skips a delivered booking that has an open dispute row', async () => {
    const { service, row, createTransfer, logger } = await setup({}, { openDisputes: 1 });

    const outcome = await service.release('booking-1', user, NOW);

    expect(outcome).toEqual({ status: 'skipped', reason: 'disputed' });
    expect(createTransfer).not.toHaveBeenCalled();
    expect(row.status).toBe('delivered');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rejects a booking that is not delivered with a 409 illegal transition', async () => {
    const { service, createTransfer } = await setup({ status: 'paid_held' });

    await expect(service.release('booking-1', user, NOW)).rejects.toMatchObject({ status: 409 });
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('rejects a delivery that is neither accepted nor due with a 409', async () => {
    const { service, createTransfer } = await setup({ releaseDueAt: FUTURE });

    await expect(service.release('booking-1', user, NOW)).rejects.toMatchObject({ status: 409 });
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('returns 404 when the booking does not exist', async () => {
    const { service, tx } = await setup();
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.release('missing', user, NOW)).rejects.toMatchObject({ status: 404 });
  });

  it('fails loudly when the photographer has no Stripe account', async () => {
    const { service, createTransfer } = await setup({ photographer: { stripeAccountId: null } });

    await expect(service.release('booking-1', user, NOW)).rejects.toThrow(/no Stripe account/);
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('fails loudly when the booking has no charge to transfer from', async () => {
    const { service, createTransfer } = await setup({ chargeId: null });

    await expect(service.release('booking-1', user, NOW)).rejects.toThrow(/no chargeId/);
    expect(createTransfer).not.toHaveBeenCalled();
  });
});

describe('BookingReleaseService.sweep', () => {
  it('releases due bookings and counts skips and failures without stopping', async () => {
    const { service, tx } = await setup({}, { dueIds: ['booking-1', 'booking-1', 'missing'] });
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 'booking-1' }])
      .mockResolvedValueOnce([{ id: 'booking-1' }])
      .mockResolvedValueOnce([]);

    const result = await service.sweep(NOW);

    expect(result).toEqual({ attempted: 3, released: 1, skipped: 1, failed: 1 });
  });
});
