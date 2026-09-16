import { LICENCE_USAGES } from '../enums.js';
import { IdSchema, MoneySchema, SlugSchema, errorResponses } from './common.js';
import { LocalizedTextSchema, PhotographerCategorySchema } from './profiles.js';
import { AUTH_SECURITY, apiPath, registry } from './registry.js';
import { z } from './zod.js';

export const LicenceUsageSchema = z.enum(LICENCE_USAGES).openapi({ example: 'personal' });

export const ProductTierSchema = z
  .object({
    id: IdSchema,
    usage: LicenceUsageSchema,
    price: MoneySchema,
    description: z.string().min(1).max(500),
    licenceTextVersion: z.string().min(1).max(20).openapi({ example: 'v1' }),
  })
  .strict()
  .openapi('ProductTier');

export const CreateProductTierRequestSchema = ProductTierSchema.omit({ id: true }).strict();

export const ProductSchema = z
  .object({
    id: IdSchema,
    profileId: IdSchema,
    title: LocalizedTextSchema,
    description: z.string().min(1).max(2000),
    category: PhotographerCategorySchema,
    durationMinutes: z.int().positive(),
    deliverables: z.array(z.string().min(1).max(200)),
    basePrice: MoneySchema,
    isActive: z.boolean(),
    order: z.int().nonnegative(),
    tiers: z.array(ProductTierSchema).min(1),
  })
  .strict()
  .openapi('Product');

export const CreateProductRequestSchema = ProductSchema.omit({
  id: true,
  profileId: true,
  tiers: true,
})
  .extend({
    tiers: z.array(CreateProductTierRequestSchema).min(1),
  })
  .strict()
  .partial({ isActive: true, order: true });

export const UpdateProductRequestSchema = CreateProductRequestSchema.partial();

registry.registerPath({
  method: 'get',
  path: apiPath('/photographers/{slug}/products'),
  summary: 'List the active products for a published photographer profile',
  tags: ['products'],
  request: {
    params: z.object({ slug: SlugSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The published products',
      content: { 'application/json': { schema: z.array(ProductSchema) } },
    },
    ...errorResponses([404]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/products'),
  summary: "List the current user's products",
  tags: ['products'],
  security: AUTH_SECURITY,
  responses: {
    '200': {
      description: 'All of the current user products',
      content: { 'application/json': { schema: z.array(ProductSchema) } },
    },
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/me/products'),
  summary: 'Create a product',
  tags: ['products'],
  security: AUTH_SECURITY,
  request: {
    body: { content: { 'application/json': { schema: CreateProductRequestSchema } } },
  },
  responses: {
    '201': {
      description: 'Product created',
      content: { 'application/json': { schema: ProductSchema } },
    },
    ...errorResponses([400, 401, 404, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/me/products/{productId}'),
  summary: 'Get one of the current user products',
  tags: ['products'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ productId: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The product',
      content: { 'application/json': { schema: ProductSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'patch',
  path: apiPath('/me/products/{productId}'),
  summary: 'Update one of the current user products',
  tags: ['products'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ productId: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: UpdateProductRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Product updated',
      content: { 'application/json': { schema: ProductSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 422]),
  },
});

registry.registerPath({
  method: 'delete',
  path: apiPath('/me/products/{productId}'),
  summary: 'Delete one of the current user products',
  tags: ['products'],
  security: AUTH_SECURITY,
  request: {
    params: z.object({ productId: IdSchema }).strict(),
  },
  responses: {
    '204': { description: 'Product deleted' },
    ...errorResponses([401, 403, 404]),
  },
});
