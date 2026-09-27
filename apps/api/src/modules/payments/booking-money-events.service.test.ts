import type { Prisma } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { BookingMoneyEventsService, stripeDisputeReason } from './booking-money-events.service.js';
import type { GatewayEvent } from './stripe/stripe-gateway.js';

interface LedgerRow {
  bookingId: string;
  type: string;
  amountCents: number;
  stripeObjectId: string;
}

interface DisputeRow {
  id: string;
  bookingId: string;
  reason: string;
  status: 'open' | 'won' | 'lost';
  amountRefundedCents?: number;
}

interface AuditRow {
  action: string;
  before: unknown;
  after: Record<string, unknown>;
}

interface BookingState {
  id: string;
  status: string;
  clientId: string;
  chargeId: string | null;
  paymentIntentId: string;
  transferId: string | null;
  deliveredAt: Date | null;
  releasedAt: Date | null;
}

function setup(
  options: {
    booking?: Partial<BookingState> | null;
    ledger?: LedgerRow[];
    disputes?: DisputeRow[];
    financeAdmins?: string[];
  } = {},
) {
  const booking: BookingState | null =
    options.booking === null
      ? null
      : {
          id: 'b1',
          status: 'paid_held',
          clientId: 'client1',
          chargeId: 'ch_1',
          paymentIntentId: 'pi_1',
          transferId: null,
          deliveredAt: null,
          releasedAt: null,
          ...options.booking,
        };
  const ledger: LedgerRow[] = [...(options.ledger ?? [])];
  const disputes: DisputeRow[] = [...(options.disputes ?? [])];
  const audits: AuditRow[] = [];
  const notificationIds: string[] = [];

  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    booking: {
      findFirst: vi.fn(({ where }: { where: { chargeId?: string; transferId?: string } }) => {
        const match =
          booking !== null &&
          ((where.chargeId !== undefined && booking.chargeId === where.chargeId) ||
            (where.transferId !== undefined && booking.transferId === where.transferId));
        return Promise.resolve(match ? { id: booking.id } : null);
      }),
      findUnique: vi.fn(({ where }: { where: { id?: string; paymentIntentId?: string } }) => {
        if (!booking) {
          return Promise.resolve(null);
        }
        if (where.paymentIntentId !== undefined) {
          return Promise.resolve(
            booking.paymentIntentId === where.paymentIntentId ? { id: booking.id } : null,
          );
        }
        return Promise.resolve(
          where.id === booking.id ? { ...booking, quote: { currency: 'EUR' } } : null,
        );
      }),
      findUniqueOrThrow: vi.fn(() => Promise.resolve({ status: booking?.status })),
      updateMany: vi.fn(
        ({ where, data }: { where: { status: string }; data: { status: string } }) => {
          if (booking?.status !== where.status) {
            return Promise.resolve({ count: 0 });
          }
          booking.status = data.status;
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    ledgerEntry: {
      findFirst: vi.fn(({ where }: { where: { type: string; stripeObjectId: string } }) => {
        const row = ledger.find(
          (entry) => entry.type === where.type && entry.stripeObjectId === where.stripeObjectId,
        );
        return Promise.resolve(row ? { bookingId: row.bookingId } : null);
      }),
      createMany: vi.fn(({ data }: { data: LedgerRow[] }) => {
        let count = 0;
        for (const entry of data) {
          const duplicate = ledger.some(
            (row) =>
              row.bookingId === entry.bookingId &&
              row.type === entry.type &&
              row.stripeObjectId === entry.stripeObjectId,
          );
          if (!duplicate) {
            ledger.push(entry);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }),
      groupBy: vi.fn(() => {
        const groups = new Map<string, { sum: number; count: number }>();
        for (const row of ledger) {
          if (!['refund', 'transfer', 'reversal'].includes(row.type)) {
            continue;
          }
          const group = groups.get(row.type) ?? { sum: 0, count: 0 };
          group.sum += row.amountCents;
          group.count += 1;
          groups.set(row.type, group);
        }
        return Promise.resolve(
          [...groups].map(([type, group]) => ({
            bookingId: 'b1',
            type,
            _sum: { amountCents: group.sum },
            _count: { _all: group.count },
          })),
        );
      }),
    },
    dispute: {
      findFirst: vi.fn(({ where }: { where: { reason: { startsWith: string } } }) => {
        const row = disputes.find((dispute) => dispute.reason.startsWith(where.reason.startsWith));
        return Promise.resolve(row ? { id: row.id, status: row.status } : null);
      }),
      create: vi.fn(({ data }: { data: { bookingId: string; reason: string } }) => {
        const row: DisputeRow = { id: `d${String(disputes.length + 1)}`, status: 'open', ...data };
        disputes.push(row);
        return Promise.resolve({ id: row.id });
      }),
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: { status: 'won' | 'lost'; amountRefundedCents: number };
        }) => {
          const row = disputes.find((dispute) => dispute.id === where.id);
          if (row) {
            Object.assign(row, data);
          }
          return Promise.resolve({});
        },
      ),
      count: vi.fn(() =>
        Promise.resolve(disputes.filter((dispute) => dispute.status === 'open').length),
      ),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: AuditRow }) => {
        audits.push(data);
        return Promise.resolve({});
      }),
      findFirst: vi.fn(({ where }: { where: { action: string } }) => {
        const row = audits.filter((audit) => audit.action === where.action).at(-1);
        return Promise.resolve(row ? { before: row.before } : null);
      }),
    },
    adminPermissionGrant: {
      findMany: vi.fn(() =>
        Promise.resolve((options.financeAdmins ?? ['admin1']).map((userId) => ({ userId }))),
      ),
    },
  };

  const notifications = {
    createNotification: vi.fn((_tx: unknown, userId: string) => {
      const id = `n_${userId}`;
      notificationIds.push(id);
      return Promise.resolve(id);
    }),
    enqueue: vi.fn(() => Promise.resolve()),
  };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new BookingMoneyEventsService(
    notifications as unknown as NotificationsService,
    logger as unknown as Logger,
  );
  return {
    service,
    tx,
    txClient: tx as unknown as Prisma.TransactionClient,
    booking,
    ledger,
    disputes,
    audits,
    notifications,
    logger,
  };
}

