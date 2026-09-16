import { DATA_REQUEST_STATUSES, DATA_REQUEST_TYPES } from '../enums.js';
import { IdSchema, IsoDateTimeSchema, errorResponses } from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const DataRequestSchema = z
  .object({
    id: IdSchema,
    type: z.enum(DATA_REQUEST_TYPES),
    status: z.enum(DATA_REQUEST_STATUSES),
    requestedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('DataRequest');

export const CreateDataRequestRequestSchema = z
  .object({
    type: z.enum(DATA_REQUEST_TYPES),
  })
  .strict();

const CONSENT_PURPOSES = ['analytics', 'ads', 'marketing'] as const;

export const ConsentPurposeSchema = z.enum(CONSENT_PURPOSES).openapi({ example: 'analytics' });

export const CreateConsentRequestSchema = z
  .object({
    anonymousId: z.string().min(1).max(100).optional(),
    purpose: ConsentPurposeSchema,
    granted: z.boolean(),
    policyVersion: z.string().min(1).max(20).openapi({ example: '2026-01-01' }),
  })
  .strict();

export const ConsentRecordSchema = z
  .object({
    id: IdSchema,
    purpose: ConsentPurposeSchema,
    granted: z.boolean(),
    policyVersion: z.string().min(1).max(20),
    recordedAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('ConsentRecord');

registry.registerPath({
  method: 'post',
  path: apiPath('/me/data-requests'),
  summary: 'Create a data export or deletion request',
  tags: ['gdpr'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateDataRequestRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Data request created',
      content: { 'application/json': { schema: DataRequestSchema } },
    },
    ...errorResponses([400, 401, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/data-requests'),
  summary: "List the current user's data requests",
  tags: ['gdpr'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'The current user data requests',
      content: { 'application/json': { schema: z.array(DataRequestSchema) } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/consents'),
  summary: 'Record a consent decision',
  tags: ['gdpr'],
  request: {
    body: { content: { 'application/json': { schema: CreateConsentRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Consent recorded',
      content: { 'application/json': { schema: ConsentRecordSchema } },
    },
    ...errorResponses([400, 422, 429]),
  },
});
