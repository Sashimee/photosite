import type { LicenceUsage, PhotographerCategory } from '@photoo/shared';

import type { PickedLocation } from './location-picker';

export interface RequestFormValues {
  title: string;
  category: PhotographerCategory | '';
  description: string;
  eventDate: string;
  dateFlexible: boolean;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressPostalCode: string;
  addressCountryCode: string;
  budgetMin: string;
  budgetMax: string;
  usage: LicenceUsage | '';
}

export const EMPTY_REQUEST_FORM_VALUES: RequestFormValues = {
  title: '',
  category: '',
  description: '',
  eventDate: '',
  dateFlexible: false,
  addressLine1: '',
  addressLine2: '',
  addressCity: '',
  addressPostalCode: '',
  addressCountryCode: '',
  budgetMin: '',
  budgetMax: '',
  usage: '',
};

// An unparsable or empty `datetime-local` value becomes NaN so
// `IsoDateTimeSchema` rejects it with a normal field error, instead of
// `.toISOString()` throwing a RangeError.
function toIsoOrEmpty(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

// An empty or non-numeric budget becomes NaN so `z.int()` rejects it with a
// normal field error instead of silently sending a 0-cent budget.
function toAmountCents(value: string): number {
  if (value.trim() === '') {
    return Number.NaN;
  }
  const units = Number(value);
  return Number.isFinite(units) ? Math.round(units * 100) : Number.NaN;
}

export function buildCreateRequestPayload(
  values: RequestFormValues,
  location: PickedLocation | null,
  currency: string | null,
) {
  return {
    title: values.title,
    category: values.category,
    description: values.description,
    eventDate: toIsoOrEmpty(values.eventDate),
    dateFlexible: values.dateFlexible,
    location: location ?? undefined,
    address: {
      line1: values.addressLine1,
      ...(values.addressLine2.trim() ? { line2: values.addressLine2 } : {}),
      city: values.addressCity,
      postalCode: values.addressPostalCode,
      countryCode: values.addressCountryCode,
    },
    budgetMin: { amountCents: toAmountCents(values.budgetMin), currency: currency ?? '' },
    budgetMax: { amountCents: toAmountCents(values.budgetMax), currency: currency ?? '' },
    usage: values.usage,
  };
}

const ADDRESS_FIELD_NAMES: Record<string, keyof RequestFormValues> = {
  line1: 'addressLine1',
  line2: 'addressLine2',
  city: 'addressCity',
  postalCode: 'addressPostalCode',
  countryCode: 'addressCountryCode',
};

// `location` failures are surfaced through the picker's own required-field
// message, not a form field, so they map to `null` here on purpose.
export function mapCreateRequestIssuePath(
  path: readonly PropertyKey[],
): keyof RequestFormValues | null {
  const [first, second] = path;
  if (first === 'address' && typeof second === 'string') {
    return ADDRESS_FIELD_NAMES[second] ?? null;
  }
  if (first === 'location') {
    return null;
  }
  return typeof first === 'string' && first in EMPTY_REQUEST_FORM_VALUES
    ? (first as keyof RequestFormValues)
    : null;
}

interface ValidationErrorDetail {
  path?: string;
  message?: string;
}

function isValidationErrorDetail(value: unknown): value is ValidationErrorDetail {
  return typeof value === 'object' && value !== null;
}

// The API's 400 VALIDATION_ERROR carries `details: [{ path: "address.line1", ... }]`,
// a dot-joined string rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(details: unknown): (keyof RequestFormValues | null)[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.map((detail) => {
    if (!isValidationErrorDetail(detail) || typeof detail.path !== 'string') {
      return null;
    }
    return mapCreateRequestIssuePath(detail.path.split('.'));
  });
}
