import { describe, expect, it } from 'vitest';
import {
  BookingSchema,
  CancelBookingRequestSchema,
  CreateDeliveryRequestSchema,
} from './bookings.js';

const validBooking = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  quoteId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  clientId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  photographerId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  scheduledAt: '2026-10-01T10:00:00.000Z',
  location: { lat: 49.6116, lng: 6.1319 },
  total: { amountCents: 150000, currency: 'EUR' },
  status: 'paid_held',
  releaseDueAt: '2026-10-08T10:00:00.000Z',
  deliveredAt: null,
  releasedAt: null,
  cancelledAt: null,
  cancellationReason: null,
};

describe('BookingSchema', () => {
  it('accepts a well-formed booking', () => {
    expect(BookingSchema.safeParse(validBooking).success).toBe(true);
  });

  it('rejects a booking carrying a paymentIntentId', () => {
    expect(BookingSchema.safeParse({ ...validBooking, paymentIntentId: 'pi_123' }).success).toBe(
      false,
    );
  });

  it('rejects an unknown status', () => {
    expect(BookingSchema.safeParse({ ...validBooking, status: 'archived' }).success).toBe(false);
  });
});

describe('CreateDeliveryRequestSchema', () => {
  it('accepts a delivery with file ids', () => {
    expect(
      CreateDeliveryRequestSchema.safeParse({
        message: 'Here is your gallery',
        fileIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
      }).success,
    ).toBe(true);
  });

  it('accepts a delivery with an external link', () => {
    expect(
      CreateDeliveryRequestSchema.safeParse({
        message: 'Here is your gallery',
        externalLink: 'https://gallery.example.com/abc',
      }).success,
    ).toBe(true);
  });

  it('rejects a delivery with neither file ids nor a link', () => {
    expect(CreateDeliveryRequestSchema.safeParse({ message: 'Here is your gallery' }).success).toBe(
      false,
    );
  });

  it('rejects a delivery with both file ids and a link', () => {
    expect(
      CreateDeliveryRequestSchema.safeParse({
        message: 'Here is your gallery',
        fileIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'],
        externalLink: 'https://gallery.example.com/abc',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty message', () => {
    expect(
      CreateDeliveryRequestSchema.safeParse({
        message: '',
        externalLink: 'https://gallery.example.com/abc',
      }).success,
    ).toBe(false);
  });
});

describe('CancelBookingRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(CancelBookingRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a reason', () => {
    expect(CancelBookingRequestSchema.safeParse({ reason: 'Client rescheduled' }).success).toBe(
      true,
    );
  });

  it('rejects unknown keys', () => {
    expect(CancelBookingRequestSchema.safeParse({ refundCents: 1000 }).success).toBe(false);
  });
});
