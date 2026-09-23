import type { LineItem } from '@photoo/shared';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface LineItemFormValue {
  label: string;
  qty: string;
  unitPrice: string;
}

export interface SendQuoteFormValues {
  lineItems: LineItemFormValue[];
  validUntil: string;
  message: string;
}

export const EMPTY_LINE_ITEM: LineItemFormValue = { label: '', qty: '1', unitPrice: '' };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateTimeLocal(date: Date): string {
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Defaults to a week out, but never past the request's own expiry (when it
// has one - `RequestSummary.expiresAt` is nullable) and never in the past -
// both of which `CreateQuoteRequestSchema` would reject anyway, so a
// photographer who accepts the default never sees a validation error on a
// field they didn't touch.
export function defaultValidUntil(expiresAt: string | null): string {
  const now = Date.now();
  const expiry = expiresAt ? new Date(expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const target = Math.min(now + WEEK_MS, expiry - MINUTE_MS);
  return toDateTimeLocal(new Date(Math.max(target, now + MINUTE_MS)));
}

export function defaultSendQuoteFormValues(expiresAt: string | null): SendQuoteFormValues {
  return {
    lineItems: [EMPTY_LINE_ITEM],
    validUntil: defaultValidUntil(expiresAt),
    message: '',
  };
}

// An unparsable or empty `datetime-local` value becomes '' so
// `FutureIsoDateTimeSchema` rejects it with a normal field error, instead of
// `.toISOString()` throwing a RangeError - same convention as
// requests/new/request-form-helpers.ts.
function toIsoOrEmpty(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

// An empty or non-numeric qty/price becomes NaN so the shared zod schema
// rejects it with a normal field error, instead of silently sending a
// 0-qty or 0-cent line item - same convention as the product form.
function toNumberOrNaN(value: string): number {
  if (value.trim() === '') {
    return Number.NaN;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function toAmountCents(value: string): number {
  const units = toNumberOrNaN(value);
  return Number.isNaN(units) ? Number.NaN : Math.round(units * 100);
}

export function buildSendQuotePayload(requestId: string, values: SendQuoteFormValues) {
  return {
    requestId,
    lineItems: values.lineItems.map((item) => ({
      label: item.label,
      qty: toNumberOrNaN(item.qty),
      unitCents: toAmountCents(item.unitPrice),
    })) satisfies LineItem[],
    validUntil: toIsoOrEmpty(values.validUntil),
    ...(values.message.trim() ? { message: values.message } : {}),
  };
}

export function lineItemsSubtotalCents(lineItems: readonly LineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.qty * item.unitCents, 0);
}

export type SendQuoteFieldPath =
  | 'validUntil'
  | 'message'
  | `lineItems.${number}.label`
  | `lineItems.${number}.qty`
  | `lineItems.${number}.unitPrice`;

function lineItemFieldPath(
  index: number,
  key: 'label' | 'qty' | 'unitPrice',
): `lineItems.${number}.${'label' | 'qty' | 'unitPrice'}` {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- index is always a line item array position, not user content
  return `lineItems.${index}.${key}`;
}

// `requestId` and whole-array `lineItems` issues (too few/too many items)
// aren't tied to a single field, so they map to `null` and surface as a
// general form notice instead - same convention as the product and request
// forms' issue mappers.
export function mapSendQuoteIssuePath(path: readonly PropertyKey[]): SendQuoteFieldPath | null {
  const [first, second, third] = path;
  if (first === 'validUntil' || first === 'message') {
    return first;
  }
  if (first === 'lineItems' && typeof second === 'number') {
    if (third === 'label') return lineItemFieldPath(second, 'label');
    if (third === 'qty') return lineItemFieldPath(second, 'qty');
    if (third === 'unitCents') return lineItemFieldPath(second, 'unitPrice');
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
// `details: [{ path: "lineItems.0.unitCents", ... }]`, a dot-joined string
// rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(details: unknown): (SendQuoteFieldPath | null)[] {
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
    return mapSendQuoteIssuePath(segments);
  });
}