function event(type: string, object: Record<string, unknown>, account?: string): GatewayEvent {
  return { id: `evt_${type}`, type, livemode: false, account, data: { object } };
}

function chargeRefunded(overrides: Record<string, unknown> = {}): GatewayEvent {
  return event('charge.refunded', {
    id: 'ch_1',
    payment_intent: 'pi_1',
    amount: 26250,
    amount_refunded: 26250,
    currency: 'eur',
    refunds: { data: [{ id: 're_1', amount: 26250, status: 'succeeded' }] },
    ...overrides,
  });
}

function dispute(type: string, overrides: Record<string, unknown> = {}): GatewayEvent {
  return event(type, {
    id: 'dp_1',
    charge: 'ch_1',
    payment_intent: 'pi_1',
    amount: 26250,
    currency: 'eur',
    reason: 'fraudulent',
    status: 'needs_response',
    ...overrides,
  });
}

const UNRECONCILED_AFTER = {
  chargeId: 'ch_1',
  stripeAmountRefundedCents: 26250,
  ledgerRefundedCents: 0,
  stripeEventId: 'evt_charge.refunded',
};

describe('BookingMoneyEventsService.onChargeRefunded', () => {
  it('records the refund and moves a fully refunded booking to refunded', async () => {
    const { service, txClient, ledger, booking, audits } = setup();

    const outcome = await service.onChargeRefunded(txClient, chargeRefunded());

    expect(outcome.status).toBe('processed');
    expect(ledger).toEqual([
      expect.objectContaining({ type: 'refund', amountCents: -26250, stripeObjectId: 're_1' }),
    ]);
    expect(booking?.status).toBe('refunded');
    expect(audits.map((audit) => audit.action)).toEqual([
      'booking.refund_recorded',
      'booking.refunded',
    ]);
  });

  it('keeps the state on a partial refund', async () => {
    const { service, txClient, booking, ledger } = setup({ booking: { status: 'delivered' } });

    await service.onChargeRefunded(
      txClient,
      chargeRefunded({
        amount_refunded: 1000,
        refunds: { data: [{ id: 're_1', amount: 1000, status: 'succeeded' }] },
      }),
    );

    expect(booking?.status).toBe('delivered');
    expect(ledger).toHaveLength(1);
  });

  it('is a no-op on replay once the refund row and state change are recorded', async () => {
    const { service, txClient, audits, tx } = setup();

    await service.onChargeRefunded(txClient, chargeRefunded());
    const auditCount = audits.length;
    await service.onChargeRefunded(txClient, chargeRefunded());

    expect(audits).toHaveLength(auditCount);
    expect(tx.booking.updateMany).toHaveBeenCalledOnce();
  });

  it('does not record failed or canceled refunds', async () => {
    const { service, txClient, ledger } = setup();

    await service.onChargeRefunded(
      txClient,
      chargeRefunded({
        amount_refunded: 0,
        refunds: {
          data: [
            { id: 're_1', amount: 100, status: 'failed' },
            { id: 're_2', amount: 100, status: 'canceled' },
          ],
        },
      }),
    );

    expect(ledger).toHaveLength(0);
  });

  it('audits a refunded amount the ledger cannot account for', async () => {
    const { service, txClient, audits, logger } = setup();

    await service.onChargeRefunded(txClient, chargeRefunded({ refunds: undefined }));

    expect(audits[0]).toMatchObject({
      action: 'booking.refund_unreconciled',
      after: { status: 'paid_held', ...UNRECONCILED_AFTER },
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it('leaves a disputed booking disputed', async () => {
    const { service, txClient, booking } = setup({ booking: { status: 'disputed' } });

    await service.onChargeRefunded(txClient, chargeRefunded());

    expect(booking?.status).toBe('disputed');
  });

  it('flags a released booking refunded without reversing its transfer', async () => {
    const { service, txClient, booking, logger } = setup({
      booking: { status: 'released', transferId: 'tr_1' },
      ledger: [{ bookingId: 'b1', type: 'transfer', amountCents: -23750, stripeObjectId: 'tr_1' }],
    });

    await service.onChargeRefunded(txClient, chargeRefunded());

    expect(booking?.status).toBe('refunded');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ transferId: 'tr_1' }),
      expect.stringContaining('without reversing'),
    );
  });

  it('finds the booking by payment intent when the charge id is not stored yet', async () => {
    const { service, txClient, ledger } = setup({ booking: { chargeId: null } });

    const outcome = await service.onChargeRefunded(txClient, chargeRefunded());

    expect(outcome.status).toBe('processed');
    expect(ledger).toHaveLength(1);
  });

  it('defers when no paid booking holds the charge yet', async () => {
    const missing = setup({ booking: null });
    await expect(
      missing.service.onChargeRefunded(missing.txClient, chargeRefunded()),
    ).resolves.toMatchObject({ status: 'deferred' });

    const pending = setup({ booking: { status: 'pending_payment' } });
    await expect(
      pending.service.onChargeRefunded(pending.txClient, chargeRefunded()),
    ).resolves.toMatchObject({ status: 'deferred' });
    expect(pending.ledger).toHaveLength(0);
  });

  it('defers on a currency that differs from the quote', async () => {
    const { service, txClient, ledger } = setup();

    const outcome = await service.onChargeRefunded(txClient, chargeRefunded({ currency: 'usd' }));

    expect(outcome.status).toBe('deferred');
    expect(ledger).toHaveLength(0);
  });

  it('rejects a payload that is not a charge', async () => {
    const { service, txClient } = setup();

    await expect(
      service.onChargeRefunded(txClient, chargeRefunded({ id: 'pi_1' })),
    ).rejects.toThrow();
  });
});

describe('BookingMoneyEventsService.onTransferReversed', () => {
  const transferLedger: LedgerRow[] = [
    { bookingId: 'b1', type: 'transfer', amountCents: -23750, stripeObjectId: 'tr_1' },
  ];

  function reversed(overrides: Record<string, unknown> = {}): GatewayEvent {
    return event('transfer.reversed', {
      id: 'tr_1',
      amount: 23750,
      amount_reversed: 5000,
      currency: 'eur',
      reversals: { data: [{ id: 'trr_1', amount: 5000 }] },
      ...overrides,
    });
  }

  it('records the reversal once without changing the booking state', async () => {
    const { service, txClient, ledger, booking, audits } = setup({
      booking: { status: 'released', transferId: 'tr_1' },
      ledger: transferLedger,
    });

    await service.onTransferReversed(txClient, reversed());
    await service.onTransferReversed(txClient, reversed());

    expect(ledger.filter((row) => row.type === 'reversal')).toEqual([
      expect.objectContaining({ amountCents: 5000, stripeObjectId: 'trr_1' }),
    ]);
    expect(booking?.status).toBe('released');
    expect(audits.map((audit) => audit.action)).toEqual(['booking.reversal_recorded']);
  });

  it('finds the booking by its transfer id when the ledger has no transfer row', async () => {
    const { service, txClient, ledger } = setup({
      booking: { status: 'released', transferId: 'tr_1' },
    });

    const outcome = await service.onTransferReversed(txClient, reversed());

    expect(outcome.status).toBe('processed');
    expect(ledger).toHaveLength(1);
  });

  it('defers a reversal of a transfer no booking holds yet', async () => {
    const { service, txClient } = setup({ booking: { transferId: null } });

    await expect(service.onTransferReversed(txClient, reversed())).resolves.toMatchObject({
      status: 'deferred',
    });
  });

  it('audits a reversed amount the ledger cannot account for', async () => {
    const { service, txClient, audits } = setup({
      booking: { status: 'released', transferId: 'tr_1' },
      ledger: transferLedger,
    });

    await service.onTransferReversed(txClient, reversed({ reversals: undefined }));

    expect(audits.map((audit) => audit.action)).toEqual(['booking.reversal_unreconciled']);
  });
});

describe('BookingMoneyEventsService.onDisputeCreated', () => {
  it('freezes the booking, opens a dispute and notifies every finance admin after commit', async () => {
    const { service, txClient, booking, disputes, notifications, audits } = setup({
      booking: { status: 'delivered' },
      financeAdmins: ['admin1', 'admin2'],
    });

    const outcome = await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));

    expect(booking?.status).toBe('disputed');
    expect(disputes).toEqual([
      expect.objectContaining({
        bookingId: 'b1',
        status: 'open',
        reason: stripeDisputeReason('dp_1', 'fraudulent'),
      }),
    ]);
    expect(audits.map((audit) => audit.action)).toEqual(['booking.disputed', 'dispute.opened']);
    expect(notifications.createNotification).toHaveBeenCalledWith(
      txClient,
      'admin1',
      'dispute_opened',
      { total: { amountCents: 26250, currency: 'EUR' } },
    );
    expect(notifications.enqueue).not.toHaveBeenCalled();

    await outcome.afterCommit();

    expect(notifications.enqueue).toHaveBeenCalledTimes(2);
  });

  it('opens nothing twice on replay', async () => {
    const { service, txClient, disputes, notifications } = setup();

    await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));
    const replay = await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));
    await replay.afterCommit();

    expect(disputes).toHaveLength(1);
    expect(notifications.createNotification).toHaveBeenCalledOnce();
    expect(notifications.enqueue).not.toHaveBeenCalled();
  });

  it('records a dispute on a refunded booking without an illegal transition', async () => {
    const { service, txClient, booking, disputes, logger } = setup({
      booking: { status: 'refunded' },
    });

    await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));

    expect(booking?.status).toBe('refunded');
    expect(disputes).toHaveLength(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it('reports a dispute nobody can be notified about', async () => {
    const { service, txClient, logger } = setup({ financeAdmins: [] });

    await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ disputeId: 'dp_1' }),
      expect.stringContaining('no finance admin'),
    );
  });

  it('defers a dispute whose booking is not paid yet', async () => {
    const { service, txClient, disputes } = setup({ booking: null });

    await expect(
      service.onDisputeCreated(txClient, dispute('charge.dispute.created')),
    ).resolves.toMatchObject({ status: 'deferred' });
    expect(disputes).toHaveLength(0);
  });
});

