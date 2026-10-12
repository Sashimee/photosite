import { Prisma } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { TEST_ENV } from '../../testing/test-env.js';
import type {
  BookingMoneyEventsService,
  MoneyEventOutcome,
} from './booking-money-events.service.js';
import type { StripeConnectService } from './stripe-connect.service.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import type {
  ConnectedAccount,
  CreateRefundInput,
  GatewayEvent,
  Refund,
  StripeGateway,
} from './stripe/stripe-gateway.js';

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
    pendingPayload?: GatewayEvent;
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
    ledgerEntry: {
      create: vi.fn(() => Promise.resolve({})),
      createMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
  };
  const transaction = vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  const findFirst = vi.fn(() =>
    Promise.resolve(options.pendingPayload ? { payload: options.pendingPayload } : null),
  );
  const prisma = {
    client: { $transaction: transaction, stripeEvent: { findFirst } },
  } as unknown as PrismaService;
  const accountAfterCommit = vi.fn(() => Promise.resolve());
  const connect = {
    fetchAccount: vi.fn((id: string): Promise<ConnectedAccount> =>
      Promise.resolve({ ...FRESH_ACCOUNT, id }),
    ),
    applyAccountUpdated: vi.fn(() => Promise.resolve(accountAfterCommit)),
  };
  const gateway = {
    createRefund: vi.fn((input: CreateRefundInput): Promise<Refund> =>
      Promise.resolve({ id: 're_1', amountCents: input.amountCents ?? 25050, status: 'succeeded' }),
    ),
    listChargeRefunds: vi.fn((): Promise<Refund[]> => Promise.resolve([CHARGE_REFUND])),
  };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const moneyAfterCommit = vi.fn(() => Promise.resolve());
  const moneyOutcome = (): Promise<MoneyEventOutcome> =>
    Promise.resolve({ status: 'processed', afterCommit: moneyAfterCommit });
  const moneyEvents = {
    onChargeRefunded: vi.fn(moneyOutcome),
    onTransferReversed: vi.fn(moneyOutcome),
    onDisputeCreated: vi.fn(moneyOutcome),
    onDisputeClosed: vi.fn(moneyOutcome),
  };
  const service = new StripeWebhookService(
    prisma,
    connect as unknown as StripeConnectService,
    gateway as unknown as StripeGateway,
    { ...TEST_ENV, ...options.env },
    logger as unknown as Logger,
    moneyEvents as unknown as BookingMoneyEventsService,
  );
  return {
    service,
    tx,
    transaction,
    findFirst,
    connect,
    gateway,
    accountAfterCommit,
    logger,
    moneyEvents,
    moneyAfterCommit,
  };
}

const CHARGE_REFUND: Refund = { id: 're_1', amountCents: 25050, status: 'succeeded' };

const FRESH_ACCOUNT: ConnectedAccount = {
  id: 'acct_1',
  chargesEnabled: true,
  payoutsEnabled: false,
  detailsSubmitted: true,
};

