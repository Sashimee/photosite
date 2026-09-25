import { CONSENT_PURPOSES, DATA_REQUEST_STATUSES, DATA_REQUEST_TYPES } from '../enums.js';
import { IdSchema, IsoDateTimeSchema, errorResponses } from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

// docs/steps/1A.12-gdpr.md "anonymise deletions past 30 days"; also drives
// the grace-period countdown shown on the admin data-requests list.
export const GDPR_DELETION_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

// `exportKey` is the private S3 object key and is never returned to a
// client: `GET .../download` issues a short-lived presigned URL from it
// instead (docs/steps/1A.12-gdpr.md "The export is a zip..."). `failureReason`
// is a stable code, never a stack trace.
export const DataRequestSchema = z
  .object({
    id: IdSchema,
    type: z.enum(DATA_REQUEST_TYPES),
    status: z.enum(DATA_REQUEST_STATUSES),
    requestedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
    expiresAt: IsoDateTimeSchema.nullable(),
    failureReason: z.string().min(1).max(200).nullable(),
    cancelledAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('DataRequest');

export const CreateDataRequestRequestSchema = z
  .object({
    type: z.enum(DATA_REQUEST_TYPES),
  })
  .strict();

// A soft-deleted account has no valid session (deletion revokes every one)
// and cannot sign in again to get a new one (docs/steps/1A.12-gdpr.md
// "Cancellable during the grace period"), so cancelling a deletion request
// is authorized either by an ordinary session (the common case for the
// other request type, and for a cancel issued moments before the requesting
// session itself is revoked) or by the single-use `token` mailed at
// deletion time. `.default({})` lets a normal in-session cancel call POST
// with no body at all, matching every other no-payload action route.
export const CancelDataRequestRequestSchema = z
  .object({ token: z.string().min(1).optional() })
  .strict()
  .default({});

export const DataRequestDownloadResponseSchema = z
  .object({
    url: z.url().openapi({ example: 'https://storage.photoo.lu/exports/abc123?signature=xyz' }),
    expiresAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('DataRequestDownload');

export const ConsentPurposeSchema = z.enum(CONSENT_PURPOSES).openapi({ example: 'analytics' });

// `policyVersion` is never accepted here: it always comes from
// `PlatformSetting` on the server, because a client-supplied version would
// let the caller forge what they agreed to (docs/steps/1A.12-gdpr.md
// "Consent records").
export const CreateConsentRequestSchema = z
  .object({
    anonymousId: z.string().min(1).max(100).optional(),
    purpose: ConsentPurposeSchema,
    granted: z.boolean(),
  })
  .strict();

// `ip`/`userAgent` are recorded server-side as evidence of consent but are
// never returned: they are PII, redacted from logs the same way
// (docs/steps/1A.12-gdpr.md "Consent records").
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

// One entry per purpose, always present, so the client can render every
// toggle without special-casing a purpose that was never decided
// (`granted: false`, `recordedAt: null`) — mirrors the notification
// preference matrix in contract/notifications.ts.
export const ConsentStateEntrySchema = z
  .object({
    purpose: ConsentPurposeSchema,
    granted: z.boolean(),
    policyVersion: z.string().min(1).max(20).nullable(),
    recordedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('ConsentStateEntry');

export const ConsentsResponseSchema = z
  .object({
    consents: z.array(ConsentStateEntrySchema).length(CONSENT_PURPOSES.length),
  })
  .strict()
  .openapi('Consents');

function hasUniquePurposes(entries: { purpose: string }[]): boolean {
  return new Set(entries.map((entry) => entry.purpose)).size === entries.length;
}

// Append-only writes for only the purposes that changed, not a full-matrix
// replace: `GET`/`PUT /v1/me/consents` "PUT appends new records for the
// purposes that changed" (docs/steps/1A.12-gdpr.md).
export const UpdateConsentsRequestSchema = z
  .object({
    consents: z
      .array(z.object({ purpose: ConsentPurposeSchema, granted: z.boolean() }).strict())
      .min(1)
      .max(CONSENT_PURPOSES.length)
      .refine(hasUniquePurposes, { message: 'purpose must not repeat' }),
  })
  .strict();

registry.registerPath({
  method: 'post',
  path: apiPath('/me/data-requests'),
  summary:
    'Create a data export or deletion request. Returns the existing row (200) if one of the ' +
    'same type is already pending or processing, instead of creating a second one.',
  tags: ['gdpr'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateDataRequestRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'An existing pending or processing request of the same type',
      content: { 'application/json': { schema: DataRequestSchema } },
    },
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
  method: 'get',
  path: apiPath('/me/data-requests/{id}'),
  summary: 'Get a data request',
  tags: ['gdpr'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The data request',
      content: { 'application/json': { schema: DataRequestSchema } },
    },
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/data-requests/{id}/cancel'),
  summary:
    'Cancel a data request during its grace period. Only a deletion request can be cancelled, ' +
    'and only before anonymisation runs. A soft-deleted account has no session, so `token` (the ' +
    'single-use value mailed at deletion time) is accepted in place of one.',
  tags: ['gdpr'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: CancelDataRequestRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Data request cancelled',
      content: { 'application/json': { schema: DataRequestSchema } },
    },
    ...errorResponses([401, 404, 409]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/data-requests/{id}/download'),
  summary:
    'Get a 10-minute presigned download URL for a completed export. 403 for a data request that ' +
    "belongs to someone else, 409 while the export is not yet ready, 410 once the request's " +
    'expiresAt has passed.',
  tags: ['gdpr'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Presigned download URL issued',
      content: { 'application/json': { schema: DataRequestDownloadResponseSchema } },
    },
    ...errorResponses([401, 403, 404, 409, 410]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/consents'),
  summary: "Get the current user's consent state per purpose (latest record wins)",
  tags: ['gdpr'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'The current consent state',
      content: { 'application/json': { schema: ConsentsResponseSchema } },
    },
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'put',
  path: apiPath('/me/consents'),
  summary: 'Append consent records for the purposes that changed. policyVersion is server-set.',
  tags: ['gdpr'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: UpdateConsentsRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'The updated consent state',
      content: { 'application/json': { schema: ConsentsResponseSchema } },
    },
    ...errorResponses([400, 401, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/consents'),
  summary:
    'Record a consent decision, anonymous (keyed by anonymousId) or for the current session. ' +
    'policyVersion is server-set, never accepted from the client.',
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
