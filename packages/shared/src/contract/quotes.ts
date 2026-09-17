import { QUOTE_STATUSES } from '../enums.js';
import {
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  MoneySchema,
  SlugSchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

const MAX_LINE_ITEM_QTY = 1000;
const MAX_LINE_ITEM_UNIT_CENTS = 99_999_999;
const MAX_LINE_ITEMS = 50;

export const LineItemSchema = z
  .object({
    label: z.string().min(1).max(150),
    qty: z.int().min(1).max(MAX_LINE_ITEM_QTY),
    unitCents: z.int().nonnegative().max(MAX_LINE_ITEM_UNIT_CENTS),
  })
  .strict()
  .openapi('LineItem');

const FutureIsoDateTimeSchema = IsoDateTimeSchema.refine(
  (value) => new Date(value).getTime() > Date.now(),
  'must be in the future',
);

export const QuoteSchema = z
  .object({
    id: IdSchema,
    requestId: IdSchema.nullable(),
    photographerId: IdSchema,
    clientId: IdSchema,
    productId: IdSchema.nullable(),
    productTierId: IdSchema.nullable(),
    lineItems: z.array(LineItemSchema).min(1).max(MAX_LINE_ITEMS),
    subtotal: MoneySchema,
    platformFee: MoneySchema,
    total: MoneySchema,
    validUntil: IsoDateTimeSchema,
    message: z.string().max(2000).nullable(),
    status: z.enum(QUOTE_STATUSES),
  })
  .strict()
  .openapi('Quote');

export const CreateQuoteRequestSchema = z
  .object({
    requestId: IdSchema,
    lineItems: z.array(LineItemSchema).min(1).max(MAX_LINE_ITEMS),
    validUntil: FutureIsoDateTimeSchema,
    message: z.string().max(2000).optional(),
  })
  .strict();

export const DirectQuoteRequestSchema = z
  .object({
    productTierId: IdSchema,
    message: z.string().max(2000).optional(),
  })
  .strict();

export const QuotesMineQuerySchema = CursorPaginationQuerySchema.extend({
  role: z.enum(['photographer', 'client']).optional(),
}).strict();

registry.registerPath({
  method: 'post',
  path: apiPath('/quotes'),
  summary: 'Create a quote for a request',
  tags: ['quotes'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateQuoteRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Quote created',
      content: { 'application/json': { schema: QuoteSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/photographers/{slug}/products/{productId}/quotes'),
  summary: 'Request a direct quote from a product tier',
  tags: ['quotes'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ slug: SlugSchema, productId: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: DirectQuoteRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Quote created',
      content: { 'application/json': { schema: QuoteSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/quotes/mine'),
  summary: "List the current user's quotes",
  tags: ['quotes'],
  security: AUTH_SECURITY,
  request: {
    query: QuotesMineQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of quotes',
      content: { 'application/json': { schema: paginatedResponseSchema(QuoteSchema) } },
    },
    ...errorResponses([400, 401]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/quotes/{id}'),
  summary: 'Get a quote',
  tags: ['quotes'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The quote',
      content: { 'application/json': { schema: QuoteSchema } },
    },
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/requests/{requestId}/quotes'),
  summary: 'List the quotes for a request',
  tags: ['quotes'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ requestId: IdSchema }).strict(),
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of quotes for the request',
      content: { 'application/json': { schema: paginatedResponseSchema(QuoteSchema) } },
    },
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/quotes/{id}/accept'),
  summary: 'Accept a quote',
  tags: ['quotes'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Quote accepted',
      content: { 'application/json': { schema: QuoteSchema } },
    },
    ...errorResponses([401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/quotes/{id}/decline'),
  summary: 'Decline a quote',
  tags: ['quotes'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Quote declined',
      content: { 'application/json': { schema: QuoteSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/quotes/{id}/withdraw'),
  summary: 'Withdraw a quote',
  tags: ['quotes'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Quote withdrawn',
      content: { 'application/json': { schema: QuoteSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});