function accountUpdated(
  overrides: { livemode?: boolean; payoutsEnabled?: boolean } = {},
): GatewayEvent {
  return {
    id: 'evt_a',
    type: 'account.updated',
    account: 'acct_1',
    livemode: overrides.livemode ?? false,
    data: {
      object: {
        id: 'acct_1',
        charges_enabled: true,
        payouts_enabled: overrides.payoutsEnabled ?? true,
        details_submitted: true,
      },
    },
  };
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

  it('locks the booking row before reading it', async () => {
    const { service, tx } = setup();

    await service.receive(succeeded());

    const lock = tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(lock[0].join('?')).toContain('FOR UPDATE');
    expect(lock.slice(1)).toEqual(['pi_1']);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.booking.findUnique.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('pays against the stored fee snapshot without recomputing it from the fee percent', async () => {
    const base = bookingRow();
    const { service, tx } = setup({
      booking: { ...base, quote: { ...base.quote, feePercent: new Prisma.Decimal('7.00') } },
    });

    await service.receive(succeeded());

    expect(tx.booking.updateMany).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
  });

  it.each([-1, 25051])('defers when the stored fee %i is outside 0..subtotal', async (fee) => {
    const base = bookingRow();
    const { service, tx, logger } = setup({
      booking: { ...base, quote: { ...base.quote, platformFeeCents: fee } },
    });

    await service.receive(succeeded());

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: 'quote-1' }),
      expect.any(String),
    );
  });

  it('records, audits and fully refunds a payment that lands on a cancelled booking', async () => {
    const { service, tx, transaction, gateway } = setup({
      booking: bookingRow({ status: 'cancelled' }),
    });

    await service.receive(succeeded());

    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).toHaveBeenNthCalledWith(1, {
      data: [
        {
          bookingId: 'booking-1',
          type: 'charge',
          amountCents: 25050,
          currency: 'EUR',
          stripeObjectId: 'ch_1',
        },
      ],
      skipDuplicates: true,
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'booking.paid_after_terminal',
        targetType: 'Booking',
        targetId: 'booking-1',
        before: { status: 'cancelled' },
        after: {
          status: 'cancelled',
          paymentIntentId: 'pi_1',
          chargeId: 'ch_1',
          stripeEventId: 'evt_1',
        },
        ip: null,
      },
    });
    expect(gateway.createRefund).toHaveBeenCalledWith({
      paymentIntentId: 'pi_1',
      metadata: { bookingId: 'booking-1', reason: 'late_payment' },
      idempotencyKey: 'refund_booking-1_late',
    });
    expect(gateway.createRefund.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.auditLog.create.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(tx.ledgerEntry.createMany).toHaveBeenNthCalledWith(2, {
      data: [
        {
          bookingId: 'booking-1',
          type: 'refund',
          amountCents: -25050,
          currency: 'EUR',
          stripeObjectId: 're_1',
        },
      ],
      skipDuplicates: true,
    });
    expect(tx.auditLog.create).toHaveBeenLastCalledWith({
      data: {
        actorType: 'system',
        actorId: null,
        action: 'booking.late_payment_refunded',
        targetType: 'Booking',
        targetId: 'booking-1',
        before: { status: 'cancelled' },
        after: { status: 'cancelled', refundId: 're_1', amountCents: 25050 },
        ip: null,
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('leaves a late payment unprocessed for the sweep when the refund call fails', async () => {
    const { service, tx, gateway } = setup({ booking: bookingRow({ status: 'cancelled' }) });
    gateway.createRefund.mockRejectedValueOnce(new Error('stripe unavailable'));

    await expect(service.receive(succeeded())).rejects.toThrow('stripe unavailable');

    expect(tx.ledgerEntry.createMany).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
  });

  it('does not audit a replayed late payment twice but still settles the refund', async () => {
    const { service, tx, gateway } = setup({ booking: bookingRow({ status: 'cancelled' }) });
    tx.ledgerEntry.createMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    await service.receive(succeeded());

    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(gateway.createRefund).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
  });

  it('audits the refund of a late payment whose charge was recorded by an earlier attempt', async () => {
    const { service, tx } = setup({ booking: bookingRow({ status: 'cancelled' }) });
    tx.ledgerEntry.createMany.mockResolvedValueOnce({ count: 0 });

    await service.receive(succeeded());

    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'booking.late_payment_refunded',
        after: { status: 'cancelled', refundId: 're_1', amountCents: 25050 },
      }) as unknown,
    });
  });

  it('refunds a second charge on a booking already paid by another charge', async () => {
    const { service, gateway } = setup({
      booking: bookingRow({ status: 'paid_held', chargeId: 'ch_0' }),
    });

    await service.receive(succeeded());

    expect(gateway.createRefund).toHaveBeenCalledOnce();
  });

  it('warns only when a second event reports the charge the booking already holds', async () => {
    const { service, tx, logger } = setup({
      booking: bookingRow({ status: 'paid_held', chargeId: 'ch_1' }),
    });

    await service.receive(succeeded({}, 'evt_2'));

    expect(tx.ledgerEntry.create).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
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

  it('applies the account state fetched from Stripe, not the payload, and runs side effects after commit', async () => {
    const { service, tx, transaction, connect, accountAfterCommit } = setup();

    await service.receive(accountUpdated({ payoutsEnabled: true }));

    expect(connect.fetchAccount).toHaveBeenCalledWith('acct_1');
    expect(connect.fetchAccount.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(connect.applyAccountUpdated).toHaveBeenCalledWith(tx, FRESH_ACCOUNT);
    expect(accountAfterCommit).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
  });

  it('does not fetch or apply an account.updated whose livemode does not match', async () => {
    const { service, transaction, connect } = setup();

    await service.receive(accountUpdated({ livemode: true }));

    expect(connect.fetchAccount).not.toHaveBeenCalled();
    expect(connect.applyAccountUpdated).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('stores account.updated unprocessed when Stripe cannot be read, for the sweep to retry', async () => {
    const { service, tx, connect, accountAfterCommit, logger } = setup();
    connect.fetchAccount.mockRejectedValueOnce(new Error('stripe unavailable'));

    await service.receive(accountUpdated());

    expect(tx.stripeEvent.createMany).toHaveBeenCalledOnce();
    expect(connect.applyAccountUpdated).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
    expect(accountAfterCommit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      { stripeEventId: 'evt_a', stripeAccountId: 'acct_1', error: 'stripe unavailable' },
      expect.any(String),
    );
  });

  it('records an event type it does not handle but leaves it replayable', async () => {
    const { service, tx } = setup();

    await service.receive({
      id: 'evt_u',
      type: 'customer.created',
      livemode: false,
      data: { object: { id: 'cus_1' } },
    });

    expect(tx.stripeEvent.createMany).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
    expect(tx.booking.findUnique).not.toHaveBeenCalled();
  });
});

describe('StripeWebhookService charge.refunded', () => {
  const chargeRefunded = {
    id: 'evt_r',
    type: 'charge.refunded',
    livemode: false,
    data: { object: { id: 'ch_1', amount: 25050, amount_refunded: 25050, currency: 'eur' } },
  };

  it('lists the refunds of the charge before the transaction and hands them to the handler', async () => {
    const { service, gateway, moneyEvents, transaction } = setup();

    await service.receive(chargeRefunded);

    expect(gateway.listChargeRefunds).toHaveBeenCalledWith('ch_1');
    expect(gateway.listChargeRefunds.mock.invocationCallOrder[0]).toBeLessThan(
      transaction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(moneyEvents.onChargeRefunded).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'evt_r' }),
      [CHARGE_REFUND],
    );
  });

  it('stores the event and defers it when the refunds cannot be listed', async () => {
    const { service, gateway, moneyEvents, tx, logger } = setup();
    gateway.listChargeRefunds.mockRejectedValueOnce(new Error('stripe unavailable'));

    await service.receive(chargeRefunded);

    expect(tx.stripeEvent.createMany).toHaveBeenCalledOnce();
    expect(moneyEvents.onChargeRefunded).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ stripeEventId: 'evt_r', chargeId: 'ch_1' }),
      expect.any(String),
    );
  });

  it('does not list refunds for a charge.refunded from a connected account', async () => {
    const { service, gateway } = setup();

    await service.receive({ ...chargeRefunded, account: 'acct_1' });

    expect(gateway.listChargeRefunds).not.toHaveBeenCalled();
  });
});

