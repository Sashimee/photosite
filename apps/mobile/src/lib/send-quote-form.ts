import type { LineItem } from '@photoo/shared';

import { toAmountCents } from './product-form';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const QTY_TEXT = /^\d+$/;

export interface LineItemFormValue {
  label: string;
  qty: string;
  unitPrice: string;
}

export interface SendQuoteFormValues {
  lineItems: LineItemFormValue[];
  validUntil: Date | null;
  message: string;
}

export const EMPTY_LINE_ITEM: LineItemFormValue = { label: '', qty: '1', unitPrice: '' };

// Never past the request's own expiry (nullable on `RequestSummary`) and never
// in the past, both of which `CreateQuoteRequestSchema` would reject, so a
// photographer who accepts the default never sees an error on an untouched field.
export function defaultValidUntil(expiresAt: string | null, now: number = Date.now()): Date {
  const expiry = expiresAt ? new Date(expiresAt).getTime() : Number.POSITIVE_INFINITY;
  const target = Math.min(now + WEEK_MS, expiry - MINUTE_MS);
  return new Date(Math.max(target, now + MINUTE_MS));
}

export function defaultSendQuoteFormValues(expiresAt: string | null): SendQuoteFormValues {
  return {
    lineItems: [{ ...EMPTY_LINE_ITEM }],
    validUntil: defaultValidUntil(expiresAt),
    message: '',
  };
}

// Anything but a plain whole number becomes NaN so the shared z.int() rejects
// it with a field error instead of sending a silent 0-quantity line.
function toQty(value: string): number {
  const trimmed = value.trim();
  return QTY_TEXT.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function buildSendQuotePayload(requestId: string, values: SendQuoteFormValues) {
  return {
    requestId,
    lineItems: values.lineItems.map((item) => ({
      label: item.label.trim(),
      qty: toQty(item.qty),
      unitCents: toAmountCents(item.unitPrice),
    })) satisfies LineItem[],
    validUntil: values.validUntil ? values.validUntil.toISOString() : '',
    ...(values.message.trim() ? { message: values.message.trim() } : {}),
  };
}

export function isAfterRequestExpiry(validUntil: Date | null, expiresAt: string | null): boolean {
  return (
    validUntil !== null &&
    expiresAt !== null &&
    validUntil.getTime() > new Date(expiresAt).getTime()
  );
}

export type SendQuoteFieldPath =
  | 'validUntil'
  | 'message'
  | `lineItems.${number}.label`
  | `lineItems.${number}.qty`
  | `lineItems.${number}.unitPrice`;

export type LineItemField = 'label' | 'qty' | 'unitPrice';

export function lineItemFieldPath(index: number, key: LineItemField): SendQuoteFieldPath {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- index is always a line item array position, not user content
  return `lineItems.${index}.${key}`;
}

// `requestId` and whole-array `lineItems` issues (too few or too many items)
// aren't tied to one field, so they map to `null` and surface as a form notice.
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

// The API's 400/422 validation errors carry
// `details: [{ path: "lineItems.0.unitCents", ... }]`, a dot-joined string
// rather than the segment array zod itself uses.
export function mapValidationErrorDetailPath(details: unknown): (SendQuoteFieldPath | null)[] {
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
    return mapSendQuoteIssuePath(segments);
  });
}

export const VALID_UNTIL_AFTER_REQUEST_EXPIRY_MESSAGE =
  'validUntil must not be after the request expires';
