import {
  SUPPORTED_LOCALES,
  type LicenceUsage,
  type Locale,
  type PhotographerCategory,
} from '@photoo/shared';
import type { components } from '@photoo/api-client';

import { requireMoney } from '@/lib/money';

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

const EMPTY_LOCALIZED_TEXT: Record<Locale, string> = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, '']),
) as Record<Locale, string>;

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

export const EMPTY_PRODUCT_FORM_VALUES: ProductFormValues = {
  title: EMPTY_LOCALIZED_TEXT,
  description: EMPTY_LOCALIZED_TEXT,
  category: '',
  durationMinutes: '',
  basePrice: '',
  isActive: true,
  deliverables: [],
  tiers: [EMPTY_TIER],
};

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

export function defaultValuesFromProduct(product: Product | null): ProductFormValues {
  if (!product) {
    return EMPTY_PRODUCT_FORM_VALUES;
  }
  return {
    title: localizedTextToRecord(product.title),
    description: localizedTextToRecord(product.description),
    category: product.category,
    durationMinutes: String(product.durationMinutes),
    basePrice: String(requireMoney(product.basePrice, `product "${product.id}"`).amountCents / 100),
    isActive: product.isActive,
    deliverables: Object.entries(product.deliverables).map(([key, value]) => ({
      key,
      valueType: deliverableValueType(value),
      value: String(value),
    })),
    tiers: product.tiers.map((tier) => ({
      usage: tier.usage,
      price: String(
        requireMoney(tier.price, `product "${product.id}" tier "${tier.id}"`).amountCents / 100,
      ),
      description: tier.description,
      licenceTextVersion: tier.licenceTextVersion,
    })),
  };
}

// An empty or non-numeric amount becomes NaN so the shared zod schema
// rejects it with a normal field error, instead of silently sending a
// 0-cent price - same convention as web.requests.new's budget fields.
export function toAmountCents(value: string): number {
  if (value.trim() === '') {
    return Number.NaN;
  }
  const units = Number(value);
  return Number.isFinite(units) ? Math.round(units * 100) : Number.NaN;
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
// cast below is safe the same way `buildProfilePayload`'s required,
// already-checked `location` parameter is.
export function buildProductPayload(values: ProductFormValues, currency: string) {
  return {
    title: buildLocalizedText(values.title),
    description: Object.keys(buildLocalizedText(values.description)).length
      ? buildLocalizedText(values.description)
      : null,
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

function tierFieldPath(
  index: number,
  key: 'usage' | 'price' | 'description' | 'licenceTextVersion',
): ProductFieldPath {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- index is always a tier array position, not user content
  return `tiers.${index}.${key}`;
}

// `title`/`description`/`deliverables` issues surface through their own
// section hints, not a single named field, so they map to `null` on purpose
// - same convention as the profile and request forms' issue mappers.
export function mapProductIssuePath(path: readonly PropertyKey[]): ProductFieldPath | null {
  const [first, second, third] = path;
  if (first === 'category' || first === 'durationMinutes') {
    return first;
  }
  if (first === 'basePrice') {
    return 'basePrice';
  }
  if (first === 'tiers' && typeof second === 'number') {
    if (third === 'price') return tierFieldPath(second, 'price');
    if (third === 'usage') return tierFieldPath(second, 'usage');
    if (third === 'description') return tierFieldPath(second, 'description');
    if (third === 'licenceTextVersion') return tierFieldPath(second, 'licenceTextVersion');
  }
  return null;
}

interface ValidationErrorDetail {
  path?: string;
  message?: string;
}

function isValidationErrorDetail(value: unknown): value is ValidationErrorDetail {
  return typeof value === 'object' && value !== null;
}

// The API's 400/422 VALIDATION_ERROR-shaped errors carry
// `details: [{ path: "tiers.0.price.amountCents", ... }]`, a dot-joined
// string rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(details: unknown): (ProductFieldPath | null)[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.map((detail) => {
    if (!isValidationErrorDetail(detail) || typeof detail.path !== 'string') {
      return null;
    }
    const segments = detail.path.split('.').map((segment) => {
      const index = Number(segment);
      return Number.isInteger(index) && String(index) === segment ? index : segment;
    });
    return mapProductIssuePath(segments);
  });
}