describe('StripeWebhookService money events', () => {
  const cases = [
    ['charge.refunded', 'onChargeRefunded', { id: 'ch_1' }],
    ['transfer.reversed', 'onTransferReversed', { id: 'tr_1' }],
    ['charge.dispute.created', 'onDisputeCreated', { id: 'dp_1' }],
    ['charge.dispute.closed', 'onDisputeClosed', { id: 'dp_1' }],
  ] as const;

  it.each(cases)(
    'hands %s to the money events service, marks it processed and runs its side effects after commit',
    async (type, handler, object) => {
      const { service, tx, moneyEvents, moneyAfterCommit, transaction } = setup();
      moneyAfterCommit.mockImplementation(() => {
        expect(transaction).toHaveBeenCalledOnce();
        return Promise.resolve();
      });

      await service.receive({ id: 'evt_m', type, livemode: false, data: { object } });

      expect(moneyEvents[handler]).toHaveBeenCalledOnce();
      expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
      expect(moneyAfterCommit).toHaveBeenCalledOnce();
    },
  );

  it.each(cases)('ignores %s sent from a connected account', async (type, handler, object) => {
    const { service, tx, moneyEvents, logger } = setup();

    await service.receive({
      id: 'evt_m',
      type,
      livemode: false,
      account: 'acct_1',
      data: { object },
    });

    expect(moneyEvents[handler]).not.toHaveBeenCalled();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ stripeAccountId: 'acct_1' }),
      expect.any(String),
    );
  });

  it('leaves a deferred money event unprocessed for the sweep', async () => {
    const { service, tx, moneyEvents } = setup();
    moneyEvents.onDisputeCreated.mockResolvedValueOnce({
      status: 'deferred',
      afterCommit: () => Promise.resolve(),
    });

    await service.receive({
      id: 'evt_m',
      type: 'charge.dispute.created',
      livemode: false,
      data: { object: { id: 'dp_1' } },
    });

    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
  });
});

