import {
  SUPPORTED_LOCALES,
  type LicenceUsage,
  type Locale,
  type PhotographerCategory,
} from '@photoo/shared';
import type { components } from '@photoo/api-client';

import { requireMoney } from './money';

type Product = components['schemas']['Product'];

export type DeliverableValueType = 'text' | 'number' | 'boolean';

export interface DeliverableRow {
  key: string;
  valueType: DeliverableValueType;
  value: string;
}

export interface TierFormValue {
  usage: LicenceUsage | '';
  price: string;
  description: string;
  licenceTextVersion: string;
}

export interface ProductFormValues {
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  category: PhotographerCategory | '';
  durationMinutes: string;
  basePrice: string;
  isActive: boolean;
  deliverables: DeliverableRow[];
  tiers: TierFormValue[];
}

function emptyLocalizedText(): Record<Locale, string> {
  return Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, ''])) as Record<
    Locale,
    string
  >;
}

export const EMPTY_TIER: TierFormValue = {
  usage: '',
  price: '',
  description: '',
  licenceTextVersion: 'v1',
};

export const EMPTY_DELIVERABLE: DeliverableRow = {
  key: '',
  valueType: 'text',
  value: '',
};

export function emptyProductFormValues(): ProductFormValues {
  return {
    title: emptyLocalizedText(),
    description: emptyLocalizedText(),
    category: '',
    durationMinutes: '',
    basePrice: '',
    isActive: true,
    deliverables: [],
    tiers: [{ ...EMPTY_TIER }],
  };
}

function localizedTextToRecord(
  value: Partial<Record<Locale, string>> | null,
): Record<Locale, string> {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, value?.[locale] ?? '']),
  ) as Record<Locale, string>;
}

function deliverableValueType(value: string | number | boolean): DeliverableValueType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

export function centsToAmountText(amountCents: number): string {
  const units = Math.trunc(amountCents / 100);
  const fraction = amountCents % 100;
  return fraction === 0 ? String(units) : `${String(units)}.${String(fraction).padStart(2, '0')}`;
}

export function defaultValuesFromProduct(product: Product | null): ProductFormValues {
  if (!product) {
    return emptyProductFormValues();
  }
  return {
    title: localizedTextToRecord(product.title),
    description: localizedTextToRecord(product.description),
    category: product.category,
    durationMinutes: String(product.durationMinutes),
    basePrice: centsToAmountText(
      requireMoney(product.basePrice, `product "${product.id}"`).amountCents,
    ),
    isActive: product.isActive,
    deliverables: Object.entries(product.deliverables).map(([key, value]) => ({
      key,
      valueType: deliverableValueType(value),
      value: String(value),
    })),
    tiers: product.tiers.map((tier) => ({
      usage: tier.usage,
      price: centsToAmountText(
        requireMoney(tier.price, `product "${product.id}" tier "${tier.id}"`).amountCents,
      ),
      description: tier.description,
      licenceTextVersion: tier.licenceTextVersion,
    })),
  };
}

const AMOUNT_TEXT = /^(\d+)(?:[.,](\d{1,2}))?$/;

// Parsed from the digits, never through a float, and anything but a plain
// amount with at most two decimals (empty included) becomes NaN so the
// form reports it instead of rounding or sending a silent 0-cent price.
export function toAmountCents(value: string): number {
  const match = AMOUNT_TEXT.exec(value.trim());
  if (!match) {
    return Number.NaN;
  }
  const [, units = '', fraction = ''] = match;
  return Number(units) * 100 + Number(fraction.padEnd(2, '0'));
}

function buildLocalizedText(values: Record<Locale, string>): Partial<Record<Locale, string>> {
  const result: Partial<Record<Locale, string>> = {};
  for (const locale of SUPPORTED_LOCALES) {
    const trimmed = values[locale].trim();
    if (trimmed) {
      result[locale] = trimmed;
    }
  }
  return result;
}

function deliverableValue(row: DeliverableRow): string | number | boolean {
  if (row.valueType === 'number') {
    return Number(row.value);
  }
  if (row.valueType === 'boolean') {
    return row.value === 'true';
  }
  return row.value;
}

export function buildDeliverables(
  rows: readonly DeliverableRow[],
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key) {
      result[key] = deliverableValue(row);
    }
  }
  return result;
}

export function hasDuplicateDeliverableKeys(rows: readonly DeliverableRow[]): boolean {
  const keys = rows.map((row) => row.key.trim()).filter((key) => key !== '');
  return new Set(keys).size !== keys.length;
}

export function hasDuplicateTierUsage(tiers: readonly TierFormValue[]): boolean {
  const usages = tiers.map((tier) => tier.usage).filter((usage) => usage !== '');
  return new Set(usages).size !== usages.length;
}

// An empty `category`/`usage` selection is rejected by the shared schema's
// `safeParse` right after this call (its enum has no `''` member), so the
// casts below are safe.
export function buildProductPayload(values: ProductFormValues, currency: string) {
  const description = buildLocalizedText(values.description);
  return {
    title: buildLocalizedText(values.title),
    description: Object.keys(description).length ? description : null,
    category: values.category as PhotographerCategory,
    durationMinutes: Number(values.durationMinutes),
    deliverables: buildDeliverables(values.deliverables),
    basePrice: { amountCents: toAmountCents(values.basePrice), currency },
    isActive: values.isActive,
    tiers: values.tiers.map((tier) => ({
      usage: tier.usage as LicenceUsage,
      price: { amountCents: toAmountCents(tier.price), currency },
      description: tier.description,
      licenceTextVersion: tier.licenceTextVersion,
    })),
  };
}

export type ProductFieldPath =
  | 'category'
  | 'durationMinutes'
  | 'basePrice'
  | `tiers.${number}.usage`
  | `tiers.${number}.price`
  | `tiers.${number}.description`
  | `tiers.${number}.licenceTextVersion`;

const TIER_KEYS = ['usage', 'price', 'description', 'licenceTextVersion'] as const;

export function tierFieldPath(index: number, key: (typeof TIER_KEYS)[number]): ProductFieldPath {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- index is always a tier array position, not user content
  return `tiers.${index}.${key}`;
}

// `title`/`description`/`deliverables` issues surface through their own
// section hints, not a single named field, so they map to `null` on purpose.
export function mapProductIssuePath(path: readonly PropertyKey[]): ProductFieldPath | null {
  const [first, second, third] = path;
  if (first === 'category' || first === 'durationMinutes' || first === 'basePrice') {
    return first;
  }
  if (first === 'tiers' && typeof second === 'number') {
    const key = TIER_KEYS.find((candidate) => candidate === third);
    return key ? tierFieldPath(second, key) : null;
  }
  return null;
}

// The API's 400/422 validation errors carry
// `details: [{ path: "tiers.0.price.amountCents", ... }]`, a dot-joined
// string rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(details: unknown): (ProductFieldPath | null)[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.map((detail: unknown) => {
    if (typeof detail !== 'object' || detail === null || !('path' in detail)) {
      return null;
    }
    const { path } = detail;
    if (typeof path !== 'string') {
      return null;
    }
    const segments = path.split('.').map((segment) => {
      const index = Number(segment);
      return Number.isInteger(index) && String(index) === segment ? index : segment;
    });
    return mapProductIssuePath(segments);
  });
}
