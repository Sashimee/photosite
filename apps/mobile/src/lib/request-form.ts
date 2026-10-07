import type { ZodError } from 'zod';

import type { LicenceUsage, PhotographerCategory } from '@photoo/shared';

import { fieldErrorMessages, type ValidationTranslateFn } from './form-errors';
import { roundCoordinate, type Coordinates } from './location';
import { wholeUnitsToCents } from './money';

export interface RequestFormValues {
  title: string;
  category: PhotographerCategory | '';
  description: string;
  eventDate: Date | null;
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

export type RequestFormField = keyof RequestFormValues;

export type RequestFormErrors = Partial<Record<RequestFormField, string | undefined>>;

export const EMPTY_REQUEST_FORM_VALUES: RequestFormValues = {
  title: '',
  category: '',
  description: '',
  eventDate: null,
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

export function buildCreateRequestPayload(
  values: RequestFormValues,
  location: Coordinates | null,
  currency: string | null,
) {
  return {
    title: values.title.trim(),
    category: values.category,
    description: values.description.trim(),
    eventDate: values.eventDate?.toISOString(),
    dateFlexible: values.dateFlexible,
    location: location
      ? { lat: roundCoordinate(location.lat), lng: roundCoordinate(location.lng) }
      : undefined,
    address: {
      line1: values.addressLine1.trim(),
      ...(values.addressLine2.trim() ? { line2: values.addressLine2.trim() } : {}),
      city: values.addressCity.trim(),
      postalCode: values.addressPostalCode.trim(),
      countryCode: values.addressCountryCode,
    },
    budgetMin: { amountCents: wholeUnitsToCents(values.budgetMin), currency: currency ?? '' },
    budgetMax: { amountCents: wholeUnitsToCents(values.budgetMax), currency: currency ?? '' },
    usage: values.usage,
  };
}

const ADDRESS_FIELDS: Record<string, RequestFormField> = {
  line1: 'addressLine1',
  line2: 'addressLine2',
  city: 'addressCity',
  postalCode: 'addressPostalCode',
  countryCode: 'addressCountryCode',
};

export function mapRequestIssuePath(path: readonly PropertyKey[]): RequestFormField | null {
  const [first, second] = path;
  if (first === 'address' && typeof second === 'string') {
    return ADDRESS_FIELDS[second] ?? null;
  }
  if (typeof first === 'string' && first in EMPTY_REQUEST_FORM_VALUES) {
    return first as RequestFormField;
  }
  return null;
}

export interface RequestValidationMessages {
  validation: ValidationTranslateFn;
  budgetOrder: string;
  eventDateInPast: string;
}

export function mapRequestIssues(
  error: ZodError,
  messages: RequestValidationMessages,
): { fields: RequestFormErrors; locationInvalid: boolean } {
  const generic = fieldErrorMessages(messages.validation, error);
  const fields: RequestFormErrors = {};
  let locationInvalid = false;

  for (const issue of error.issues) {
    if (issue.path[0] === 'location') {
      locationInvalid = true;
      continue;
    }
    const field = mapRequestIssuePath(issue.path);
    if (!field || field in fields) {
      continue;
    }
    if (field === 'budgetMax' && issue.code === 'custom') {
      fields[field] = messages.budgetOrder;
    } else if (field === 'eventDate' && issue.code === 'custom') {
      fields[field] = messages.eventDateInPast;
    } else {
      fields[field] = generic[issue.path.join('.')] ?? messages.validation('invalid');
    }
  }

  return { fields, locationInvalid };
}

// The API's VALIDATION_ERROR carries `details: [{ path: "address.line1" }]`,
// a dot-joined string rather than the segment array zod itself uses.
export function mapServerFieldErrors(details: unknown): RequestFormField[] {
  if (!Array.isArray(details)) {
    return [];
  }
  const fields: RequestFormField[] = [];
  for (const detail of details as unknown[]) {
    if (typeof detail !== 'object' || detail === null || !('path' in detail)) {
      continue;
    }
    const { path } = detail;
    const field = typeof path === 'string' ? mapRequestIssuePath(path.split('.')) : null;
    if (field) {
      fields.push(field);
    }
  }
  return fields;
}
