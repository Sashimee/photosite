import {
  JOB_APPLICATION_STATUSES,
  JOB_OFFER_STATUSES,
  LISTING_KINDS,
  PHOTOGRAPHER_CATEGORIES,
} from '../enums.js';
import {
  CountryCodeSchema,
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  LatLngSchema,
  MoneySchema,
  SlugSchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { PublicProfessionalCompanySchema } from './professionals.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const JobOfferCategorySchema = z
  .enum(PHOTOGRAPHER_CATEGORIES)
  .openapi({ example: 'wedding' });

const HTTPS_URL_PROTOCOL = /^https$/;

// https-only and normalised (docs/steps/1A.13-professionals.md "rendered as
// a link with rel=nofollow noopener"): `new URL().toString()` lowercases the
// scheme/host and drops a redundant default port, so two photographers who
// type the same link differently store the same value.
export const PortfolioLinkSchema = z
  .url({ protocol: HTTPS_URL_PROTOCOL })
  .max(2000)
  .transform((value) => new URL(value).toString())
  .openapi({ description: 'https-only URL, normalised', example: 'https://example.com/portfolio' });

function jobOfferDateRangeRefinement(data: {
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
}) {
  if (!data.startDate || !data.endDate) {
    return true;
  }
  return new Date(data.startDate).getTime() <= new Date(data.endDate).getTime();
}

// A remote offer has no site to attach a point to; every other offer needs
// one for distance search and the map pin (docs/steps/1A.13-professionals.md).
function jobOfferLocationRefinement(data: {
  remote: boolean;
  location?: { lat: number; lng: number } | undefined;
}) {
  return data.remote || data.location !== undefined;
}

export const CompensationSchema = z
  .object({
    min: MoneySchema,
    max: MoneySchema,
  })
  .strict()
  .refine(
    (data) =>
      data.min.currency === data.max.currency && data.min.amountCents <= data.max.amountCents,
    { message: 'min must be less than or equal to max in the same currency', path: ['max'] },
  )
  .openapi('Compensation');

export const JobOfferSchema = z
  .object({
    id: IdSchema,
    slug: SlugSchema,
    title: z.string().min(1).max(150),
    description: z.string().min(1).max(4000),
    category: JobOfferCategorySchema,
    city: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    location: LatLngSchema.nullable(),
    remote: z.boolean(),
    startDate: IsoDateTimeSchema.nullable(),
    endDate: IsoDateTimeSchema.nullable(),
    compensation: CompensationSchema.nullable(),
    status: z.enum(JOB_OFFER_STATUSES),
    publishedAt: IsoDateTimeSchema.nullable(),
    expiresAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .refine(jobOfferDateRangeRefinement, {
    message: 'startDate must be less than or equal to endDate',
    path: ['endDate'],
  })
  .openapi('JobOffer');

// zod refuses .partial() on a schema carrying an object-level refinement, so
// the mutable fields live here unrefined and CreateJobOfferRequestSchema and
// UpdateJobOfferRequestSchema each build on top of it. UpdateJobOfferRequestSchema
// has no startDate <= endDate or location/remote check as a result; the
// service must check both itself on PATCH (docs/steps/1A.13-professionals.md).
const JobOfferMutableFieldsSchema = z
  .object({
    title: z.string().min(1).max(150),
    description: z.string().min(1).max(4000),
    category: JobOfferCategorySchema,
    city: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    location: LatLngSchema.optional(),
    remote: z.boolean(),
    startDate: IsoDateTimeSchema.nullable().optional(),
    endDate: IsoDateTimeSchema.nullable().optional(),
    compensation: CompensationSchema.nullable().optional(),
  })
  .strict();

export const CreateJobOfferRequestSchema = JobOfferMutableFieldsSchema.refine(
  jobOfferDateRangeRefinement,
  { message: 'startDate must be less than or equal to endDate', path: ['endDate'] },
).refine(jobOfferLocationRefinement, {
  message: 'location is required unless remote is true',
  path: ['location'],
});

export const UpdateJobOfferRequestSchema = JobOfferMutableFieldsSchema.partial();

// `company` is the public-safe PublicProfessionalCompanySchema, not the
// owner-facing OwnProfessionalProfileSchema, so the professional's email,
// phone or VAT number can never be serialised here.
export const PublicJobOfferSummarySchema = z
  .object({
    id: IdSchema,
    slug: SlugSchema,
    title: z.string().min(1).max(150),
    category: JobOfferCategorySchema,
    city: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    location: LatLngSchema.nullable(),
    remote: z.boolean(),
    compensation: CompensationSchema.nullable(),
    publishedAt: IsoDateTimeSchema,
    company: PublicProfessionalCompanySchema,
  })
  .strict()
  .openapi('PublicJobOfferSummary');

export const PublicJobOfferSchema = PublicJobOfferSummarySchema.extend({
  description: z.string().min(1).max(4000),
  startDate: IsoDateTimeSchema.nullable(),
  endDate: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema,
})
  .strict()
  .openapi('PublicJobOffer');

export const JobOffersQuerySchema = CursorPaginationQuerySchema.extend({
  category: JobOfferCategorySchema.optional(),
  countryCode: CountryCodeSchema.optional(),
  city: z.string().min(1).max(120).optional(),
  remote: z.stringbool().optional(),
  q: z.string().min(1).max(150).optional(),
}).strict();

export const JobApplicationPhotographerSchema = z
  .object({
    id: IdSchema,
    slug: SlugSchema,
    displayName: z.string().min(1).max(120),
    avatarUrl: z.url().nullable(),
    city: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
  })
  .strict()
  .openapi('JobApplicationPhotographer');

export const JobApplicationOfferSummarySchema = z
  .object({
    id: IdSchema,
    slug: SlugSchema,
    title: z.string().min(1).max(150),
    status: z.enum(JOB_OFFER_STATUSES),
  })
  .strict()
  .openapi('JobApplicationOfferSummary');

export const JobApplicationSchema = z
  .object({
    id: IdSchema,
    jobOfferId: IdSchema,
    photographerId: IdSchema,
    message: z.string().min(1).max(2000),
    portfolioLink: PortfolioLinkSchema.nullable(),
    status: z.enum(JOB_APPLICATION_STATUSES),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('JobApplication');

export const JobApplicationWithPhotographerSchema = JobApplicationSchema.extend({
  photographer: JobApplicationPhotographerSchema,
})
  .strict()
  .openapi('JobApplicationWithPhotographer');

export const JobApplicationWithOfferSchema = JobApplicationSchema.extend({
  jobOffer: JobApplicationOfferSummarySchema,
})
  .strict()
  .openapi('JobApplicationWithOffer');

export const CreateJobApplicationRequestSchema = z
  .object({
    message: z.string().min(1).max(2000),
    portfolioLink: PortfolioLinkSchema.nullable().optional(),
  })
  .strict();

// The initial status comes from POST /job-offers/{id}/applications, which
// takes no status; submitted is a starting point, never a transition target
// (docs/steps/1A.13-professionals.md "submitted -> shortlisted|rejected|withdrawn").
export const UpdateJobApplicationStatusRequestSchema = z
  .object({
    status: z.enum(JOB_APPLICATION_STATUSES).exclude(['submitted']),
  })
  .strict();

// Every listing created in Phase 1 is free (D8); the service refuses
// anything else, and this is what it validates against before that check
// ever runs (docs/steps/1A.13-professionals.md "refuses to create a listing
// with any plan other than free").
export const CreateListingRequestSchema = z
  .object({
    kind: z.enum(LISTING_KINDS),
    plan: z.literal('free'),
  })
  .strict();

registry.registerPath({
  method: 'get',
  path: apiPath('/job-offers'),
  summary: 'List published, unexpired job offers',
  tags: ['job-board'],
  request: {
    query: JobOffersQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of matching job offers',
      content: {
        'application/json': { schema: paginatedResponseSchema(PublicJobOfferSummarySchema) },
      },
    },
    ...errorResponses([400, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/job-offers/{slug}'),
  summary: 'Get a published job offer by slug',
  tags: ['job-board'],
  request: {
    params: z.object({ slug: SlugSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The job offer',
      content: { 'application/json': { schema: PublicJobOfferSchema } },
    },
    ...errorResponses([404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/job-offers'),
  summary: 'Create a draft job offer',
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateJobOfferRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Job offer created',
      content: { 'application/json': { schema: JobOfferSchema } },
    },
    ...errorResponses([400, 401, 403, 422, 429]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/job-offers'),
  summary: "List the current professional's job offers",
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of job offers',
      content: { 'application/json': { schema: paginatedResponseSchema(JobOfferSchema) } },
    },
    ...errorResponses([401, 403]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/job-offers/{id}'),
  summary: "Get one of the current professional's job offers",
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The job offer',
      content: { 'application/json': { schema: JobOfferSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'patch',
  path: apiPath('/me/job-offers/{id}'),
  summary: "Update one of the current professional's job offers",
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: UpdateJobOfferRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Job offer updated',
      content: { 'application/json': { schema: JobOfferSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'delete',
  path: apiPath('/me/job-offers/{id}'),
  summary: "Delete one of the current professional's job offers",
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '204': { description: 'Job offer deleted' },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/job-offers/{id}/publish'),
  summary: 'Publish a job offer, creating a free listing',
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Job offer published',
      content: { 'application/json': { schema: JobOfferSchema } },
    },
    ...errorResponses([401, 403, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/job-offers/{id}/close'),
  summary: 'Close a published job offer',
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Job offer closed',
      content: { 'application/json': { schema: JobOfferSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/job-offers/{id}/applications'),
  summary: 'Apply to a published job offer',
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: CreateJobApplicationRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Application submitted',
      content: { 'application/json': { schema: JobApplicationSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422, 429]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/job-offers/{id}/applications'),
  summary: 'List the applications received for one of the current professional job offers',
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of applications',
      content: {
        'application/json': {
          schema: paginatedResponseSchema(JobApplicationWithPhotographerSchema),
        },
      },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/job-applications'),
  summary: "List the current photographer's job applications",
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of applications',
      content: {
        'application/json': { schema: paginatedResponseSchema(JobApplicationWithOfferSchema) },
      },
    },
    ...errorResponses([401, 403]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/job-applications/{id}/status'),
  summary: 'Move a job application forward or withdraw it',
  tags: ['job-board'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: UpdateJobApplicationStatusRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Application status updated',
      content: { 'application/json': { schema: JobApplicationSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});
