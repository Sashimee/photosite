import { describe, expect, it } from '@jest/globals';

import {
  buildSendQuotePayload,
  defaultValidUntil,
  isAfterRequestExpiry,
  mapSendQuoteIssuePath,
  mapValidationErrorDetailPath,
} from './send-quote-form';

const REQUEST_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const NOW = new Date('2026-10-07T10:00:00.000Z').getTime();

describe('buildSendQuotePayload', () => {
  it('turns decimal prices into integer cents and omits an empty message', () => {
    const payload = buildSendQuotePayload(REQUEST_ID, {
      lineItems: [
        { label: ' Full day ', qty: '2', unitPrice: '120.5' },
        { label: 'Album', qty: '1', unitPrice: '0,99' },
      ],
      validUntil: new Date('2026-10-14T10:00:00.000Z'),
      message: '   ',
    });

    expect(payload).toEqual({
      requestId: REQUEST_ID,
      lineItems: [
        { label: 'Full day', qty: 2, unitCents: 12050 },
        { label: 'Album', qty: 1, unitCents: 99 },
      ],
      validUntil: '2026-10-14T10:00:00.000Z',
    });
  });

  it('keeps a trimmed message', () => {
    const payload = buildSendQuotePayload(REQUEST_ID, {
      lineItems: [{ label: 'Day', qty: '1', unitPrice: '10' }],
      validUntil: new Date('2026-10-14T10:00:00.000Z'),
      message: ' Thanks ',
    });

    expect(payload.message).toBe('Thanks');
  });

  it('turns more than two decimals, empty and non-numeric input into NaN', () => {
    const payload = buildSendQuotePayload(REQUEST_ID, {
      lineItems: [
        { label: 'a', qty: '1', unitPrice: '10.999' },
        { label: 'b', qty: '1.5', unitPrice: '' },
        { label: 'c', qty: '', unitPrice: 'abc' },
        { label: 'd', qty: '-1', unitPrice: '-5' },
      ],
      validUntil: null,
      message: '',
    });

    for (const item of payload.lineItems) {
      expect(Number.isNaN(item.unitCents)).toBe(true);
    }
    expect(Number.isNaN(payload.lineItems[1]?.qty)).toBe(true);
    expect(Number.isNaN(payload.lineItems[2]?.qty)).toBe(true);
    expect(Number.isNaN(payload.lineItems[3]?.qty)).toBe(true);
    expect(payload.validUntil).toBe('');
  });
});

describe('defaultValidUntil', () => {
  it('defaults to a week out when the request has no expiry', () => {
    expect(defaultValidUntil(null, NOW).getTime()).toBe(NOW + 7 * 24 * 60 * 60 * 1000);
  });

  it('stays a minute inside the request expiry', () => {
    const expiresAt = new Date(NOW + 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(defaultValidUntil(expiresAt, NOW).getTime()).toBe(
      NOW + 2 * 24 * 60 * 60 * 1000 - 60 * 1000,
    );
  });

  it('never goes into the past for a request about to expire', () => {
    const expiresAt = new Date(NOW + 10 * 1000).toISOString();
    expect(defaultValidUntil(expiresAt, NOW).getTime()).toBe(NOW + 60 * 1000);
  });
});

describe('isAfterRequestExpiry', () => {
  it('compares against the expiry only when both exist', () => {
    const expiresAt = '2026-10-10T00:00:00.000Z';
    expect(isAfterRequestExpiry(new Date('2026-10-11T00:00:00.000Z'), expiresAt)).toBe(true);
    expect(isAfterRequestExpiry(new Date('2026-10-09T00:00:00.000Z'), expiresAt)).toBe(false);
    expect(isAfterRequestExpiry(new Date('2026-10-11T00:00:00.000Z'), null)).toBe(false);
    expect(isAfterRequestExpiry(null, expiresAt)).toBe(false);
  });
});

describe('issue path mapping', () => {
  it('maps zod paths to form fields and unitCents to the price field', () => {
    expect(mapSendQuoteIssuePath(['validUntil'])).toBe('validUntil');
    expect(mapSendQuoteIssuePath(['lineItems', 1, 'unitCents'])).toBe('lineItems.1.unitPrice');
    expect(mapSendQuoteIssuePath(['lineItems', 0, 'qty'])).toBe('lineItems.0.qty');
    expect(mapSendQuoteIssuePath(['lineItems'])).toBeNull();
    expect(mapSendQuoteIssuePath(['requestId'])).toBeNull();
  });

  it('maps the API dot-joined detail paths', () => {
    expect(
      mapValidationErrorDetailPath([
        { path: 'lineItems.0.unitCents' },
        { path: 'message' },
        { path: 'other' },
        {},
        'nope',
      ]),
    ).toEqual(['lineItems.0.unitPrice', 'message', null, null, null]);
    expect(mapValidationErrorDetailPath(undefined)).toEqual([]);
  });
});
