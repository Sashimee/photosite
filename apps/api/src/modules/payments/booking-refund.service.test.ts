import { HttpException } from '@nestjs/common';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import type { AdminBookingsService } from './admin-bookings.service.js';
import {
  BookingRefundService,
  refundIdempotencyKey,
  refundReversalIdempotencyKey,
  transferReversalIdempotencyKey,
} from './booking-refund.service.js';
import { FakeStripeGateway } from './stripe/fake-stripe-gateway.js';

const NOW = new Date('2026-09-27T12:00:00.000Z');
const TOTAL = 25050;
const FEE = 1253;
const PAYOUT = TOTAL - FEE;

interface BookingRow {
  id: string;
  status: string;
  clientId: string;
  photographerId: string;
  photographer: { userId: string };
  paymentIntentId: string | null;
  chargeId: string | null;
  transferId: string | null;
  releasedAt: Date | null;
  quote: { totalCents: number; platformFeeCents: number; currency: string };
}

interface LedgerRow {
  bookingId: string;
  type: string;
  amountCents: number;
  currency: string;
  stripeObjectId: string;
}

interface AuditRow {
  actorType: string;
  actorId: string;
  action: string;
  targetId: string;
  after?: Record<string, unknown>;
}

async function setup(overrides: Partial<BookingRow> = {}, options: { openDisputes?: number } = {}) {
  const gateway = new FakeStripeGateway('whsec_unit', () => NOW);
  const account = await gateway.createConnectedAccount({
    country: 'LU',
    metadata: {},
    idempotencyKey: 'acct-unit',
  });
  const intent = await gateway.createPaymentIntent({
    amountCents: TOTAL,
    currency: 'EUR',
    transferGroup: 'booking_booking-1',
    metadata: {},
    idempotencyKey: 'pi-unit',
  });
  const createRefund = vi.spyOn(gateway, 'createRefund');
  const reverseTransfer = vi.spyOn(gateway, 'reverseTransfer');

  const row: BookingRow = {
    id: 'booking-1',
    status: 'delivered',
    clientId: 'client-1',
    photographerId: 'photographer-profile-1',
    photographer: { userId: 'photographer-1' },
    paymentIntentId: intent.id,
    chargeId: 'ch_1',
    transferId: null,
    releasedAt: null,
    quote: { totalCents: TOTAL, platformFeeCents: FEE, currency: 'EUR' },
    ...overrides,
  };
  const ledger: LedgerRow[] = [
    {
      bookingId: row.id,
      type: 'charge',
      amountCents: TOTAL,
      currency: 'EUR',
      stripeObjectId: 'ch_1',
    },
  ];

  async function release(): Promise<void> {
    const transfer = await gateway.createTransfer({
      amountCents: PAYOUT,
      currency: 'EUR',
      destinationAccountId: account.id,
      sourceTransactionId: 'ch_1',
      transferGroup: 'booking_booking-1',
      metadata: { bookingId: row.id },
      idempotencyKey: 'transfer-unit',
    });
    row.status = 'released';
    row.transferId = transfer.id;
    row.releasedAt = NOW;
    ledger.push(
      {
        bookingId: row.id,
        type: 'transfer',
        amountCents: -PAYOUT,
        currency: 'EUR',
        stripeObjectId: transfer.id,
      },
      {
        bookingId: row.id,
        type: 'platform_fee',
        amountCents: -FEE,
        currency: 'EUR',
        stripeObjectId: transfer.id,
      },
    );
  }

  const audits: AuditRow[] = [];
  const tx = {
    $queryRaw: vi.fn((_sql: TemplateStringsArray, id: string) =>
      Promise.resolve(id === row.id ? [{ id: row.id }] : []),
    ),
    booking: {
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ ...row, quote: { ...row.quote } })),
      updateMany: vi.fn((args: { where: { status: string }; data: { status: string } }) => {
        if (row.status !== args.where.status) {
          return Promise.resolve({ count: 0 });
        }
        row.status = args.data.status;
        return Promise.resolve({ count: 1 });
      }),
    },
    dispute: { count: vi.fn(() => Promise.resolve(options.openDisputes ?? 0)) },
    ledgerEntry: {
      groupBy: vi.fn((args: { where: { type: { in: string[] } } }) => {
        const groups = new Map<string, { sum: number; count: number }>();
        for (const entry of ledger.filter((entry) => args.where.type.in.includes(entry.type))) {
          const group = groups.get(entry.type) ?? { sum: 0, count: 0 };
          groups.set(entry.type, { sum: group.sum + entry.amountCents, count: group.count + 1 });
        }
        return Promise.resolve(
          [...groups].map(([type, group]) => ({
            bookingId: row.id,
            type,
            _sum: { amountCents: group.sum },
            _count: { _all: group.count },
          })),
        );
      }),
      createMany: vi.fn((args: { data: LedgerRow[]; skipDuplicates?: boolean }) => {
        const fresh = args.data.filter(
          (entry) =>
            !ledger.some(
              (existing) =>
                existing.type === entry.type && existing.stripeObjectId === entry.stripeObjectId,
            ),
        );
        ledger.push(...fresh);
        return Promise.resolve({ count: fresh.length });
      }),
    },
    auditLog: {
      create: vi.fn((args: { data: AuditRow }) => {
        audits.push(args.data);
        return Promise.resolve({});
      }),
      findMany: vi.fn((args: { where: { action: string } }) =>
        Promise.resolve(
          audits
            .filter((audit) => audit.action === args.where.action)
            .map((audit) => ({ after: audit.after ?? null })),
        ),
      ),
    },
  };
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
      $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => runTransaction(fn)),
      $queryRaw: vi.fn(() => Promise.resolve([])),
      booking: {
        findUniqueOrThrow: vi.fn(() =>
          Promise.resolve({
            ...row,
            scheduledAt: null,
            quoteId: 'quote-1',
            releaseDueAt: null,
            deliveredAt: null,
            cancelledAt: null,
            cancellationReason: null,
          }),
        ),
      },
    },
  } as unknown as PrismaService;
  const adminBookings = {
    get: vi.fn((id: string) => Promise.resolve({ id, status: row.status })),
  } as unknown as AdminBookingsService;
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new BookingRefundService(
    prisma,
    gateway,
    new AdminAuditService(),
    adminBookings,
    logger as unknown as Logger,
  );
  return { service, row, ledger, audits, gateway, createRefund, reverseTransfer, release };
}

