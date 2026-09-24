import type { components } from '@photoo/api-client';
import type { PhotographerCategory } from '@photoo/shared';

import { requireMoney } from '@/lib/money';

export interface PickedLocation {
  lat: number;
  lng: number;
}

// `JobOffer.location`'s generated type is a `LatLng` intersected with
// `Record<string, never> | null` (openapi-typescript's rendering of a
// nullable $ref): assigning a plain `{ lat, lng }` object into it, or into
// another independently-inlined copy of the same shape, fails structurally
// because satisfying the `Record<string, never>` half requires `lat`/`lng`
// to be `never`. `JobOfferInput` is the same schema with that one field
// replaced by a plain, well-behaved type instead.
export type JobOfferInput = Omit<components['schemas']['JobOffer'], 'location'> & {
  location: PickedLocation | null;
};

export interface JobOfferFormValues {
  title: string;
  description: string;
  category: PhotographerCategory | '';
  city: string;
  countryCode: string;
  remote: boolean;
  startDate: string;
  endDate: string;
  compensationMin: string;
  compensationMax: string;
}

export const EMPTY_JOB_OFFER_FORM_VALUES: JobOfferFormValues = {
  title: '',
  description: '',
  category: '',
  city: '',
  countryCode: '',
  remote: false,
  startDate: '',
  endDate: '',
  compensationMin: '',
  compensationMax: '',
};

function toDateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export function defaultValuesFromJobOffer(offer: JobOfferInput | null): JobOfferFormValues {
  if (!offer) {
    return EMPTY_JOB_OFFER_FORM_VALUES;
  }
  return {
    title: offer.title,
    description: offer.description,
    category: offer.category,
    city: offer.city,
    countryCode: offer.countryCode,
    remote: offer.remote,
    startDate: toDateInputValue(offer.startDate),
    endDate: toDateInputValue(offer.endDate),
    compensationMin: offer.compensation
      ? String(
          requireMoney(offer.compensation.min, `job offer "${offer.id}" compensation min`)
            .amountCents / 100,
        )
      : '',
    compensationMax: offer.compensation
      ? String(
          requireMoney(offer.compensation.max, `job offer "${offer.id}" compensation max`)
            .amountCents / 100,
        )
      : '',
  };
}

export function locationFromJobOffer(offer: JobOfferInput | null): PickedLocation | null {
  return offer?.location ?? null;
}

// A date-only `<input type="date">` value ("2026-01-01") parses as UTC
// midnight, which is already a valid `IsoDateTimeSchema` value once
// stringified - no timezone shift to worry about the way a `datetime-local`
// input (request-form-helpers.ts's `toIsoOrEmpty`) would need one.
function toIsoDateOrEmpty(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

// Mirrors `jobOfferDateRangeRefinement` (packages/shared/src/contract/job-board.ts):
// `CreateJobOfferRequestSchema` carries this as an object-level refinement, but
// `UpdateJobOfferRequestSchema` is a bare `.partial()` (zod 4.6.5 refuses
// `.partial()` on a refined schema) and never checks it - the API re-derives
// the merged result and checks it itself on PATCH, so the client mirrors the
// same rule for both create and edit instead of relying on the schema alone.
export function isValidJobOfferDateRange(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) {
    return true;
  }
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return true;
  }
  return start <= end;
}

// Mirrors `jobOfferLocationRefinement`: a remote offer never needs a map
// point, every other offer does. Same "create schema only" gap as the date
// range above, and the same reason the client checks it independently.
export function isJobOfferLocationMissing(
  remote: boolean,
  location: PickedLocation | null,
): boolean {
  return !remote && location === null;
}

// An empty or non-numeric amount becomes NaN so `MoneySchema` rejects it with
// a normal field error, instead of silently sending a 0-cent amount - same
// convention as product-form-helpers.ts's `toAmountCents`.
function toAmountCents(value: string): number {
  if (value.trim() === '') {
    return Number.NaN;
  }
  const units = Number(value);
  return Number.isFinite(units) ? Math.round(units * 100) : Number.NaN;
}

function buildCompensation(min: string, max: string, currency: string) {
  if (min.trim() === '' && max.trim() === '') {
    return null;
  }
  return {
    min: { amountCents: toAmountCents(min), currency },
    max: { amountCents: toAmountCents(max), currency },
  };
}

// An empty `category` selection is rejected by the shared schema's
// `safeParse` right after this call (its enum has no `''` member), so the
// cast below is safe the same way `buildProductPayload`'s required,
// already-checked `category` field is.
export function buildJobOfferPayload(
  values: JobOfferFormValues,
  location: PickedLocation | null,
  currency: string,
) {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    category: values.category as PhotographerCategory,
    city: values.city.trim(),
    countryCode: values.countryCode,
    remote: values.remote,
    ...(location ? { location } : {}),
    startDate: values.startDate ? toIsoDateOrEmpty(values.startDate) : null,
    endDate: values.endDate ? toIsoDateOrEmpty(values.endDate) : null,
    compensation: buildCompensation(values.compensationMin, values.compensationMax, currency),
  };
}

export type JobOfferFieldPath =
  | 'title'
  | 'description'
  | 'category'
  | 'city'
  | 'countryCode'
  | 'remote'
  | 'startDate'
  | 'endDate'
  | 'compensationMin'
  | 'compensationMax';

// `location`'s own issues surface through the picker's dedicated required-field
// message, not a registered form field, so they map to `null` here on purpose
// - same convention as `request-form-helpers.ts`'s `mapCreateRequestIssuePath`.
export function mapJobOfferIssuePath(path: readonly PropertyKey[]): JobOfferFieldPath | null {
  const [first, second] = path;
  if (first === 'location') {
    return null;
  }
  if (first === 'compensation') {
    if (second === 'min') return 'compensationMin';
    if (second === 'max') return 'compensationMax';
    return null;
  }
  return typeof first === 'string' && first in EMPTY_JOB_OFFER_FORM_VALUES
    ? (first as JobOfferFieldPath)
    : null;
}

interface ValidationErrorDetail {
  path?: string;
  message?: string;
}

function isValidationErrorDetail(value: unknown): value is ValidationErrorDetail {
  return typeof value === 'object' && value !== null;
}

// The API's 400 VALIDATION_ERROR carries `details: [{ path: "compensation.min.amountCents", ... }]`,
// a dot-joined string rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(details: unknown): (JobOfferFieldPath | null)[] {
  if (!Array.isArray(details)) {
    return [];
  }
  return details.map((detail) => {
    if (!isValidationErrorDetail(detail) || typeof detail.path !== 'string') {
      return null;
    }
    return mapJobOfferIssuePath(detail.path.split('.'));
  });
}
