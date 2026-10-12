import { describe, expect, it } from '@jest/globals';

import {
  buildDeliverables,
  buildProductPayload,
  centsToAmountText,
  defaultValuesFromProduct,
  emptyProductFormValues,
  hasDuplicateDeliverableKeys,
  hasDuplicateTierUsage,
  mapProductIssuePath,
  mapValidationErrorDetailPath,
  toAmountCents,
  type ProductFormValues,
} from './product-form';

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
      price: { amountCents: 150050, currency: 'EUR' },
      description: 'Personal use only',
      licenceTextVersion: 'v1',
    },
  ],
};

describe('toAmountCents', () => {
  it('converts whole units and decimals into integer cents', () => {
    expect(toAmountCents('150')).toBe(15000);
    expect(toAmountCents('19.99')).toBe(1999);
    expect(toAmountCents('19.5')).toBe(1950);
    expect(toAmountCents('0.07')).toBe(7);
    expect(toAmountCents(' 12,50 ')).toBe(1250);
  });

  it('is exact where float multiplication is not', () => {
    expect(toAmountCents('1.15')).toBe(115);
    expect(toAmountCents('8.2')).toBe(820);
  });

  it('rejects more than two decimals instead of rounding', () => {
    expect(Number.isNaN(toAmountCents('19.999'))).toBe(true);
    expect(Number.isNaN(toAmountCents('1.005'))).toBe(true);
  });

  it('is NaN for an empty, negative or non-numeric value, never a silent 0', () => {
    for (const value of ['', '   ', 'abc', '-1', '1e3', '1.', '.5', '1.2.3']) {
      expect(Number.isNaN(toAmountCents(value))).toBe(true);
    }
  });
});

describe('centsToAmountText', () => {
  it('prints whole units without decimals and keeps two digits otherwise', () => {
    expect(centsToAmountText(150000)).toBe('1500');
    expect(centsToAmountText(1999)).toBe('19.99');
    expect(centsToAmountText(1950)).toBe('19.50');
    expect(centsToAmountText(7)).toBe('0.07');
  });

  it('round-trips through toAmountCents', () => {
    for (const cents of [0, 1, 99, 100, 101, 123456]) {
      expect(toAmountCents(centsToAmountText(cents))).toBe(cents);
    }
  });
});

describe('buildProductPayload', () => {
  it('converts the base price and every tier price into integer cents with the given currency', () => {
    const values: ProductFormValues = {
      ...emptyProductFormValues(),
      title: { ...emptyProductFormValues().title, en: ' Wedding day ' },
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

    expect(payload.title).toEqual({ en: 'Wedding day' });
    expect(payload.description).toBeNull();
    expect(payload.durationMinutes).toBe(480);
    expect(payload.basePrice).toEqual({ amountCents: 150000, currency: 'EUR' });
    expect(payload.tiers.map((tier) => tier.price)).toEqual([
      { amountCents: 150000, currency: 'EUR' },
      { amountCents: 300050, currency: 'EUR' },
    ]);
  });

  it('uses the given currency for every price', () => {
    const values: ProductFormValues = {
      ...emptyProductFormValues(),
      basePrice: '10',
      tiers: [{ usage: 'personal', price: '10', description: 'x', licenceTextVersion: 'v1' }],
    };

    const payload = buildProductPayload(values, 'USD');

    expect(payload.basePrice.currency).toBe('USD');
    expect(payload.tiers[0]?.price.currency).toBe('USD');
  });
});

describe('defaultValuesFromProduct', () => {
  it('turns integer cents back into amount text for editing', () => {
    const values = defaultValuesFromProduct(PRODUCT);

    expect(values.basePrice).toBe('1500');
    expect(values.tiers[0]?.price).toBe('1500.50');
  });

  it('reads deliverables back with their original type', () => {
    expect(defaultValuesFromProduct(PRODUCT).deliverables).toEqual(
      expect.arrayContaining([
        { key: 'photos', valueType: 'number', value: '200' },
        { key: 'editedPhotos', valueType: 'number', value: '80' },
        { key: 'onlineGallery', valueType: 'boolean', value: 'true' },
      ]),
    );
  });

  it('returns the empty defaults when there is no existing product', () => {
    expect(defaultValuesFromProduct(null)).toEqual(emptyProductFormValues());
  });

  it('does not share mutable state between empty forms', () => {
    const [tier] = emptyProductFormValues().tiers;
    if (tier) {
      tier.price = '5';
    }
    expect(emptyProductFormValues().tiers[0]?.price).toBe('');
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

describe('duplicate checks', () => {
  it('flags duplicate deliverable labels', () => {
    expect(
      hasDuplicateDeliverableKeys([
        { key: 'photos', valueType: 'number', value: '1' },
        { key: ' photos', valueType: 'number', value: '2' },
      ]),
    ).toBe(true);
    expect(hasDuplicateDeliverableKeys([{ key: 'photos', valueType: 'number', value: '1' }])).toBe(
      false,
    );
  });

  it('flags duplicate tier usage values and ignores unchosen ones', () => {
    const tier = (usage: 'personal' | 'commercial' | '') => ({
      usage,
      price: '1',
      description: 'a',
      licenceTextVersion: 'v1',
    });
    expect(hasDuplicateTierUsage([tier('personal'), tier('personal')])).toBe(true);
    expect(hasDuplicateTierUsage([tier('personal'), tier('commercial')])).toBe(false);
    expect(hasDuplicateTierUsage([tier(''), tier('')])).toBe(false);
  });
});

describe('mapProductIssuePath / mapValidationErrorDetailPath', () => {
  it('maps a tier price issue back to its indexed form field', () => {
    expect(mapProductIssuePath(['tiers', 0, 'price', 'amountCents'])).toBe('tiers.0.price');
    expect(mapProductIssuePath(['tiers', 1, 'usage'])).toBe('tiers.1.usage');
    expect(mapProductIssuePath(['basePrice', 'amountCents'])).toBe('basePrice');
  });

  it('maps title, description and deliverables issues to null', () => {
    expect(mapProductIssuePath(['title'])).toBeNull();
    expect(mapProductIssuePath(['description', 'en'])).toBeNull();
    expect(mapProductIssuePath(['deliverables'])).toBeNull();
    expect(mapProductIssuePath(['tiers'])).toBeNull();
  });

  it('parses the API dot-joined detail path the same way', () => {
    expect(
      mapValidationErrorDetailPath([
        { path: 'tiers.0.price.amountCents', message: 'bad' },
        { path: 'basePrice.amountCents', message: 'bad' },
        { path: 'title', message: 'bad' },
        'nope',
        { message: 'no path' },
      ]),
    ).toEqual(['tiers.0.price', 'basePrice', null, null, null]);
  });

  it('returns an empty array for non-array details', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
  });
});