describe('StripeWebhookService.reprocess', () => {
  it('skips an event that is already processed without opening a transaction', async () => {
    const { service, transaction, findFirst } = setup();

    await expect(service.reprocess('evt_1')).resolves.toBe('skipped');
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'evt_1', processedAt: null },
      select: { payload: true },
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips an event another instance holds', async () => {
    const { service, tx } = setup({ pendingPayload: succeeded() });
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.reprocess('evt_1')).resolves.toBe('skipped');
    expect(tx.booking.findUnique).not.toHaveBeenCalled();
  });

  it('applies a stored event and reports whether it was processed or deferred', async () => {
    const { service, tx } = setup({ pendingPayload: succeeded() });
    tx.$queryRaw.mockResolvedValueOnce([{ payload: succeeded(), processedAt: null }]);

    await expect(service.reprocess('evt_1')).resolves.toBe('processed');
    expect(tx.ledgerEntry.create).toHaveBeenCalledOnce();

    const pending = setup({ booking: null, pendingPayload: succeeded() });
    pending.tx.$queryRaw.mockResolvedValueOnce([{ payload: succeeded(), processedAt: null }]);
    await expect(pending.service.reprocess('evt_1')).resolves.toBe('deferred');
  });

  it('reports a stored late payment as processed once its refund is recorded', async () => {
    const { service, tx, gateway } = setup({
      booking: bookingRow({ status: 'cancelled' }),
      pendingPayload: succeeded(),
    });
    tx.$queryRaw.mockResolvedValueOnce([{ payload: succeeded(), processedAt: null }]);

    await expect(service.reprocess('evt_1')).resolves.toBe('processed');
    expect(gateway.createRefund).toHaveBeenCalledOnce();
    expect(tx.stripeEvent.update).toHaveBeenCalledOnce();
  });

  it('skips a stored event of a type it does not handle', async () => {
    const unhandled: GatewayEvent = {
      id: 'evt_u',
      type: 'customer.created',
      livemode: false,
      data: { object: { id: 'cus_1' } },
    };
    const { service, tx } = setup({ pendingPayload: unhandled });
    tx.$queryRaw.mockResolvedValueOnce([{ payload: unhandled, processedAt: null }]);

    await expect(service.reprocess('evt_u')).resolves.toBe('skipped');
    expect(tx.stripeEvent.update).not.toHaveBeenCalled();
  });

  it('re-reads the account from Stripe before reapplying a stored account.updated', async () => {
    const { service, tx, connect } = setup({ pendingPayload: accountUpdated() });
    tx.$queryRaw.mockResolvedValueOnce([{ payload: accountUpdated(), processedAt: null }]);

    await expect(service.reprocess('evt_a')).resolves.toBe('processed');
    expect(connect.fetchAccount).toHaveBeenCalledWith('acct_1');
    expect(connect.applyAccountUpdated).toHaveBeenCalledWith(tx, FRESH_ACCOUNT);

    const failing = setup({ pendingPayload: accountUpdated() });
    failing.connect.fetchAccount.mockRejectedValueOnce(new Error('stripe unavailable'));
    failing.tx.$queryRaw.mockResolvedValueOnce([{ payload: accountUpdated(), processedAt: null }]);
    await expect(failing.service.reprocess('evt_a')).resolves.toBe('deferred');
    expect(failing.connect.applyAccountUpdated).not.toHaveBeenCalled();
  });
});
