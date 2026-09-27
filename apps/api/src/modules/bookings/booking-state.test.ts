import type { Prisma } from '@photoo/db';
import { describe, expect, it, vi } from 'vitest';
import { IllegalBookingTransitionError, transitionBooking } from './booking-state.js';

function setup(count = 1) {
  const tx = {
    booking: { updateMany: vi.fn(() => Promise.resolve({ count })) },
    auditLog: { create: vi.fn(() => Promise.resolve({})) },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}

const SYSTEM = { type: 'system' as const, id: null };

describe('transitionBooking', () => {
  it('moves pending_payment to paid_held guarded on the current status and audits it', async () => {
    const { tx, client } = setup();
    await transitionBooking(client, {
      bookingId: 'b1',
      from: 'pending_payment',
      to: 'paid_held',
      actor: SYSTEM,
      data: { chargeId: 'ch_1' },
      audit: { chargeId: 'ch_1' },
    });
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'pending_payment' },
      data: { status: 'paid_held', chargeId: 'ch_1' },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: 'system',
        actorId: null,
        action: 'booking.paid_held',
        targetId: 'b1',
        before: { status: 'pending_payment' },
        after: { status: 'paid_held', chargeId: 'ch_1' },
      }) as unknown,
    });
  });

  it('stamps the timestamp belonging to the target status', async () => {
    const { tx, client } = setup();
    await transitionBooking(client, {
      bookingId: 'b1',
      from: 'in_progress',
      to: 'delivered',
      actor: SYSTEM,
    });
    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'in_progress' },
      data: { status: 'delivered', deliveredAt: expect.any(Date) as unknown },
    });
  });

  it('throws a 409 on an illegal transition without touching the row', async () => {
    const { tx, client } = setup();
    const attempt = transitionBooking(client, {
      bookingId: 'b1',
      from: 'pending_payment',
      to: 'released',
      actor: SYSTEM,
    });
    await expect(attempt).rejects.toBeInstanceOf(IllegalBookingTransitionError);
    await expect(attempt).rejects.toMatchObject({ status: 409 });
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws when the row is no longer in the expected status and writes no audit', async () => {
    const { tx, client } = setup(0);
    await expect(
      transitionBooking(client, {
        bookingId: 'b1',
        from: 'pending_payment',
        to: 'paid_held',
        actor: SYSTEM,
      }),
    ).rejects.toBeInstanceOf(IllegalBookingTransitionError);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to move back into pending_payment', async () => {
    const { client } = setup();
    await expect(
      transitionBooking(client, {
        bookingId: 'b1',
        from: 'paid_held',
        to: 'pending_payment',
        actor: SYSTEM,
      }),
    ).rejects.toBeInstanceOf(IllegalBookingTransitionError);
  });
});
