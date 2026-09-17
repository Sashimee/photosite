import { LICENCE_USAGES, PHOTOGRAPHER_CATEGORIES, REQUEST_STATUSES } from '../enums.js';
import {
  CountryCodeSchema,
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

export const RequestCategorySchema = z
  .enum(PHOTOGRAPHER_CATEGORIES)
  .openapi({ example: 'wedding' });

export const RequestUsageSchema = z.enum(LICENCE_USAGES).openapi({ example: 'personal' });

const MAX_BUDGET_CENTS = 99_999_999;

export const RequestBudgetMoneySchema = MoneySchema.extend({
  amountCents: z.int().nonnegative().max(MAX_BUDGET_CENTS),
})
  .strict()
  .openapi('RequestBudgetMoney');

export const AddressSchema = z
  .object({
    line1: z.string().min(1).max(200),
    line2: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(120),
    postalCode: z.string().min(1).max(20),
    countryCode: CountryCodeSchema,
  })
  .strict()
  .openapi('Address');

const FutureIsoDateTimeSchema = IsoDateTimeSchema.refine(
  (value) => new Date(value).getTime() > Date.now(),
  'must be in the future',
);

function budgetRefinement(data: {
  budgetMin: { amountCents: number; currency: string };
  budgetMax: { amountCents: number; currency: string };
}) {
  return (
    data.budgetMin.currency === data.budgetMax.currency &&
    data.budgetMin.amountCents <= data.budgetMax.amountCents
  );
}

export const RequestSchema = z
  .object({
    id: IdSchema,
    clientId: IdSchema,
    title: z.string().min(1).max(150),
    category: RequestCategorySchema,
    description: z.string().min(1).max(4000),
    eventDate: IsoDateTimeSchema,
    dateFlexible: z.boolean(),
    location: LatLngSchema,
    address: AddressSchema,
    budgetMin: RequestBudgetMoneySchema,
    budgetMax: RequestBudgetMoneySchema,
    usage: RequestUsageSchema,
    status: z.enum(REQUEST_STATUSES),
    expiresAt: IsoDateTimeSchema.nullable(),
    quoteCount: z.int().nonnegative(),
  })
  .strict()
  .openapi('Request');

export const RequestSummarySchema = z
  .object({
    id: IdSchema,
    title: z.string().min(1).max(150),
    category: RequestCategorySchema,
    description: z.string().min(1).max(4000),
    eventDate: IsoDateTimeSchema,
    dateFlexible: z.boolean(),
    city: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    location: LatLngSchema,
    budgetMin: RequestBudgetMoneySchema,
    budgetMax: RequestBudgetMoneySchema,
    usage: RequestUsageSchema,
    status: z.enum(REQUEST_STATUSES),
    expiresAt: IsoDateTimeSchema.nullable(),
    hasQuoted: z.boolean(),
  })
  .strict()
  .openapi('RequestSummary');

export const RequestFeedQuerySchema = CursorPaginationQuerySchema.extend({
  radiusKm: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export const CreateRequestRequestSchema = z
  .object({
    title: z.string().min(1).max(150),
    category: RequestCategorySchema,
    description: z.string().min(1).max(4000),
    eventDate: FutureIsoDateTimeSchema,
    dateFlexible: z.boolean(),
    location: LatLngSchema,
    address: AddressSchema,
    budgetMin: RequestBudgetMoneySchema,
    budgetMax: RequestBudgetMoneySchema,
    usage: RequestUsageSchema,
  })
  .strict()
  .refine(budgetRefinement, {
    message: 'budgetMin must be less than or equal to budgetMax in the same currency',
    path: ['budgetMax'],
  });

registry.registerPath({
  method: 'post',
  path: apiPath('/requests'),
  summary: 'Create a request',
  tags: ['requests'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateRequestRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Request created',
      content: { 'application/json': { schema: RequestSchema } },
    },
    ...errorResponses([400, 401, 422, 429]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/requests'),
  summary: 'List open requests matching the current photographer profile',
  tags: ['requests'],
  security: AUTH_SECURITY,
  request: {
    query: RequestFeedQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of matching requests',
      content: { 'application/json': { schema: paginatedResponseSchema(RequestSummarySchema) } },
    },
    ...errorResponses([400, 401, 403]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/requests/mine'),
  summary: "List the current client's requests",
  tags: ['requests'],
  security: AUTH_SECURITY,
  request: {
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of requests',
      content: { 'application/json': { schema: paginatedResponseSchema(RequestSchema) } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/requests/{id}'),
  summary: 'Get a request',
  tags: ['requests'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The request',
      content: { 'application/json': { schema: RequestSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/requests/{id}/cancel'),
  summary: 'Cancel a request',
  tags: ['requests'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Request cancelled',
      content: { 'application/json': { schema: RequestSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});
