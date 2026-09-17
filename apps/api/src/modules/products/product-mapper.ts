import type { Product, ProductTier } from '@photoo/db';
import { ProductSchema, ProductTierSchema } from '@photoo/shared';
import type { z } from 'zod';
import { toWireCategory } from '../../common/enums/photographer-category.js';

type ProductWithTiers = Product & { tiers: ProductTier[] };

function mapProductTier(tier: ProductTier): z.infer<typeof ProductTierSchema> {
  return ProductTierSchema.parse({
    id: tier.id,
    usage: tier.usage,
    price: { amountCents: tier.priceCents, currency: tier.currency },
    description: tier.description,
    licenceTextVersion: tier.licenceTextVersion,
  });
}

export function mapProduct(product: ProductWithTiers): z.infer<typeof ProductSchema> {
  return ProductSchema.parse({
    id: product.id,
    profileId: product.profileId,
    title: product.title,
    description: product.description,
    category: toWireCategory(product.category),
    durationMinutes: product.durationMinutes,
    deliverables: product.deliverables,
    basePrice: { amountCents: product.basePriceCents, currency: product.currency },
    isActive: product.isActive,
    order: product.order,
    tiers: product.tiers.map(mapProductTier),
  });
}