const client = { id: 'client-1' };
const admin = { id: 'admin-1' };

async function httpStatus(promise: Promise<unknown>): Promise<number> {
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

function ledgerSum(ledger: LedgerRow[]): number {
  return ledger.reduce((sum, entry) => sum + entry.amountCents, 0);
}

describe('idempotency keys', () => {
  it('numbers refunds per booking and derives the reversal keys from them', () => {
    expect(refundIdempotencyKey('b1', 0)).toBe('refund_b1_0');
    expect(refundReversalIdempotencyKey('refund_b1_2')).toBe('refund_b1_2_reversal');
    expect(transferReversalIdempotencyKey('b1', 1)).toBe('booking_b1_reversal_1');
  });
});

describe('BookingRefundService.refundAsClient', () => {
  it('refunds the full remainder when no amount is given and moves the booking to refunded', async () => {
    const { service, row, ledger, audits, createRefund } = await setup();

    const result = await service.refundAsClient(
      client,
      'booking-1',
      { reason: 'cancelled' },
      '10.0.0.1',
    );

    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: TOTAL, idempotencyKey: 'refund_booking-1_0' }),
    );
    expect(result).toMatchObject({
      status: 'refunded',
      amount: { amountCents: TOTAL, currency: 'EUR' },
      refundedTotal: { amountCents: TOTAL, currency: 'EUR' },
    });
    expect(row.status).toBe('refunded');
    expect(ledger.at(-1)).toMatchObject({ type: 'refund', amountCents: -TOTAL });
    expect(ledgerSum(ledger)).toBe(0);
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'booking.refunded',
        actorType: 'user',
        actorId: 'client-1',
      }),
    ]);
  });

  it('keeps the state on a partial refund and numbers the next key after it', async () => {
    const { service, row, audits, createRefund } = await setup({ status: 'paid_held' });

    const first = await service.refundAsClient(
      client,
      'booking-1',
      { amountCents: 5000, reason: 'r' },
      null,
    );
    expect(first).toMatchObject({
      status: 'partially_refunded',
      refundedTotal: { amountCents: 5000 },
    });
    expect(row.status).toBe('paid_held');
    expect(audits.at(-1)).toMatchObject({ action: 'booking.refund_partial' });

    const rest = await service.refundAsClient(client, 'booking-1', { reason: 'r' }, null);
    expect(createRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ amountCents: TOTAL - 5000, idempotencyKey: 'refund_booking-1_1' }),
    );
    expect(rest.status).toBe('refunded');
    expect(row.status).toBe('refunded');
  });

  it('rejects an amount above what is still refundable with 422 and calls no Stripe', async () => {
    const { service, createRefund } = await setup();
    await expect(
      httpStatus(
        service.refundAsClient(client, 'booking-1', { amountCents: TOTAL + 1, reason: 'r' }, null),
      ),
    ).resolves.toBe(422);
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('rejects a partial refund that would leave no more than the platform fee', async () => {
    const { service, createRefund } = await setup();
    await expect(
      httpStatus(
        service.refundAsClient(
          client,
          'booking-1',
          { amountCents: TOTAL - FEE, reason: 'r' },
          null,
        ),
      ),
    ).resolves.toBe(422);
    expect(createRefund).not.toHaveBeenCalled();
  });

  it.each(['pending_payment', 'released', 'refunded', 'disputed', 'cancelled'])(
    'returns 409 for a %s booking',
    async (status) => {
      const { service, createRefund } = await setup({ status });
      await expect(
        httpStatus(service.refundAsClient(client, 'booking-1', { reason: 'r' }, null)),
      ).resolves.toBe(409);
      expect(createRefund).not.toHaveBeenCalled();
    },
  );

  it('returns 409 while a dispute is open or before the charge settled', async () => {
    const disputed = await setup({}, { openDisputes: 1 });
    await expect(
      httpStatus(disputed.service.refundAsClient(client, 'booking-1', { reason: 'r' }, null)),
    ).resolves.toBe(409);
    const unsettled = await setup({ chargeId: null });
    await expect(
      httpStatus(unsettled.service.refundAsClient(client, 'booking-1', { reason: 'r' }, null)),
    ).resolves.toBe(409);
  });

  it('forbids the photographer and hides the booking from strangers', async () => {
    const { service } = await setup();
    await expect(
      httpStatus(
        service.refundAsClient({ id: 'photographer-1' }, 'booking-1', { reason: 'r' }, null),
      ),
    ).resolves.toBe(403);
    await expect(
      httpStatus(service.refundAsClient({ id: 'someone' }, 'booking-1', { reason: 'r' }, null)),
    ).resolves.toBe(404);
    await expect(
      httpStatus(
        service.refundAsClient(
          { id: 'photographer-profile-1' },
          'booking-1',
          { reason: 'r' },
          null,
        ),
      ),
    ).resolves.toBe(404);
    await expect(
      httpStatus(service.refundAsClient(client, 'missing', { reason: 'r' }, null)),
    ).resolves.toBe(404);
  });
});

