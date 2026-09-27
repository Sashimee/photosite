import { describe, expect, it } from 'vitest';
import {
  CreateRefundRequestSchema,
  CreateRefundResponseSchema,
  StripeAccountLinkResponseSchema,
  StripeAccountResponseSchema,
  StripeWebhookEventSchema,
} from './payments.js';

describe('CreateRefundRequestSchema', () => {
  it('accepts a reason with no amount (full refund)', () => {
    expect(CreateRefundRequestSchema.safeParse({ reason: 'Client cancelled' }).success).toBe(true);
  });

  it('accepts a partial amount with a reason', () => {
    expect(
      CreateRefundRequestSchema.safeParse({ amountCents: 5000, reason: 'Partial cancellation' })
        .success,
    ).toBe(true);
  });

  it('rejects a zero or negative amount', () => {
    expect(
      CreateRefundRequestSchema.safeParse({ amountCents: 0, reason: 'Client cancelled' }).success,
    ).toBe(false);
    expect(
      CreateRefundRequestSchema.safeParse({ amountCents: -1, reason: 'Client cancelled' }).success,
    ).toBe(false);
  });

  it('rejects a missing reason', () => {
    expect(CreateRefundRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      CreateRefundRequestSchema.safeParse({ reason: 'Client cancelled', force: true }).success,
    ).toBe(false);
  });
});

describe('StripeAccountLinkResponseSchema', () => {
  it('accepts a well-formed onboarding link', () => {
    expect(
      StripeAccountLinkResponseSchema.safeParse({
        url: 'https://connect.stripe.com/setup/e/acct_1P/abc123',
      }).success,
    ).toBe(true);
  });

  it('rejects a non-url', () => {
    expect(StripeAccountLinkResponseSchema.safeParse({ url: 'not-a-url' }).success).toBe(false);
  });
});

describe('StripeAccountResponseSchema', () => {
  it('accepts a connected account summary', () => {
    expect(
      StripeAccountResponseSchema.safeParse({
        stripeAccountId: 'acct_1P000000000000000',
        onboardingComplete: false,
        payoutsEnabled: false,
      }).success,
    ).toBe(true);
  });

  it('rejects a missing status flag', () => {
    expect(
      StripeAccountResponseSchema.safeParse({ stripeAccountId: 'acct_1P000000000000000' }).success,
    ).toBe(false);
  });
});

describe('StripeWebhookEventSchema', () => {
  const validEvent = {
    id: 'evt_1P000000000000000',
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_123', amount: 15000 } },
  };

  it('accepts a well-formed event envelope', () => {
    expect(StripeWebhookEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it('keeps unknown top-level Stripe fields (api_version, livemode, ...)', () => {
    const result = StripeWebhookEventSchema.safeParse({
      ...validEvent,
      livemode: false,
      api_version: '2026-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('keeps unknown fields inside data.object', () => {
    const result = StripeWebhookEventSchema.safeParse({
      ...validEvent,
      data: { object: { id: 'pi_123', charges: { data: [] } } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing id', () => {
    expect(StripeWebhookEventSchema.safeParse({ ...validEvent, id: undefined }).success).toBe(
      false,
    );
  });

  it('rejects a missing data.object', () => {
    expect(StripeWebhookEventSchema.safeParse({ ...validEvent, data: {} }).success).toBe(false);
  });
});

describe('CreateRefundResponseSchema', () => {
  const booking = {
    id: '0190a0b2-0000-7000-8000-000000000001',
    quoteId: '0190a0b2-0000-7000-8000-000000000002',
    clientId: '0190a0b2-0000-7000-8000-000000000003',
    photographerId: '0190a0b2-0000-7000-8000-000000000004',
    scheduledAt: '2026-10-01T10:00:00.000Z',
    location: null,
    total: { amountCents: 150000, currency: 'EUR' },
    status: 'paid_held',
    releaseDueAt: null,
    deliveredAt: null,
    releasedAt: null,
    cancelledAt: null,
    cancellationReason: null,
  };
  const partial = {
    status: 'partially_refunded',
    amount: { amountCents: 5000, currency: 'EUR' },
    refundedTotal: { amountCents: 5000, currency: 'EUR' },
    booking,
  };

  it('accepts a partial refund that keeps the booking state', () => {
    expect(CreateRefundResponseSchema.safeParse(partial).success).toBe(true);
  });

  it('accepts a full refund of a refunded booking', () => {
    expect(
      CreateRefundResponseSchema.safeParse({
        ...partial,
        status: 'refunded',
        refundedTotal: { amountCents: 150000, currency: 'EUR' },
        booking: { ...booking, status: 'refunded' },
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown status and unknown keys', () => {
    expect(CreateRefundResponseSchema.safeParse({ ...partial, status: 'pending' }).success).toBe(
      false,
    );
    expect(CreateRefundResponseSchema.safeParse({ ...partial, refundId: 're_123' }).success).toBe(
      false,
    );
  });
});
