import { HttpUrlSchema, IdSchema, errorResponses, requiresVerifiedEmail } from './common.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

// The public-safe shape of a professional's company: name, logo and the
// manual verified badge, never the email/phone/VAT number the account and
// profile carry (docs/steps/1A.13-professionals.md "genuinely public").
export const PublicProfessionalCompanySchema = z
  .object({
    id: IdSchema,
    companyName: z.string().min(1).max(120),
    website: HttpUrlSchema.nullable(),
    logoUrl: z.url().nullable(),
    verified: z.boolean(),
  })
  .strict()
  .openapi('PublicProfessionalCompany');

export const OwnProfessionalProfileSchema = PublicProfessionalCompanySchema.extend({
  vatNumber: z.string().min(1).max(50).nullable(),
})
  .strict()
  .openapi('OwnProfessionalProfile');

export const CreateProfessionalProfileRequestSchema = z
  .object({
    companyName: z.string().min(1).max(120),
    website: HttpUrlSchema.nullable().optional(),
    vatNumber: z.string().min(1).max(50).nullable().optional(),
    logoUploadId: IdSchema.nullable().optional(),
  })
  .strict();

export const UpdateProfessionalProfileRequestSchema =
  CreateProfessionalProfileRequestSchema.partial();

registry.registerPath({
  method: 'post',
  path: apiPath('/me/professional-profile'),
  summary: 'Create the professional profile for the current user, adding the professional role',
  tags: ['professionals'],
  security: AUTH_SECURITY,
  ...requiresVerifiedEmail(true),
  request: {
    body: {
      content: { 'application/json': { schema: CreateProfessionalProfileRequestSchema } },
    },
  },
  responses: {
    '201': {
      description: 'Professional profile created',
      content: { 'application/json': { schema: OwnProfessionalProfileSchema } },
    },
    ...errorResponses([400, 401, 409, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/professional-profile'),
  summary: "Get the current user's professional profile",
  tags: ['professionals'],
  security: AUTH_SECURITY,
  ...requiresVerifiedEmail(false),
  responses: {
    '200': {
      description: "The current user's professional profile",
      content: { 'application/json': { schema: OwnProfessionalProfileSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'patch',
  path: apiPath('/me/professional-profile'),
  summary: "Update the current user's professional profile",
  tags: ['professionals'],
  security: AUTH_SECURITY,
  ...requiresVerifiedEmail(false),
  request: {
    body: {
      content: { 'application/json': { schema: UpdateProfessionalProfileRequestSchema } },
    },
  },
  responses: {
    '200': {
      description: 'Professional profile updated',
      content: { 'application/json': { schema: OwnProfessionalProfileSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});