describe('BookingRefundService.refundAsAdmin', () => {
  it('reverses the transfer before refunding and records both in the ledger', async () => {
    const { service, row, ledger, audits, createRefund, reverseTransfer, release } = await setup();
    await release();

    await service.refundAsAdmin(
      admin,
      'booking-1',
      { amountCents: 4000, reason: 'bad photos' },
      '10.0.0.2',
    );

    expect(reverseTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId: row.transferId,
        amountCents: 4000,
        idempotencyKey: 'refund_booking-1_0_reversal',
      }),
    );
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 4000, idempotencyKey: 'refund_booking-1_0' }),
    );
    expect(reverseTransfer.mock.invocationCallOrder[0]).toBeLessThan(
      createRefund.mock.invocationCallOrder[0] ?? 0,
    );
    expect(ledger.slice(-2).map((entry) => [entry.type, entry.amountCents])).toEqual([
      ['reversal', 4000],
      ['refund', -4000],
    ]);
    expect(ledgerSum(ledger)).toBe(0);
    expect(row.status).toBe('released');
    expect(audits.map((audit) => audit.action)).toEqual([
      'booking.refund_reversal',
      'booking.admin_refund',
    ]);
  });

  it('moves the booking to refunded once the whole transfer is reversed', async () => {
    const { service, row, ledger, audits, release } = await setup();
    await release();

    await service.refundAsAdmin(admin, 'booking-1', { amountCents: PAYOUT, reason: 'r' }, null);

    expect(row.status).toBe('refunded');
    expect(ledgerSum(ledger)).toBe(0);
    expect(audits.at(-1)).toMatchObject({ action: 'booking.refunded', actorType: 'admin' });
  });

  it('fails cleanly with 422 when the refund exceeds the reversible balance', async () => {
    const { service, ledger, audits, createRefund, reverseTransfer, release } = await setup();
    await release();
    const before = ledger.length;

    await expect(
      httpStatus(
        service.refundAsAdmin(admin, 'booking-1', { amountCents: PAYOUT + 1, reason: 'r' }, null),
      ),
    ).resolves.toBe(422);
    expect(reverseTransfer).not.toHaveBeenCalled();
    expect(createRefund).not.toHaveBeenCalled();
    expect(ledger).toHaveLength(before);
    expect(audits).toEqual([]);
  });

  it('resumes with the refund when an earlier attempt reversed and then failed', async () => {
    const { service, ledger, gateway, createRefund, reverseTransfer, release } = await setup();
    await release();
    createRefund.mockRejectedValueOnce(new Error('stripe unavailable'));

    await expect(
      service.refundAsAdmin(admin, 'booking-1', { amountCents: 3000, reason: 'r' }, null),
    ).rejects.toThrow(/stripe unavailable/);
    expect(ledger.at(-1)).toMatchObject({ type: 'reversal', amountCents: 3000 });

    await expect(
      httpStatus(
        service.refundAsAdmin(admin, 'booking-1', { amountCents: 2000, reason: 'r' }, null),
      ),
    ).resolves.toBe(409);

    await service.refundAsAdmin(admin, 'booking-1', { amountCents: 3000, reason: 'r' }, null);
    expect(reverseTransfer).toHaveBeenCalledTimes(1);
    expect(ledger.at(-1)).toMatchObject({ type: 'refund', amountCents: -3000 });
    expect(ledgerSum(ledger)).toBe(0);
    await expect(
      gateway.createRefund({
        paymentIntentId: 'pi_fake_1',
        amountCents: TOTAL - 2999,
        metadata: {},
        idempotencyKey: 'probe',
      }),
    ).rejects.toThrow(/exceeds the unrefunded amount/);
  });

  it('returns 409 before release', async () => {
    const { service, reverseTransfer } = await setup();
    await expect(
      httpStatus(
        service.refundAsAdmin(admin, 'booking-1', { amountCents: 100, reason: 'r' }, null),
      ),
    ).resolves.toBe(409);
    expect(reverseTransfer).not.toHaveBeenCalled();
  });
});

