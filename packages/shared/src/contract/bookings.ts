import { BOOKING_STATUSES } from '../enums.js';
import {
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  LatLngSchema,
  MoneySchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const BookingBaseSchema = z.object({
  id: IdSchema,
  quoteId: IdSchema,
  clientId: IdSchema,
  photographerId: IdSchema,
  scheduledAt: IsoDateTimeSchema,
  location: LatLngSchema,
  total: MoneySchema,
  status: z.enum(BOOKING_STATUSES),
  releaseDueAt: IsoDateTimeSchema.nullable(),
  deliveredAt: IsoDateTimeSchema.nullable(),
  releasedAt: IsoDateTimeSchema.nullable(),
  cancelledAt: IsoDateTimeSchema.nullable(),
  cancellationReason: z.string().max(2000).nullable(),
});

export const BookingSchema = BookingBaseSchema.strict().openapi('Booking');

export const DeliverySchema = z
  .object({
    id: IdSchema,
    bookingId: IdSchema,
    message: z.string().max(2000),
    fileIds: z.array(IdSchema).nullable(),
    externalLink: z.url().nullable(),
    deliveredAt: IsoDateTimeSchema,
    acceptedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('Delivery');

function exactlyOneDeliveryPayload(data: {
  fileIds?: string[] | undefined;
  externalLink?: string | undefined;
}) {
  const hasFiles = data.fileIds !== undefined && data.fileIds.length > 0;
  const hasLink = data.externalLink !== undefined;
  return hasFiles !== hasLink;
}

export const CreateDeliveryRequestSchema = z
  .object({
    message: z.string().min(1).max(2000),
    fileIds: z.array(IdSchema).min(1).optional(),
    externalLink: z.url().optional(),
  })
  .strict()
  .refine(exactlyOneDeliveryPayload, {
    message: 'provide either fileIds or externalLink, but not both',
    path: ['fileIds'],
  });

export const CancelBookingRequestSchema = z
  .object({
    reason: z.string().min(1).max(2000).optional(),
  })
  .strict();

export const CreateDeliveryResponseSchema = z
  .object({
    delivery: DeliverySchema,
  })
  .strict();

export const PaymentIntentResponseSchema = z
  .object({
    clientSecret: z.string().openapi({ example: 'pi_3P_secret_abc123' }),
  })
  .strict()
  .openapi('BookingPaymentIntent');

registry.registerPath({
  method: 'get',
  path: apiPath('/bookings'),
  summary: 'List the current user bookings',
  tags: ['bookings'],
  security: AUTH_SECURITY,
  request: {
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of bookings',
      content: { 'application/json': { schema: paginatedResponseSchema(BookingSchema) } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/bookings/{id}'),
  summary: 'Get a booking',
  tags: ['bookings'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The booking',
      content: { 'application/json': { schema: BookingSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/bookings/{id}/delivery'),
  summary: 'Submit a delivery for a booking',
  tags: ['bookings'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: CreateDeliveryRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Delivery submitted',
      content: { 'application/json': { schema: CreateDeliveryResponseSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/bookings/{id}/accept-delivery'),
  summary: 'Accept the delivery of a booking',
  tags: ['bookings'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Delivery accepted',
      content: { 'application/json': { schema: BookingSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/bookings/{id}/cancel'),
  summary: 'Cancel a booking',
  tags: ['bookings'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: CancelBookingRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Booking cancelled',
      content: { 'application/json': { schema: BookingSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/bookings/{id}/payment-intent'),
  summary: 'Create a payment intent for a booking',
  tags: ['bookings'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Payment intent client secret',
      content: { 'application/json': { schema: PaymentIntentResponseSchema } },
    },
    ...errorResponses([401, 403, 404, 409, 422]),
  },
});
