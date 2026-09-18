import { describe, expect, it } from 'vitest';

import {
  buildDeliverables,
  buildProductPayload,
  defaultValuesFromProduct,
  EMPTY_PRODUCT_FORM_VALUES,
  hasDuplicateDeliverableKeys,
  hasDuplicateTierUsage,
  mapProductIssuePath,
  mapValidationErrorDetailPath,
  toAmountCents,
  type ProductFormValues,
} from './product-form-helpers';

const PRODUCT = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  profileId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  title: { en: 'Wedding day' },
  description: { en: 'Full day coverage' },
  category: 'wedding' as const,
  durationMinutes: 480,
  deliverables: { photos: 200, editedPhotos: 80, onlineGallery: true },
  basePrice: { amountCents: 150000, currency: 'EUR' },
  isActive: true,
  order: 1,
  tiers: [
    {
      id: 'tier-1',
      usage: 'personal' as const,
      price: { amountCents: 150000, currency: 'EUR' },
      description: 'Personal use only',
      licenceTextVersion: 'v1',
    },
  ],
};

describe('toAmountCents', () => {
  it('converts whole currency units into integer cents', () => {
    expect(toAmountCents('150')).toBe(15000);
    expect(toAmountCents('19.99')).toBe(1999);
  });

  it('rounds fractional cents rather than truncating', () => {
    expect(toAmountCents('19.999')).toBe(2000);
  });

  it('is NaN for an empty or non-numeric value, never a silent 0', () => {
    expect(Number.isNaN(toAmountCents(''))).toBe(true);
    expect(Number.isNaN(toAmountCents('   '))).toBe(true);
    expect(Number.isNaN(toAmountCents('abc'))).toBe(true);
  });
});

describe('buildProductPayload', () => {
  it('converts the base price and every tier price into integer cents with the given currency', () => {
    const values: ProductFormValues = {
      ...EMPTY_PRODUCT_FORM_VALUES,
      title: { ...EMPTY_PRODUCT_FORM_VALUES.title, en: 'Wedding day' },
      category: 'wedding',
      durationMinutes: '480',
      basePrice: '1500',
      tiers: [
        { usage: 'personal', price: '1500', description: 'Personal use', licenceTextVersion: 'v1' },
        {
          usage: 'commercial',
          price: '3000.5',
          description: 'Commercial use',
          licenceTextVersion: 'v1',
        },
      ],
    };

    const payload = buildProductPayload(values, 'EUR');
    const [tier0, tier1] = payload.tiers;

    expect(payload.basePrice).toEqual({ amountCents: 150000, currency: 'EUR' });
    expect(tier0?.price).toEqual({ amountCents: 150000, currency: 'EUR' });
    expect(tier1?.price).toEqual({ amountCents: 300050, currency: 'EUR' });
  });

  it('never lets the client pick a currency other than the one it is given', () => {
    const values: ProductFormValues = {
      ...EMPTY_PRODUCT_FORM_VALUES,
      basePrice: '10',
      tiers: [{ usage: 'personal', price: '10', description: 'x', licenceTextVersion: 'v1' }],
    };

    const payload = buildProductPayload(values, 'USD');
    const [tier0] = payload.tiers;

    expect(payload.basePrice.currency).toBe('USD');
    expect(tier0?.price.currency).toBe('USD');
  });
});

describe('defaultValuesFromProduct', () => {
  it('turns integer cents back into whole units for editing', () => {
    const values = defaultValuesFromProduct(PRODUCT);
    const [tier0] = values.tiers;

    expect(values.basePrice).toBe('1500');
    expect(tier0?.price).toBe('1500');
  });

  it('reads deliverables back with their original type', () => {
    const values = defaultValuesFromProduct(PRODUCT);

    expect(values.deliverables).toEqual(
      expect.arrayContaining([
        { key: 'photos', valueType: 'number', value: '200' },
        { key: 'editedPhotos', valueType: 'number', value: '80' },
        { key: 'onlineGallery', valueType: 'boolean', value: 'true' },
      ]),
    );
  });

  it('returns the empty defaults when there is no existing product', () => {
    expect(defaultValuesFromProduct(null)).toEqual(EMPTY_PRODUCT_FORM_VALUES);
  });
});

describe('buildDeliverables', () => {
  it('builds a typed record, skipping rows with a blank key', () => {
    expect(
      buildDeliverables([
        { key: 'photos', valueType: 'number', value: '200' },
        { key: 'onlineGallery', valueType: 'boolean', value: 'true' },
        { key: '  ', valueType: 'text', value: 'ignored' },
        { key: 'turnaround', valueType: 'text', value: '2 weeks' },
      ]),
    ).toEqual({ photos: 200, onlineGallery: true, turnaround: '2 weeks' });
  });
});

describe('hasDuplicateDeliverableKeys / hasDuplicateTierUsage', () => {
  it('flags duplicate deliverable labels', () => {
    expect(
      hasDuplicateDeliverableKeys([
        { key: 'photos', valueType: 'number', value: '1' },
        { key: 'photos', valueType: 'number', value: '2' },
      ]),
    ).toBe(true);
    expect(hasDuplicateDeliverableKeys([{ key: 'photos', valueType: 'number', value: '1' }])).toBe(
      false,
    );
  });

  it('flags duplicate tier usage values', () => {
    expect(
      hasDuplicateTierUsage([
        { usage: 'personal', price: '1', description: 'a', licenceTextVersion: 'v1' },
        { usage: 'personal', price: '2', description: 'b', licenceTextVersion: 'v1' },
      ]),
    ).toBe(true);
    expect(
      hasDuplicateTierUsage([
        { usage: 'personal', price: '1', description: 'a', licenceTextVersion: 'v1' },
        { usage: 'commercial', price: '2', description: 'b', licenceTextVersion: 'v1' },
      ]),
    ).toBe(false);
  });
});

describe('mapProductIssuePath / mapValidationErrorDetailPath', () => {
  it('maps a tier price issue back to its indexed form field', () => {
    expect(mapProductIssuePath(['tiers', 0, 'price', 'amountCents'])).toBe('tiers.0.price');
    expect(mapProductIssuePath(['tiers', 1, 'usage'])).toBe('tiers.1.usage');
  });

  it('maps title/description/deliverables issues to null, same as bio/location elsewhere', () => {
    expect(mapProductIssuePath(['title'])).toBeNull();
    expect(mapProductIssuePath(['description', 'en'])).toBeNull();
    expect(mapProductIssuePath(['deliverables'])).toBeNull();
  });

  it('parses the API dot-joined detail path the same way', () => {
    expect(
      mapValidationErrorDetailPath([
        { path: 'tiers.0.price.amountCents', message: 'bad' },
        { path: 'basePrice.amountCents', message: 'bad' },
        { path: 'title', message: 'bad' },
      ]),
    ).toEqual(['tiers.0.price', 'basePrice', null]);
  });

  it('returns an empty array for non-array details', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
  });
});
