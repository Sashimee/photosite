import { IdSchema, errorResponses } from './common.js';
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

// Returned by the Connect onboarding link endpoint (1A.8b implements it):
// a Stripe-hosted URL the client redirects the photographer to.
export const StripeAccountLinkResponseSchema = z
  .object({
    url: z.url().openapi({ example: 'https://connect.stripe.com/setup/e/acct_1P/abc123' }),
  })
  .strict()
  .openapi('StripeAccountLinkResponse');

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

export const CreateRefundResponseSchema = z
  .object({
    status: z.literal('refunded'),
  })
  .strict()
  .openapi('CreateRefundResponse');

registry.registerPath({
  method: 'post',
  path: apiPath('/bookings/{id}/refund'),
  summary: 'Request a refund for a booking before release',
  description:
    'Self-service, before release only. After release a refund requires a transfer reversal and is admin-only (POST /v1/admin/bookings/{id}/refund).',
  tags: ['payments'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: CreateRefundRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Refund requested',
      content: { 'application/json': { schema: CreateRefundResponseSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/stripe/account-link'),
  summary: "Create a Stripe Connect Express onboarding link for the caller's account",
  description:
    'Requires a connected account to already exist (POST /v1/me/stripe/account, 1A.8b). Returns a short-lived, Stripe-hosted onboarding URL.',
  tags: ['payments'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'Onboarding link created',
      content: { 'application/json': { schema: StripeAccountLinkResponseSchema } },
    },
    ...errorResponses([401, 403, 404, 422]),
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
