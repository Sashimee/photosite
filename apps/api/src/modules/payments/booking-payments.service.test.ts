import { HttpException } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { PlatformFeeMismatchError } from '../bookings/create-booking.js';
import { BookingPaymentsService } from './booking-payments.service.js';
import { FakeStripeGateway } from './stripe/fake-stripe-gateway.js';

const CLIENT = { id: 'client-1' };

interface BookingRow {
  id: string;
  clientId: string;
  status: string;
  paymentIntentId: string | null;
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
    clientId: CLIENT.id,
    status: 'pending_payment',
    paymentIntentId: null,
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

function setup(
  options: {
    booking?: BookingRow | null;
    storedByOtherCall?: () => string | null;
    gateway?: FakeStripeGateway;
  } = {},
) {
  let row = options.booking === undefined ? bookingRow() : options.booking;
  const booking = {
    findUnique: vi.fn(() => Promise.resolve(row && { ...row, quote: { ...row.quote } })),
    findUniqueOrThrow: vi.fn(() => Promise.resolve({ paymentIntentId: row?.paymentIntentId })),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: { paymentIntentId: null };
        data: { paymentIntentId: string };
      }) => {
        if (!row) {
          return Promise.resolve({ count: 0 });
        }
        const concurrent = options.storedByOtherCall?.();
        if (concurrent) {
          row = { ...row, paymentIntentId: concurrent };
        }
        if (row.paymentIntentId !== where.paymentIntentId) {
          return Promise.resolve({ count: 0 });
        }
        row = { ...row, paymentIntentId: data.paymentIntentId };
        return Promise.resolve({ count: 1 });
      },
    ),
  };
  const prisma = { client: { booking } } as unknown as PrismaService;
  const gateway = options.gateway ?? new FakeStripeGateway('whsec_unit');
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new BookingPaymentsService(prisma, gateway, logger as unknown as Logger);
  return { service, gateway, booking, logger, current: () => row };
}

async function expectHttpStatus(promise: Promise<unknown>, status: number) {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(status);
}

describe('BookingPaymentsService.createPaymentIntent', () => {
  it('creates a payment intent for the quote total and stores its id', async () => {
    const { service, gateway, current } = setup();
    const createSpy = vi.spyOn(gateway, 'createPaymentIntent');

    const result = await service.createPaymentIntent(CLIENT, 'booking-1');

    expect(result.amount).toEqual({ amountCents: 25050, currency: 'EUR' });
    expect(createSpy).toHaveBeenCalledWith({
      amountCents: 25050,
      currency: 'EUR',
      transferGroup: 'booking_booking-1',
      metadata: { bookingId: 'booking-1' },
      idempotencyKey: 'booking_booking-1_pi',
    });
    const stored = current()?.paymentIntentId;
    expect(stored).toMatch(/^pi_fake_/);
    expect(result.clientSecret).toBe(`${String(stored)}_secret_fake`);
  });

  it('reuses the stored payment intent on a second call', async () => {
    const { service, gateway } = setup();
    const first = await service.createPaymentIntent(CLIENT, 'booking-1');
    const createSpy = vi.spyOn(gateway, 'createPaymentIntent');

    const second = await service.createPaymentIntent(CLIENT, 'booking-1');

    expect(second).toEqual(first);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns 404 for a booking that does not exist', async () => {
    const { service } = setup({ booking: null });
    await expectHttpStatus(service.createPaymentIntent(CLIENT, 'booking-1'), 404);
  });

  it('returns 404 when the caller is not the booking client', async () => {
    const { service, gateway } = setup();
    const createSpy = vi.spyOn(gateway, 'createPaymentIntent');
    await expectHttpStatus(service.createPaymentIntent({ id: 'someone-else' }, 'booking-1'), 404);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it.each(['paid_held', 'cancelled', 'refunded'])(
    'returns 409 for a booking that is %s',
    async (status) => {
      const { service, gateway } = setup({ booking: bookingRow({ status }) });
      const createSpy = vi.spyOn(gateway, 'createPaymentIntent');
      await expectHttpStatus(service.createPaymentIntent(CLIENT, 'booking-1'), 409);
      expect(createSpy).not.toHaveBeenCalled();
    },
  );

  it('returns 422 for a non-EUR quote without contacting Stripe', async () => {
    const base = bookingRow();
    const { service, gateway } = setup({
      booking: { ...base, quote: { ...base.quote, currency: 'USD' } },
    });
    const createSpy = vi.spyOn(gateway, 'createPaymentIntent');
    await expectHttpStatus(service.createPaymentIntent(CLIENT, 'booking-1'), 422);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('refuses a quote whose stored fee does not match the shared helper', async () => {
    const base = bookingRow();
    const { service, gateway } = setup({
      booking: { ...base, quote: { ...base.quote, platformFeeCents: 1252 } },
    });
    const createSpy = vi.spyOn(gateway, 'createPaymentIntent');
    await expect(service.createPaymentIntent(CLIENT, 'booking-1')).rejects.toBeInstanceOf(
      PlatformFeeMismatchError,
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('returns the intent a concurrent call stored instead of its own', async () => {
    let otherId: string | null = null;
    const { service, gateway, logger } = setup({ storedByOtherCall: () => otherId });
    const other = await gateway.createPaymentIntent({
      amountCents: 25050,
      currency: 'EUR',
      transferGroup: 'booking_booking-1',
      metadata: { bookingId: 'booking-1' },
      idempotencyKey: 'another-key',
    });
    otherId = other.id;

    const result = await service.createPaymentIntent(CLIENT, 'booking-1');

    expect(result.clientSecret).toBe(other.clientSecret);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'booking-1', paymentIntentId: other.id }),
      expect.any(String),
    );
  });

  it('throws when the stored intent amount differs from the quote', async () => {
    const gateway = new FakeStripeGateway('whsec_unit');
    const stale = await gateway.createPaymentIntent({
      amountCents: 100,
      currency: 'EUR',
      transferGroup: 'booking_booking-1',
      metadata: { bookingId: 'booking-1' },
      idempotencyKey: 'stale',
    });
    const { service, logger } = setup({
      gateway,
      booking: bookingRow({ paymentIntentId: stale.id }),
    });

    await expect(service.createPaymentIntent(CLIENT, 'booking-1')).rejects.toThrow(
      /does not match the quote amount/,
    );
    expect(logger.error).toHaveBeenCalledWith(
      { bookingId: 'booking-1', paymentIntentId: stale.id },
      expect.any(String),
    );
  });
});
