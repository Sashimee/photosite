import { Prisma } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { TEST_ENV } from '../../testing/test-env.js';
import type { StripeConnectService } from './stripe-connect.service.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import type { GatewayEvent } from './stripe/stripe-gateway.js';

interface BookingRow {
  id: string;
  status: string;
  chargeId: string | null;
  quote: {
    id: string;
    subtotalCents: number;
    platformFeeCents: number;
    feePercent: Prisma.Decimal;
    totalCents: number;
    currency: string;
  };
}

function bookingRow(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 'booking-1',
    status: 'pending_payment',
    chargeId: null,
    quote: {
      id: 'quote-1',
      subtotalCents: 25050,
      platformFeeCents: 1253,
      feePercent: new Prisma.Decimal('5.00'),
      totalCents: 25050,
      currency: 'EUR',
    },
    ...overrides,
  };
}

function succeeded(
  overrides: Partial<Record<string, unknown>> = {},
  eventId = 'evt_1',
): GatewayEvent {
  return {
    id: eventId,
    type: 'payment_intent.succeeded',
    livemode: false,
    data: {
      object: {
        id: 'pi_1',
        object: 'payment_intent',
        amount: 25050,
        currency: 'eur',
        latest_charge: 'ch_1',
        ...overrides,
      },
    },
  };
}

function setup(
  options: {
    booking?: BookingRow | null;
    alreadyStored?: { processedAt: Date | null };
    env?: Partial<Env>;
  } = {},
) {
  const row = options.booking === undefined ? bookingRow() : options.booking;
  const tx = {
    stripeEvent: {
      createMany: vi.fn(() => Promise.resolve({ count: options.alreadyStored ? 0 : 1 })),
      update: vi.fn(() => Promise.resolve({})),
    },
    $queryRaw: vi.fn((): Promise<{ payload?: unknown; processedAt: Date | null }[]> =>
      Promise.resolve(options.alreadyStored ? [options.alreadyStored] : []),
    ),
    booking: {
      findUnique: vi.fn(() => Promise.resolve(row)),
      updateMany: vi.fn(({ where }: { where: { status: string } }) =>
        Promise.resolve({ count: row?.status === where.status ? 1 : 0 }),
      ),
    },
    auditLog: { create: vi.fn(() => Promise.resolve({})) },
    ledgerEntry: { create: vi.fn(() => Promise.resolve({})) },
  };
  const transaction = vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  const prisma = { client: { $transaction: transaction } } as unknown as PrismaService;
  const accountAfterCommit = vi.fn(() => Promise.resolve());
  const connect = {
    applyAccountUpdated: vi.fn(() => Promise.resolve(accountAfterCommit)),
  };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new StripeWebhookService(
    prisma,
    connect as unknown as StripeConnectService,
    { ...TEST_ENV, ...options.env },
    logger as unknown as Logger,
  );
  return { service, tx, transaction, connect, accountAfterCommit, logger };
}