describe('BookingMoneyEventsService.onDisputeClosed', () => {
  it.each(['won', 'warning_closed', 'prevented'])(
    'restores the state the booking was frozen in when the dispute ends %s',
    async (status) => {
      const { service, txClient, booking, disputes, audits } = setup({
        booking: { status: 'delivered', deliveredAt: new Date() },
      });
      await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));

      await service.onDisputeClosed(txClient, dispute('charge.dispute.closed', { status }));

      expect(booking?.status).toBe('delivered');
      expect(disputes[0]).toMatchObject({ status: 'won', amountRefundedCents: 0 });
      expect(audits.map((audit) => audit.action)).toContain('booking.dispute_won');
    },
  );

  it('keeps a lost dispute disputed and records the amount taken', async () => {
    const { service, txClient, booking, disputes } = setup({ booking: { status: 'released' } });
    await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));

    await service.onDisputeClosed(txClient, dispute('charge.dispute.closed', { status: 'lost' }));

    expect(booking?.status).toBe('disputed');
    expect(disputes[0]).toMatchObject({ status: 'lost', amountRefundedCents: 26250 });
  });

  it('opens the dispute itself when the close arrives before the create', async () => {
    const { service, txClient, booking, disputes, notifications } = setup({
      booking: { status: 'in_progress' },
    });

    const closed = await service.onDisputeClosed(
      txClient,
      dispute('charge.dispute.closed', { status: 'won' }),
    );
    await closed.afterCommit();
    const created = await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));
    await created.afterCommit();

    expect(booking?.status).toBe('in_progress');
    expect(disputes).toEqual([expect.objectContaining({ status: 'won' })]);
    expect(notifications.enqueue).toHaveBeenCalledOnce();
  });

  it('does nothing on a replayed close', async () => {
    const { service, txClient, tx } = setup();
    await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));
    await service.onDisputeClosed(txClient, dispute('charge.dispute.closed', { status: 'won' }));
    const updates = tx.booking.updateMany.mock.calls.length;

    await service.onDisputeClosed(txClient, dispute('charge.dispute.closed', { status: 'lost' }));

    expect(tx.booking.updateMany).toHaveBeenCalledTimes(updates);
    expect(tx.dispute.update).toHaveBeenCalledOnce();
  });

  it('keeps the booking frozen while another dispute is still open', async () => {
    const { service, txClient, booking } = setup({
      booking: { status: 'disputed' },
      disputes: [
        {
          id: 'd0',
          bookingId: 'b1',
          reason: stripeDisputeReason('dp_0', 'fraudulent'),
          status: 'open',
        },
      ],
    });
    await service.onDisputeCreated(txClient, dispute('charge.dispute.created'));

    await service.onDisputeClosed(txClient, dispute('charge.dispute.closed', { status: 'won' }));

    expect(booking?.status).toBe('disputed');
  });

  it('falls back to the timestamps when no pre-dispute audit is readable', async () => {
    const { service, txClient, booking } = setup({
      booking: { status: 'disputed', releasedAt: new Date(), deliveredAt: new Date() },
      disputes: [
        {
          id: 'd1',
          bookingId: 'b1',
          reason: stripeDisputeReason('dp_1', 'fraudulent'),
          status: 'open',
        },
      ],
    });

    await service.onDisputeClosed(txClient, dispute('charge.dispute.closed', { status: 'won' }));

    expect(booking?.status).toBe('released');
  });

  it('leaves a dispute with an unknown closing status for a human', async () => {
    const { service, txClient, disputes, logger } = setup({
      disputes: [
        {
          id: 'd1',
          bookingId: 'b1',
          reason: stripeDisputeReason('dp_1', 'fraudulent'),
          status: 'open',
        },
      ],
    });

    const outcome = await service.onDisputeClosed(
      txClient,
      dispute('charge.dispute.closed', { status: 'charge_refunded' }),
    );

    expect(outcome.status).toBe('processed');
    expect(disputes[0]?.status).toBe('open');
    expect(logger.error).toHaveBeenCalled();
  });
});
