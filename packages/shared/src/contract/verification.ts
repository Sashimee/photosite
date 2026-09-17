import { VERIFICATION_CASE_STATUSES, VIRUS_SCAN_STATUSES } from '../enums.js';
import { CountryCodeSchema, IdSchema, IsoDateTimeSchema, errorResponses } from './common.js';
import { LocalizedTextSchema } from './profiles.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { MimeTypeSchema } from './uploads.js';
import { z } from './zod.js';

export const RequiredDocumentSchema = z
  .object({
    key: z.string().min(1).max(60).openapi({ example: 'id_card' }),
    label: LocalizedTextSchema,
    description: z.string().max(1000).nullable(),
    acceptedMimeTypes: z.array(MimeTypeSchema).min(1),
  })
  .strict()
  .openapi('RequiredDocument');

export const VerificationRequirementsResponseSchema = z
  .object({
    countryCode: CountryCodeSchema,
    documents: z.array(RequiredDocumentSchema),
  })
  .strict()
  .openapi('VerificationRequirements');

export const VerificationDocumentSchema = z
  .object({
    id: IdSchema,
    documentKey: z.string().min(1).max(60).openapi({ example: 'id_card' }),
    mimeType: MimeTypeSchema,
    virusScanStatus: z.enum(VIRUS_SCAN_STATUSES),
    uploadedAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('VerificationDocument');

// `downloadUrl` is optional: a document whose upload hasn't cleared the
// virus scan yet (status clean/processed) is listed without a link rather
// than blocking the whole case view on one pending scan.
export const AdminVerificationDocumentSchema = VerificationDocumentSchema.extend({
  downloadUrl: z.url().optional(),
})
  .strict()
  .openapi('AdminVerificationDocument');

const VerificationCaseCommonSchema = z.object({
  id: IdSchema,
  countryCode: CountryCodeSchema,
  status: z.enum(VERIFICATION_CASE_STATUSES),
  documents: z.array(VerificationDocumentSchema),
  submittedAt: IsoDateTimeSchema.nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  rejectionReason: z.string().min(1).max(1000).nullable(),
});

const VerificationCaseBaseSchema = VerificationCaseCommonSchema.extend({
  businessName: z.string().min(1).max(200).nullable(),
  vatNumber: z.string().min(1).max(40).nullable(),
  businessRegistrationNumber: z.string().min(1).max(60).nullable(),
});

export const VerificationCaseSchema =
  VerificationCaseBaseSchema.strict().openapi('VerificationCase');

export const AdminVerificationPhotographerSchema = z
  .object({
    displayName: z.string().min(1).max(200),
    email: z.email(),
  })
  .strict()
  .openapi('AdminVerificationPhotographer');

// Used by the list endpoint: no business PII (businessName/vatNumber/
// businessRegistrationNumber stay decrypted only on the single-case
// endpoint below, which is audited) and no per-document presigned URLs, so
// paging through the queue never mass-decrypts PII or mass-issues
// short-lived S3 links (docs/steps/1A.9-verification.md "Admin review").
// `photographer` carries just enough identity for the queue UI (1D.3).
export const AdminVerificationCaseSummarySchema = VerificationCaseCommonSchema.extend({
  userId: IdSchema,
  assignedAdminId: IdSchema.nullable(),
  decidedByAdminId: IdSchema.nullable(),
  photographer: AdminVerificationPhotographerSchema,
})
  .strict()
  .openapi('AdminVerificationCaseSummary');

export const AdminVerificationCaseSchema = VerificationCaseBaseSchema.extend({
  userId: IdSchema,
  assignedAdminId: IdSchema.nullable(),
  decidedByAdminId: IdSchema.nullable(),
  documents: z.array(AdminVerificationDocumentSchema),
})
  .strict()
  .openapi('AdminVerificationCase');

// countryCode is never accepted from the client: the case's country is
// always the caller's photographer profile countryCode, set by the server
// (docs/steps/1A.9-verification.md).
export const CreateVerificationCaseRequestSchema = z
  .object({
    businessName: z.string().min(1).max(200).optional(),
    vatNumber: z.string().min(1).max(40).optional(),
    businessRegistrationNumber: z.string().min(1).max(60).optional(),
  })
  .strict();

export const UpdateVerificationCaseRequestSchema = CreateVerificationCaseRequestSchema.partial();

export const AttachVerificationDocumentRequestSchema = z
  .object({
    uploadId: IdSchema,
    documentKey: z.string().min(1).max(60).openapi({ example: 'id_card' }),
  })
  .strict();

registry.registerPath({
  method: 'get',
  path: apiPath('/countries/{code}/verification-requirements'),
  summary: 'Get the required verification documents for a country',
  tags: ['verification'],
  request: {
    params: z.object({ code: CountryCodeSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The required documents for the country',
      content: { 'application/json': { schema: VerificationRequirementsResponseSchema } },
    },
    ...errorResponses([404]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/verification-case'),
  summary: "Get the current user's verification case",
  tags: ['verification'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: "The current user's verification case",
      content: { 'application/json': { schema: VerificationCaseSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/verification-case'),
  summary: 'Create the verification case for the current user',
  tags: ['verification'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateVerificationCaseRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Verification case created',
      content: { 'application/json': { schema: VerificationCaseSchema } },
    },
    ...errorResponses([400, 401, 403, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'patch',
  path: apiPath('/me/verification-case'),
  summary: "Update the current user's draft verification case",
  tags: ['verification'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: UpdateVerificationCaseRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Verification case updated',
      content: { 'application/json': { schema: VerificationCaseSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/verification-case/documents'),
  summary: "Attach an uploaded document to the current user's verification case",
  tags: ['verification'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: AttachVerificationDocumentRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Document attached',
      content: { 'application/json': { schema: VerificationDocumentSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/verification-case/submit'),
  summary: "Submit the current user's verification case for review",
  tags: ['verification'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'Verification case submitted',
      content: { 'application/json': { schema: VerificationCaseSchema } },
    },
    ...errorResponses([401, 403, 404, 409, 422, 429]),
  },
});