describe('BookingRefundService.reverseTransferAsAdmin', () => {
  it('reverses whatever is left on the transfer without changing the status', async () => {
    const { service, row, ledger, audits, reverseTransfer, release } = await setup();
    await release();

    await service.reverseTransferAsAdmin(admin, 'booking-1', { reason: 'fraud' }, null);

    expect(reverseTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: PAYOUT,
        idempotencyKey: 'booking_booking-1_reversal_0',
      }),
    );
    expect(ledger.at(-1)).toMatchObject({ type: 'reversal', amountCents: PAYOUT });
    expect(row.status).toBe('released');
    expect(audits).toEqual([expect.objectContaining({ action: 'booking.transfer_reversed' })]);

    await expect(
      httpStatus(service.reverseTransferAsAdmin(admin, 'booking-1', { reason: 'again' }, null)),
    ).resolves.toBe(422);
  });

  it('allows a disputed booking that was released and refuses one that was not', async () => {
    const released = await setup();
    await released.release();
    released.row.status = 'disputed';
    await released.service.reverseTransferAsAdmin(admin, 'booking-1', { reason: 'r' }, null);
    expect(released.row.status).toBe('disputed');

    const held = await setup({ status: 'disputed' });
    await expect(
      httpStatus(held.service.reverseTransferAsAdmin(admin, 'booking-1', { reason: 'r' }, null)),
    ).resolves.toBe(409);
  });
});
