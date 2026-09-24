import { describe, expect, it, vi } from 'vitest';

import {
  buildSendQuotePayload,
  defaultSendQuoteFormValues,
  defaultValidUntil,
  EMPTY_LINE_ITEM,
  lineItemsSubtotalCents,
  mapSendQuoteIssuePath,
  mapValidationErrorDetailPath,
  type SendQuoteFormValues,
} from './send-quote-form-helpers';

describe('defaultValidUntil', () => {
  it('defaults to a week out when the request expires well beyond that', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const value = defaultValidUntil('2026-06-01T00:00:00.000Z');

    expect(new Date(value).toISOString().slice(0, 10)).toBe('2026-01-08');
    vi.useRealTimers();
  });

  it('clamps to just before the request expiry when that is sooner than a week', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const value = defaultValidUntil('2026-01-02T00:00:00.000Z');

    expect(new Date(value).getTime()).toBeLessThan(new Date('2026-01-02T00:00:00.000Z').getTime());
    expect(new Date(value).getTime()).toBeGreaterThan(Date.now());
    vi.useRealTimers();
  });
});

describe('defaultSendQuoteFormValues', () => {
  it('starts with a single empty line item and no message', () => {
    const values = defaultSendQuoteFormValues('2026-06-01T00:00:00.000Z');

    expect(values.lineItems).toEqual([EMPTY_LINE_ITEM]);
    expect(values.message).toBe('');
  });
});

describe('buildSendQuotePayload', () => {
  it('converts qty and unit price into integer cents for every line item', () => {
    const values: SendQuoteFormValues = {
      lineItems: [
        { label: 'Full day coverage', qty: '1', unitPrice: '1500' },
        { label: 'Extra hour', qty: '2', unitPrice: '99.99' },
      ],
      validUntil: '2026-06-01T12:00',
      message: '',
    };

    const payload = buildSendQuotePayload('request-1', values);

    expect(payload.requestId).toBe('request-1');
    expect(payload.lineItems).toEqual([
      { label: 'Full day coverage', qty: 1, unitCents: 150000 },
      { label: 'Extra hour', qty: 2, unitCents: 9999 },
    ]);
    expect(payload.message).toBeUndefined();
  });

  it('omits message entirely when blank, never sending an empty string', () => {
    const values: SendQuoteFormValues = {
      lineItems: [EMPTY_LINE_ITEM],
      validUntil: '2026-06-01T12:00',
      message: '   ',
    };

    expect('message' in buildSendQuotePayload('request-1', values)).toBe(false);
  });

  it('includes a trimmed message when present', () => {
    const values: SendQuoteFormValues = {
      lineItems: [EMPTY_LINE_ITEM],
      validUntil: '2026-06-01T12:00',
      message: 'Looking forward to it',
    };

    expect(buildSendQuotePayload('request-1', values).message).toBe('Looking forward to it');
  });

  it('turns an empty or non-numeric qty/price into NaN, never a silent 0', () => {
    const values: SendQuoteFormValues = {
      lineItems: [{ label: 'x', qty: '', unitPrice: 'abc' }],
      validUntil: '2026-06-01T12:00',
      message: '',
    };

    const [item] = buildSendQuotePayload('request-1', values).lineItems;
    expect(Number.isNaN(item?.qty)).toBe(true);
    expect(Number.isNaN(item?.unitCents)).toBe(true);
  });

  it('turns an unparsable validUntil into an empty string instead of throwing', () => {
    const values: SendQuoteFormValues = {
      lineItems: [EMPTY_LINE_ITEM],
      validUntil: 'not-a-date',
      message: '',
    };

    expect(buildSendQuotePayload('request-1', values).validUntil).toBe('');
  });
});

describe('lineItemsSubtotalCents', () => {
  it('sums qty times unitCents across every line item', () => {
    expect(
      lineItemsSubtotalCents([
        { label: 'a', qty: 2, unitCents: 1000 },
        { label: 'b', qty: 1, unitCents: 500 },
      ]),
    ).toBe(2500);
  });

  it('is 0 for an empty list', () => {
    expect(lineItemsSubtotalCents([])).toBe(0);
  });
});

describe('mapSendQuoteIssuePath / mapValidationErrorDetailPath', () => {
  it('maps a line item issue back to its indexed form field', () => {
    expect(mapSendQuoteIssuePath(['lineItems', 0, 'unitCents'])).toBe('lineItems.0.unitPrice');
    expect(mapSendQuoteIssuePath(['lineItems', 1, 'qty'])).toBe('lineItems.1.qty');
    expect(mapSendQuoteIssuePath(['lineItems', 0, 'label'])).toBe('lineItems.0.label');
  });

  it('maps validUntil and message directly', () => {
    expect(mapSendQuoteIssuePath(['validUntil'])).toBe('validUntil');
    expect(mapSendQuoteIssuePath(['message'])).toBe('message');
  });

  it('maps requestId and whole-array lineItems issues to null', () => {
    expect(mapSendQuoteIssuePath(['requestId'])).toBeNull();
    expect(mapSendQuoteIssuePath(['lineItems'])).toBeNull();
  });

  it('parses the API dot-joined detail path the same way', () => {
    expect(
      mapValidationErrorDetailPath([
        { path: 'lineItems.0.unitCents', message: 'bad' },
        { path: 'validUntil', message: 'bad' },
        { path: 'requestId', message: 'bad' },
      ]),
    ).toEqual(['lineItems.0.unitPrice', 'validUntil', null]);
  });

  it('returns an empty array for non-array details', () => {
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
  });
});
