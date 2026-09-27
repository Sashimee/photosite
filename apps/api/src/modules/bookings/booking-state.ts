import { HttpException } from '@nestjs/common';
import type { Prisma } from '@photoo/db';
import { isValidBookingTransition, type BookingStatus } from '@photoo/shared';

type BookingStatusFields = Pick<
  Prisma.BookingUpdateManyMutationInput,
  'deliveredAt' | 'releasedAt' | 'cancelledAt'
>;

export type BookingTransitionData = Pick<
  Prisma.BookingUpdateManyMutationInput,
  'chargeId' | 'transferId' | 'releaseDueAt' | 'cancellationReason'
>;

export interface BookingTransition {
  bookingId: string;
  from: BookingStatus;
  to: BookingStatus;
  actor: { type: 'user' | 'admin' | 'system'; id: string | null };
  ip?: string | null;
  data?: BookingTransitionData;
  audit?: Record<string, string | number | null>;
}

export class IllegalBookingTransitionError extends HttpException {
  constructor(
    readonly bookingId: string,
    readonly from: BookingStatus,
    readonly to: BookingStatus,
    reason = `Booking cannot move from ${from} to ${to}`,
  ) {
    super({ code: 'CONFLICT', message: reason }, 409);
  }
}

function statusFields(to: BookingStatus, now: Date): BookingStatusFields {
  switch (to) {
    case 'paid_held':
    case 'in_progress':
    case 'refunded':
    case 'disputed':
      return {};
    case 'delivered':
      return { deliveredAt: now };
    case 'released':
      return { releasedAt: now };
    case 'cancelled':
      return { cancelledAt: now };
    case 'pending_payment':
      throw new Error('booking state: pending_payment is only ever an initial state');
    default: {
      const exhaustive: never = to;
      throw new Error(`booking state: unhandled status ${String(exhaustive)}`);
    }
  }
}

// The only place a Booking.status changes. The `status: from` guard on the
// update turns a concurrent transition into a 409 instead of a lost update.
export async function transitionBooking(
  tx: Prisma.TransactionClient,
  transition: BookingTransition,
): Promise<void> {
  const { bookingId, from, to } = transition;
  if (!isValidBookingTransition(from, to)) {
    throw new IllegalBookingTransitionError(bookingId, from, to);
  }
  const now = new Date();
  const result = await tx.booking.updateMany({
    where: { id: bookingId, status: from },
    data: { status: to, ...statusFields(to, now), ...transition.data },
  });
  if (result.count === 0) {
    throw new IllegalBookingTransitionError(
      bookingId,
      from,
      to,
      `Booking is no longer ${from}; reload it and retry`,
    );
  }
  await tx.auditLog.create({
    data: {
      actorType: transition.actor.type,
      actorId: transition.actor.id,
      action: `booking.${to}`,
      targetType: 'Booking',
      targetId: bookingId,
      before: { status: from },
      after: { status: to, ...transition.audit },
      ip: transition.ip ?? null,
    },
  });
}
