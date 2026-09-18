import { describe, expect, it } from 'vitest';
import {
  CreateRefundRequestSchema,
  StripeAccountLinkResponseSchema,
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
