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
  const findTransfer = vi.spyOn(gateway, 'findTransfer');

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
    $queryRaw: vi.fn((_sql: TemplateStringsArray, id: string) =>
      Promise.resolve(id === row.id ? [{ id: row.id }] : []),
    ),
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
      createMany: vi.fn((args: { data: LedgerRow[]; skipDuplicates?: boolean }) => {
        const fresh = args.data.filter(
          (entry) =>
            !ledger.some(
              (existing) =>
                existing.bookingId === entry.bookingId &&
                existing.type === entry.type &&
                existing.stripeObjectId === entry.stripeObjectId,
            ),
        );
        if (fresh.length !== args.data.length && !args.skipDuplicates) {
          return Promise.reject(new Error('unique constraint on LedgerEntry'));
        }
        ledger.push(...fresh);
        return Promise.resolve({ count: fresh.length });
      }),
    },
    auditLog: {
      create: vi.fn((args: { data: { action: string; after: Record<string, unknown> } }) => {
        audits.push(args.data);
        return Promise.resolve({});
      }),
    },
  };
  // Transactions run one at a time, standing in for the FOR UPDATE row lock,
  // and roll the in-memory rows back when they throw.
  let lock: Promise<unknown> = Promise.resolve();
  const runTransaction = async (fn: (client: typeof tx) => Promise<unknown>) => {
    const snapshot = { row: { ...row }, ledger: ledger.length, audits: audits.length };
    try {
      return await fn(tx);
    } catch (error) {
      Object.assign(row, snapshot.row);
      ledger.length = snapshot.ledger;
      audits.length = snapshot.audits;
      throw error;
    }
  };
  const prisma = {
    client: {
      $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => {
        const run = lock.then(() => runTransaction(fn));
        lock = run.catch(() => undefined);
        return run;
      }),
      booking: {
        findMany: vi.fn(() => Promise.resolve((options.dueIds ?? [row.id]).map((id) => ({ id })))),
      },
    },
  } as unknown as PrismaService;
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new BookingReleaseService(prisma, gateway, logger as unknown as Logger);
  return {
    service,
    row,
    ledger,
    audits,
    tx,
    prisma,
    gateway,
    createTransfer,
    findTransfer,
    account,
    logger,
  };
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

  it('pays out from the charged quote snapshot even when the fee helper would round differently', async () => {
    const { service, ledger, row } = await setup({
      quote: {
        subtotalCents: 25050,
        platformFeeCents: 1300,
        feePercent: new Prisma.Decimal('5.00'),
        totalCents: 25050,
        currency: 'EUR',
      },
    });

    const outcome = await service.release('booking-1', user, NOW);

    expect(outcome).toEqual({ status: 'released', transferId: row.transferId, amountCents: 23750 });
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

  it('two runs in a row look up the transfer group and produce exactly one transfer', async () => {
    const { service, gateway, createTransfer, findTransfer, row } = await setup();

    await service.release('booking-1', user, NOW);
    await service.release('booking-1', { type: 'system', id: null }, NOW);

    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(findTransfer).toHaveBeenCalledWith('booking_booking-1', 'booking-1');
    const found = await gateway.findTransfer('booking_booking-1', 'booking-1');
    expect(found?.id).toBe(row.transferId);
  });

  it('two overlapping runs share one transfer through the idempotency key and record it once', async () => {
    const { service, ledger, createTransfer, row } = await setup();

    const outcomes = await Promise.all([
      service.release('booking-1', user, NOW),
      service.release('booking-1', { type: 'system', id: null }, NOW),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['released', 'skipped']);
    const transferIds = await Promise.all(
      createTransfer.mock.results.map(
        async (result) => ((await result.value) as { id: string }).id,
      ),
    );
    expect(new Set(transferIds)).toEqual(new Set([row.transferId]));
    expect(ledger).toHaveLength(3);
    expect(ledger.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
  });

  it('reuses the transfer on retry when recording the release failed after Stripe succeeded', async () => {
    const { service, gateway, tx, ledger, row, audits, createTransfer, findTransfer } =
      await setup();
    tx.auditLog.create.mockRejectedValueOnce(new Error('connection reset'));

    await expect(service.release('booking-1', user, NOW)).rejects.toThrow(/connection reset/);
    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('delivered');
    expect(row.transferId).toBeNull();
    expect(ledger).toHaveLength(1);
    const created = await gateway.findTransfer('booking_booking-1', 'booking-1');

    const retry = await service.release('booking-1', { type: 'system', id: null }, NOW);

    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(findTransfer).toHaveBeenCalledTimes(3);
    expect(created).not.toBeNull();
    expect(row.transferId).toBe(created?.id);
    expect(retry).toEqual({ status: 'released', transferId: row.transferId, amountCents: 23797 });
    expect(row.status).toBe('released');
    expect(ledger.map((entry) => [entry.type, entry.amountCents, entry.stripeObjectId])).toEqual([
      ['charge', 25050, 'ch_1'],
      ['transfer', -23797, row.transferId],
      ['platform_fee', -1253, row.transferId],
    ]);
    expect(ledger.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(0);
    expect(audits.map((audit) => audit.action)).toEqual(['booking.released']);
  });

  it('records the ledger and fails loudly when the booking left delivered during the transfer', async () => {
    const { service, gateway, row, ledger, audits, logger } = await setup();
    const create = gateway.createTransfer.bind(gateway);
    vi.spyOn(gateway, 'createTransfer').mockImplementationOnce(async (input) => {
      const transfer = await create(input);
      row.status = 'disputed';
      return transfer;
    });

    await expect(service.release('booking-1', user, NOW)).rejects.toThrow(
      /was created but booking booking-1 is now disputed/,
    );

    expect(row.status).toBe('disputed');
    expect(row.transferId).toBeNull();
    expect(ledger.map((entry) => entry.type)).toEqual(['charge', 'transfer', 'platform_fee']);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'booking.release_conflict',
        after: expect.objectContaining({ amountCents: 23797 }) as unknown,
      }),
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('refuses a found transfer whose amount does not match the booking', async () => {
    const { service, gateway, account, row, ledger } = await setup();
    await gateway.createTransfer({
      amountCents: 100,
      currency: 'EUR',
      destinationAccountId: account.id,
      sourceTransactionId: 'ch_1',
      transferGroup: 'booking_booking-1',
      metadata: { bookingId: 'booking-1' },
      idempotencyKey: 'manual',
    });

    await expect(service.release('booking-1', user, NOW)).rejects.toThrow(/does not match/);
    expect(row.status).toBe('delivered');
    expect(ledger).toHaveLength(1);
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

  it.each(['paid_held', 'refunded', 'cancelled'])(
    'rejects a %s booking with a 409 illegal transition',
    async (status) => {
      const { service, createTransfer } = await setup({ status });

      await expect(service.release('booking-1', user, NOW)).rejects.toMatchObject({
        status: 409,
      });
      expect(createTransfer).not.toHaveBeenCalled();
    },
  );

  it('rejects a delivery that is neither accepted nor due with a 409', async () => {
    const { service, createTransfer } = await setup({ releaseDueAt: FUTURE });

    await expect(service.release('booking-1', user, NOW)).rejects.toMatchObject({ status: 409 });
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('returns 404 when the booking does not exist', async () => {
    const { service } = await setup();

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
    const { service } = await setup({}, { dueIds: ['booking-1', 'booking-1', 'missing'] });

    const result = await service.sweep(NOW);

    expect(result).toEqual({ attempted: 3, released: 1, skipped: 1, failed: 1 });
  });

  it('running the sweep twice for the same due booking transfers and ledgers once', async () => {
    const { service, ledger, createTransfer } = await setup();

    const first = await service.sweep(NOW);
    const second = await service.sweep(NOW);

    expect(first).toEqual({ attempted: 1, released: 1, skipped: 0, failed: 0 });
    expect(second).toEqual({ attempted: 1, released: 0, skipped: 1, failed: 0 });
    expect(createTransfer).toHaveBeenCalledTimes(1);
    expect(ledger).toHaveLength(3);
  });
});
