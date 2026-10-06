import { BookingSchema } from './bookings.js';
import {
  CurrencyCodeSchema,
  IdSchema,
  IsoDateTimeSchema,
  MoneySchema,
  errorResponses,
  requiresVerifiedEmail,
} from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

// Self-service refund, before release only; after release a refund needs a
// transfer reversal first and is admin-only (docs/PAYMENTS.md,
// `AdminBookingSchema`/`RefundBookingRequestSchema` in `admin.ts`).
// `amountCents` is optional: omitted means a full refund of the charge.
export const CreateRefundRequestSchema = z
  .object({
    amountCents: z.int().positive().optional(),
    reason: z.string().min(1).max(2000),
  })
  .strict()
  .openapi('CreateRefundRequest');

// Mirrors the caller's PhotographerProfile Stripe fields. Onboarding state is
// only ever changed by the `account.updated` webhook, never by this endpoint.
export const StripeAccountResponseSchema = z
  .object({
    stripeAccountId: z.string().min(1).openapi({ example: 'acct_1P000000000000000' }),
    onboardingComplete: z.boolean(),
    payoutsEnabled: z.boolean(),
  })
  .strict()
  .openapi('StripeAccountResponse');

// A Stripe-hosted URL the client redirects the photographer to.
export const StripeAccountLinkResponseSchema = z
  .object({
    url: z.url().openapi({ example: 'https://connect.stripe.com/setup/e/acct_1P/abc123' }),
  })
  .strict()
  .openapi('StripeAccountLinkResponse');

// One row per currency the photographer has money in; amounts are never
// converted or summed across currencies. `releasedCents` is the ledger's
// transfers minus reversals; `heldCents` is the quote snapshot's
// `subtotalCents - platformFeeCents` (minus any refund before release) on
// bookings not yet transferred, never recomputed from a fee percent.
export const EarningsTotalSchema = z
  .object({
    currency: CurrencyCodeSchema,
    releasedCents: z.int().nonnegative().openapi({ example: 23797 }),
    heldCents: z.int().nonnegative().openapi({ example: 9500 }),
  })
  .strict()
  .openapi('EarningsTotal');

// `amountCents` is the booking's net from the ledger (transfers minus
// reversals); `occurredAt` is its latest transfer or reversal entry.
export const EarningsRecentEntrySchema = z
  .object({
    bookingId: IdSchema,
    amountCents: z.int().nonnegative().openapi({ example: 23797 }),
    currency: CurrencyCodeSchema,
    occurredAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('EarningsRecentEntry');

export const EARNINGS_RECENT_LIMIT = 20;

export const EarningsResponseSchema = z
  .object({
    totals: z.array(EarningsTotalSchema),
    recent: z.array(EarningsRecentEntrySchema).max(EARNINGS_RECENT_LIMIT),
  })
  .strict()
  .openapi('EarningsResponse');

// The shape the API's webhook endpoint (`POST /v1/stripe/webhook`,
// docs/PAYMENTS.md) receives after Fastify's route-scoped raw-body capture
// and Stripe signature verification (1A.8c). Loose on purpose: this is an
// envelope around whatever `data.object` a given Stripe event type carries,
// not a schema for that payload's business fields, and the full event is
// stored as-is in `StripeEvent.payload`.
export const StripeWebhookEventSchema = z
  .looseObject({
    id: z.string().min(1).openapi({ example: 'evt_1P000000000000000' }),
    type: z.string().min(1).openapi({ example: 'payment_intent.succeeded' }),
    data: z
      .object({
        object: z.record(z.string(), z.unknown()),
      })
      .loose(),
  })
  .openapi('StripeWebhookEvent');

export const StripeWebhookAckResponseSchema = z
  .object({
    received: z.literal(true),
  })
  .strict()
  .openapi('StripeWebhookAckResponse');

// `refundedTotal` is the cumulative amount refunded on the booking so far,
// this refund included; the booking is `refunded` once it reaches the total.
export const CreateRefundResponseSchema = z
  .object({
    status: z.enum(['refunded', 'partially_refunded']),
    amount: MoneySchema,
    refundedTotal: MoneySchema,
    booking: BookingSchema,
  })
  .strict()
  .openapi('CreateRefundResponse');

registry.registerPath({
  method: 'post',
  path: apiPath('/bookings/{id}/refund'),
  summary: 'Request a refund for a booking before release',
  description:
    'Client only, before release (paid_held, in_progress or delivered), otherwise 409. `amountCents` omitted refunds whatever is left; a cumulative refund above the charged total is 422. A full refund moves the booking to `refunded`, a partial one keeps its state. After release a refund requires a transfer reversal and is admin-only (POST /v1/admin/bookings/{id}/refund).',
  tags: ['payments'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: CreateRefundRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Refund created',
      content: { 'application/json': { schema: CreateRefundResponseSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/stripe/account'),
  summary: "Create the caller's Stripe Connect Express account",
  description:
    'Photographer only. Idempotent: the first call creates the Express account and returns 201; later calls return the existing account with 200.',
  tags: ['payments'],
  security: AUTH_SECURITY,
  ...requiresVerifiedEmail(true),
  responses: {
    '200': {
      description: 'Connected account already existed',
      content: { 'application/json': { schema: StripeAccountResponseSchema } },
    },
    '201': {
      description: 'Connected account created',
      content: { 'application/json': { schema: StripeAccountResponseSchema } },
    },
    ...errorResponses([401, 403, 404, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/stripe/account-link'),
  summary: "Create a Stripe Connect Express onboarding link for the caller's account",
  description:
    'Photographer only. Requires a connected account to already exist (POST /v1/me/stripe/account), otherwise 409. Returns a short-lived, Stripe-hosted onboarding URL.',
  tags: ['payments'],
  security: AUTH_SECURITY,
  ...requiresVerifiedEmail(true),
  responses: {
    '200': {
      description: 'Onboarding link created',
      content: { 'application/json': { schema: StripeAccountLinkResponseSchema } },
    },
    ...errorResponses([401, 403, 404, 409, 429]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/earnings'),
  summary: "The caller's released and held earnings per currency",
  description:
    'Photographer only. `totals` has one row per currency, never converted. `recent` lists at most 20 bookings with a transfer or reversal, newest first. A photographer with no bookings gets empty arrays.',
  tags: ['payments'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'Earnings summary',
      content: { 'application/json': { schema: EarningsResponseSchema } },
    },
    ...errorResponses([401, 403, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/stripe/webhook'),
  summary: 'Stripe webhook endpoint',
  description:
    'Called by Stripe, not by API clients. Verified against the raw request body and the Stripe-Signature header; unsigned or invalid requests get 400. Idempotent by event id (StripeEvent.id).',
  tags: ['payments'],
  request: {
    body: { content: { 'application/json': { schema: StripeWebhookEventSchema } } },
  },
  responses: {
    '200': {
      description: 'Event recorded (side effects, if any, are enqueued, not done inline)',
      content: { 'application/json': { schema: StripeWebhookAckResponseSchema } },
    },
    ...errorResponses([400]),
  },
});