describe('StripeWebhookService.receive', () => {
  it('moves the booking to paid_held, writes the charge ledger entry and marks the event processed', async () => {
    const { service, tx } = setup();

    await service.receive(succeeded());

    expect(tx.stripeEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ id: 'evt_1', type: 'payment_intent.succeeded' }) as unknown],
      skipDuplicates: true,
    });
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'booking-1', status: 'pending_payment' },
      data: { status: 'paid_held', chargeId: 'ch_1' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'booking.paid_held',
        after: {
          status: 'paid_held',
          paymentIntentId: 'pi_1',
          chargeId: 'ch_1',
          stripeEventId: 'evt_1',
        },
      }) as unknown,
    });
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith({
      data: {
        bookingId: 'booking-1',
        type: 'charge',
        amountCents: 25050,
        currency: 'EUR',
        stripeObjectId: 'ch_1',
      },
    });
    expect(tx.stripeEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt_1' },
      data: { processedAt: expect.any(Date) as unknown },
    });
  });

  it('acks a duplicate that was already processed without touching the booking', async () => {
    const { service, tx } = setup({ alreadyStored: { processedAt: new Date() } });

    await service.receive(succeeded());

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.booking.findUnique).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
  });

  it('processes a redelivered event that was stored but deferred earlier', async () => {
    const { service, tx } = setup({ alreadyStored: { processedAt: null } });

    await service.receive(succeeded());

    expect(tx.ledgerEntry.create).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
  });

  it('ignores an event whose livemode does not match the configured key', async () => {
    const { service, transaction, logger } = setup();

    await service.receive({ ...succeeded(), livemode: true });

    expect(transaction).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stripeEventId: 'evt_1', livemode: true }),
      expect.any(String),
    );
  });

  it('expects live events when a live restricted key is configured', async () => {
    const { service, transaction } = setup({ env: { STRIPE_SECRET_KEY: 'rk_live_redacted' } });

    await service.receive(succeeded());
    expect(transaction).not.toHaveBeenCalled();

    await service.receive({ ...succeeded(), livemode: true });
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('defers an event whose booking does not exist yet', async () => {
    const { service, tx } = setup({ booking: null });

    await service.receive(succeeded());

    expect(tx.stripeEvent.createMany).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['amount', { amount: 25049 }],
    ['currency', { currency: 'usd' }],
    ['charge', { latest_charge: null }],
  ])('defers and logs an error when the %s does not fit the quote', async (_label, change) => {
    const { service, tx, logger } = setup();

    await service.receive(succeeded(change));

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'booking-1', paymentIntentId: 'pi_1' }),
      expect.any(String),
    );
  });

  it('defers when the stored quote fee does not match the shared helper', async () => {
    const base = bookingRow();
    const { service, tx, logger } = setup({
      booking: { ...base, quote: { ...base.quote, platformFeeCents: 1252 } },
    });

    await service.receive(succeeded());

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: 'quote-1' }),
      expect.any(String),
    );
  });

  it('treats an illegal transition as a logged no-op and still marks the event processed', async () => {
    const { service, tx, logger } = setup({ booking: bookingRow({ status: 'cancelled' }) });

    await service.receive(succeeded());

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'booking-1', status: 'cancelled', chargeId: 'ch_1' }),
      expect.stringContaining('manual refund'),
    );
  });

  it('warns only when a second event reports the charge the booking already holds', async () => {
    const { service, tx, logger } = setup({
      booking: bookingRow({ status: 'paid_held', chargeId: 'ch_1' }),
    });

    await service.receive(succeeded({}, 'evt_2'));

    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('ignores payment intent events from a connected account', async () => {
    const { service, tx } = setup();

    await service.receive({ ...succeeded(), account: 'acct_1' });

    expect(tx.booking.findUnique).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
  });

  it('audits a failed payment without changing the booking or logging card data', async () => {
    const { service, tx } = setup();

    await service.receive({
      id: 'evt_f',
      type: 'payment_intent.payment_failed',
      livemode: false,
      data: {
        object: {
          id: 'pi_1',
          amount: 25050,
          currency: 'eur',
          latest_charge: 'ch_failed',
          last_payment_error: {
            code: 'card_declined',
            decline_code: 'insufficient_funds',
            payment_method: { card: { last4: '0002' } },
          },
        },
      },
    });

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'booking.payment_failed',
        targetType: 'Booking',
        targetId: 'booking-1',
        before: { status: 'pending_payment' },
        after: {
          status: 'pending_payment',
          paymentIntentId: 'pi_1',
          stripeEventId: 'evt_f',
          errorCode: 'card_declined',
          declineCode: 'insufficient_funds',
        },
        ip: null,
      },
    });
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
  });

  it('hands account.updated to the connect service and runs its side effects after commit', async () => {
    const { service, tx, connect, accountAfterCommit } = setup();

    await service.receive({
      id: 'evt_a',
      type: 'account.updated',
      account: 'acct_1',
      livemode: false,
      data: {
        object: {
          id: 'acct_1',
          charges_enabled: true,
          payouts_enabled: false,
          details_submitted: true,
        },
      },
    });

    expect(connect.applyAccountUpdated).toHaveBeenCalledWith(tx, {
      id: 'acct_1',
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
    expect(accountAfterCommit).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
  });

  it('records and acks an event type it does not handle', async () => {
    const { service, tx } = setup();

    await service.receive({
      id: 'evt_u',
      type: 'customer.created',
      livemode: false,
      data: { object: { id: 'cus_1' } },
    });

    expect(tx.stripeEvent.createMany).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
    expect(tx.booking.findUnique).not.toHaveBeenCalled();
  });
});

describe('StripeWebhookService.reprocess', () => {
  it('skips an event another instance holds or already processed', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.reprocess('evt_1')).resolves.toBe('skipped');
    expect(tx.booking.findUnique).not.toHaveBeenCalled();
  });

  it('applies a stored event and reports whether it was processed or deferred', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ payload: succeeded(), processedAt: null }]);

    await expect(service.reprocess('evt_1')).resolves.toBe('processed');
    expect(tx.ledgerEntry.create).toHaveBeenCalledOnce();

    const pending = setup({ booking: null });
    pending.tx.$queryRaw.mockResolvedValueOnce([{ payload: succeeded(), processedAt: null }]);
    await expect(pending.service.reprocess('evt_1')).resolves.toBe('deferred');
  });
});
