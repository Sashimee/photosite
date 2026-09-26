import {
  PHOTOGRAPHER_CATEGORIES,
  PORTFOLIO_IMAGE_STATUSES,
  VERIFICATION_STATUSES,
} from '../enums.js';
import { SUPPORTED_LOCALES } from '../locale.js';
import {
  CountryCodeSchema,
  CursorPaginationQuerySchema,
  HttpUrlSchema,
  IdSchema,
  LanguageCodeSchema,
  LatLngSchema,
  MoneySchema,
  SlugSchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { PortfolioImageProvenanceSchema } from './provenance.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const PhotographerCategorySchema = z
  .enum(PHOTOGRAPHER_CATEGORIES)
  .openapi({ example: 'wedding' });

export const LocalizedTextSchema = z
  .partialRecord(z.enum(SUPPORTED_LOCALES), z.string().min(1))
  .openapi({
    description: 'Text keyed by supported locale, only translated locales present',
    example: { en: 'Wedding and portrait photographer in Luxembourg' },
  });

export const ProfileLinksSchema = z
  .object({
    instagram: HttpUrlSchema.nullable().optional(),
    website: HttpUrlSchema.nullable().optional(),
    behance: HttpUrlSchema.nullable().optional(),
    other: z
      .array(
        z
          .object({
            label: z.string().min(1).max(60),
            url: HttpUrlSchema,
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
  .openapi('ProfileLinks');

// `url`/`width`/`height` are nullable on the owner-facing schema: a
// freshly attached image is `processing` until the worker's image-process
// job finishes, and `Upload.variants`/width/height are only set then. The
// public schema only ever shows `approved` images, which are always
// processed, so it keeps these fields required.
export const PortfolioImageSchema = z
  .object({
    id: IdSchema,
    url: z.url().nullable().openapi({ example: 'https://cdn.photoo.lu/portfolio/abc123.jpg' }),
    width: z.int().positive().nullable(),
    height: z.int().positive().nullable(),
    order: z.int().nonnegative(),
    status: z.enum(PORTFOLIO_IMAGE_STATUSES),
    provenance: PortfolioImageProvenanceSchema.nullable(),
  })
  .strict()
  .openapi('PortfolioImage');

export const PublicPortfolioImageSchema = PortfolioImageSchema.omit({
  status: true,
  provenance: true,
})
  .extend({
    url: z.url(),
    width: z.int().positive(),
    height: z.int().positive(),
  })
  .strict()
  .openapi('PublicPortfolioImage');

const PhotographerProfileBaseSchema = z.object({
  id: IdSchema,
  slug: SlugSchema,
  displayName: z.string().min(1).max(120).openapi({ example: 'Jane Doe Photography' }),
  headline: z.string().min(1).max(200).nullable(),
  bio: LocalizedTextSchema,
  avatarUrl: z.url().nullable(),
  coverUrl: z.url().nullable(),
  links: ProfileLinksSchema,
  categories: z.array(PhotographerCategorySchema),
  languages: z.array(LanguageCodeSchema),
  location: LatLngSchema,
  serviceRadiusKm: z.number().positive().nullable(),
  city: z.string().min(1).max(120),
  countryCode: CountryCodeSchema,
  ratingAvg: z.number().min(0).max(5),
  ratingCount: z.int().nonnegative(),
});

export const PublicPhotographerProfileSchema = PhotographerProfileBaseSchema.omit({
  location: true,
})
  .extend({
    portfolio: z.array(PublicPortfolioImageSchema),
  })
  .strict()
  .openapi('PublicPhotographerProfile');

export const PhotographerSummarySchema = PhotographerProfileBaseSchema.pick({
  id: true,
  slug: true,
  displayName: true,
  headline: true,
  avatarUrl: true,
  categories: true,
  languages: true,
  city: true,
  countryCode: true,
  ratingAvg: true,
  ratingCount: true,
})
  .extend({
    startingPrice: MoneySchema.nullable(),
  })
  .strict()
  .openapi('PhotographerSummary');

export const OwnPhotographerProfileSchema = PhotographerProfileBaseSchema.extend({
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  isPublished: z.boolean(),
  stripeOnboardingComplete: z.boolean(),
  stripePayoutsEnabled: z.boolean(),
})
  .strict()
  .openapi('OwnPhotographerProfile');

export const CreatePhotographerProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    categories: z.array(PhotographerCategorySchema).min(1),
    languages: z.array(LanguageCodeSchema).min(1),
    location: LatLngSchema,
    city: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    headline: z.string().min(1).max(200).nullable().optional(),
    bio: LocalizedTextSchema.optional(),
    links: ProfileLinksSchema.optional(),
    serviceRadiusKm: z.number().positive().nullable().optional(),
  })
  .strict();

export const UpdatePhotographerProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).max(120),
    headline: z.string().min(1).max(200).nullable(),
    bio: LocalizedTextSchema,
    links: ProfileLinksSchema,
    categories: z.array(PhotographerCategorySchema).min(1),
    languages: z.array(LanguageCodeSchema).min(1),
    location: LatLngSchema,
    serviceRadiusKm: z.number().positive().nullable(),
    city: z.string().min(1).max(120),
    countryCode: CountryCodeSchema,
    avatarUploadId: IdSchema.nullable(),
    coverUploadId: IdSchema.nullable(),
  })
  .strict()
  .partial();

export const AttachPortfolioImageRequestSchema = z
  .object({
    uploadId: IdSchema,
  })
  .strict();

export const PhotographerSearchQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().int().min(1).max(200).optional(),
    city: z.string().min(1).max(120).optional(),
    countryCode: CountryCodeSchema.optional(),
    category: PhotographerCategorySchema.optional(),
    language: LanguageCodeSchema.optional(),
    priceMinCents: z.coerce.number().int().nonnegative().optional(),
    priceMaxCents: z.coerce.number().int().nonnegative().optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine((query) => (query.lat === undefined) === (query.lng === undefined), {
    message: 'lat and lng must be provided together',
    path: ['lng'],
  })
  .refine(
    (query) =>
      query.priceMinCents === undefined ||
      query.priceMaxCents === undefined ||
      query.priceMinCents <= query.priceMaxCents,
    {
      message: 'priceMinCents must be less than or equal to priceMaxCents',
      path: ['priceMaxCents'],
    },
  );

export const ReorderPortfolioRequestSchema = z
  .object({
    imageIds: z.array(IdSchema).min(1),
  })
  .strict();

registry.registerPath({
  method: 'get',
  path: apiPath('/photographers'),
  summary: 'Search published photographer profiles',
  tags: ['profiles'],
  request: {
    query: PhotographerSearchQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of matching photographer profiles',
      content: {
        'application/json': { schema: paginatedResponseSchema(PhotographerSummarySchema) },
      },
    },
    ...errorResponses([400, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/photographers/{slug}'),
  summary: 'Get a published photographer profile by slug',
  tags: ['profiles'],
  request: {
    params: z.object({ slug: SlugSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The photographer profile',
      content: { 'application/json': { schema: PublicPhotographerProfileSchema } },
    },
    ...errorResponses([404]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/photographer-profile'),
  summary: "Get the current user's photographer profile",
  tags: ['profiles'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: "The current user's photographer profile",
      content: { 'application/json': { schema: OwnPhotographerProfileSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/photographer-profile'),
  summary: 'Create the photographer profile for the current user',
  tags: ['profiles'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreatePhotographerProfileRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Photographer profile created',
      content: { 'application/json': { schema: OwnPhotographerProfileSchema } },
    },
    ...errorResponses([400, 401, 403, 409, 422]),
  },
});

registry.registerPath({
  method: 'patch',
  path: apiPath('/me/photographer-profile'),
  summary: "Update the current user's photographer profile",
  tags: ['profiles'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: UpdatePhotographerProfileRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Profile updated',
      content: { 'application/json': { schema: OwnPhotographerProfileSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/photographer-profile/portfolio'),
  summary: "List the current user's portfolio images, in all statuses",
  tags: ['profiles'],
  security: AUTH_SECURITY,
  request: {
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of portfolio images',
      content: {
        'application/json': { schema: paginatedResponseSchema(PortfolioImageSchema) },
      },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/photographer-profile/portfolio'),
  summary: "Attach an uploaded image to the current user's portfolio",
  tags: ['profiles'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: AttachPortfolioImageRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Portfolio image attached',
      content: { 'application/json': { schema: PortfolioImageSchema } },
    },
    ...errorResponses([401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'patch',
  path: apiPath('/me/photographer-profile/portfolio/order'),
  summary: 'Reorder the current user portfolio images',
  tags: ['profiles'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: ReorderPortfolioRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Portfolio reordered',
      content: {
        'application/json': { schema: paginatedResponseSchema(PortfolioImageSchema) },
      },
    },
    ...errorResponses([400, 401, 403, 404, 422]),
  },
});

registry.registerPath({
  method: 'delete',
  path: apiPath('/me/photographer-profile/portfolio/{imageId}'),
  summary: 'Delete a portfolio image',
  tags: ['profiles'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ imageId: IdSchema }).strict(),
  },
  responses: {
    '204': { description: 'Portfolio image deleted' },
    ...errorResponses([401, 403, 404]),
  },
});
