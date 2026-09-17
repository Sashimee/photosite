import { describe, expect, it } from 'vitest';
import {
  CreateProductRequestSchema,
  ProductSchema,
  ProductTierSchema,
  UpdateProductRequestSchema,
} from './products.js';

const validTier = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  usage: 'personal',
  price: { amountCents: 15000, currency: 'EUR' },
  description: 'For personal, non-commercial use',
  licenceTextVersion: 'v1',
};

const validProduct = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  profileId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  title: { en: 'Wedding package' },
  description: { en: 'Full day wedding coverage' },
  category: 'wedding',
  durationMinutes: 480,
  deliverables: { photos: 200, editedPhotos: 80, turnaroundDays: 14, onlineGallery: true },
  basePrice: { amountCents: 150000, currency: 'EUR' },
  isActive: true,
  order: 0,
  tiers: [validTier],
};

describe('ProductTierSchema', () => {
  it('accepts a well-formed tier', () => {
    expect(ProductTierSchema.safeParse(validTier).success).toBe(true);
  });

  it('rejects an unknown usage value', () => {
    expect(ProductTierSchema.safeParse({ ...validTier, usage: 'unlimited' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(ProductTierSchema.safeParse({ ...validTier, priceCents: 100 }).success).toBe(false);
  });
});

describe('ProductSchema', () => {
  it('accepts a well-formed product with tiers', () => {
    expect(ProductSchema.safeParse(validProduct).success).toBe(true);
  });

  it('rejects a product with no tiers', () => {
    expect(ProductSchema.safeParse({ ...validProduct, tiers: [] }).success).toBe(false);
  });

  it('rejects a non-positive durationMinutes', () => {
    expect(ProductSchema.safeParse({ ...validProduct, durationMinutes: 0 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(ProductSchema.safeParse({ ...validProduct, stripeAccountId: 'acct_123' }).success).toBe(
      false,
    );
  });

  it('accepts a null description', () => {
    expect(ProductSchema.safeParse({ ...validProduct, description: null }).success).toBe(true);
  });

  it('rejects an unsupported locale key in description', () => {
    expect(ProductSchema.safeParse({ ...validProduct, description: { it: 'Ciao' } }).success).toBe(
      false,
    );
  });

  it('rejects a deliverables array (must be a structured record)', () => {
    expect(
      ProductSchema.safeParse({ ...validProduct, deliverables: ['200 edited photos'] }).success,
    ).toBe(false);
  });

  it('rejects a deliverables value that is not a string, number or boolean', () => {
    expect(
      ProductSchema.safeParse({
        ...validProduct,
        deliverables: { photos: { nested: true } },
      }).success,
    ).toBe(false);
  });
});

describe('CreateProductRequestSchema', () => {
  const validCreate = {
    title: validProduct.title,
    description: validProduct.description,
    category: validProduct.category,
    durationMinutes: validProduct.durationMinutes,
    deliverables: validProduct.deliverables,
    basePrice: validProduct.basePrice,
    tiers: [
      {
        usage: 'personal',
        price: validTier.price,
        description: validTier.description,
        licenceTextVersion: 'v1',
      },
    ],
  };

  it('accepts a well-formed create request without an id, profileId or tier ids', () => {
    expect(CreateProductRequestSchema.safeParse(validCreate).success).toBe(true);
  });

  it('rejects a request carrying an id', () => {
    expect(
      CreateProductRequestSchema.safeParse({ ...validCreate, id: validProduct.id }).success,
    ).toBe(false);
  });

  it('rejects a request carrying a tier id', () => {
    expect(
      CreateProductRequestSchema.safeParse({
        ...validCreate,
        tiers: [{ ...validCreate.tiers[0], id: validTier.id }],
      }).success,
    ).toBe(false);
  });

  it('rejects a request with no tiers', () => {
    expect(CreateProductRequestSchema.safeParse({ ...validCreate, tiers: [] }).success).toBe(false);
  });

  it('accepts a request without a description', () => {
    const withoutDescription = Object.fromEntries(
      Object.entries(validCreate).filter(([key]) => key !== 'description'),
    );
    expect(CreateProductRequestSchema.safeParse(withoutDescription).success).toBe(true);
  });
});

describe('UpdateProductRequestSchema', () => {
  it('accepts a partial update', () => {
    expect(UpdateProductRequestSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(UpdateProductRequestSchema.safeParse({ basePriceCents: 1000 }).success).toBe(false);
  });
});
