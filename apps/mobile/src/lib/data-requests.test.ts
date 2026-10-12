import { describe, expect, it } from '@jest/globals';

import {
  dataRequestError,
  dataRequestErrorWithStatus,
  exportState,
  latestExport,
  type DataRequest,
} from './data-requests';

const NOW = Date.parse('2027-01-10T00:00:00.000Z');

function row(overrides: Partial<DataRequest> = {}): DataRequest {
  return {
    id: 'dr-1',
    type: 'export',
    status: 'pending',
    channel: 'in_app',
    requestedAt: '2027-01-09T00:00:00.000Z',
    receivedAt: '2027-01-09T00:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    failureReason: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe('latestExport', () => {
  it('returns the first export, skipping deletions', () => {
    const list = [row({ id: 'd', type: 'delete' }), row({ id: 'e1' }), row({ id: 'e0' })];
    expect(latestExport(list)?.id).toBe('e1');
  });

  it('returns null without an export', () => {
    expect(latestExport([row({ type: 'delete' })])).toBeNull();
    expect(latestExport([])).toBeNull();
  });
});

describe('exportState', () => {
  it('is none without a request', () => {
    expect(exportState(null, NOW)).toBe('none');
  });

  it.each(['pending', 'processing', 'failed'] as const)('maps %s', (status) => {
    expect(exportState(row({ status }), NOW)).toBe(status);
  });

  it('is ready before expiresAt', () => {
    const request = row({ status: 'ready', expiresAt: '2027-01-11T00:00:00.000Z' });
    expect(exportState(request, NOW)).toBe('ready');
  });

  it.each(['2027-01-10T00:00:00.000Z', '2027-01-01T00:00:00.000Z', null])(
    'is expired for a ready export with expiresAt %s',
    (expiresAt) => {
      expect(exportState(row({ status: 'ready', expiresAt }), NOW)).toBe('expired');
    },
  );

  it.each(['completed', 'cancelled'] as const)('treats %s as expired', (status) => {
    expect(exportState(row({ status }), NOW)).toBe('expired');
  });
});

describe('dataRequestError', () => {
  it.each([
    ['VERIFICATION_IN_REVIEW', 'verificationInReview'],
    ['ACCEPTED_QUOTE_WITHDRAWAL_WINDOW', 'acceptedQuoteWithdrawalWindow'],
  ])('maps the 409 blocking reason %s', (reason, key) => {
    expect(dataRequestError({ code: 'CONFLICT', details: { reason } })).toEqual({ key });
  });

  it.each([undefined, {}, { reason: 'SOMETHING_ELSE' }, { reason: 5 }, null])(
    'maps a 409 with details %j to conflict',
    (details) => {
      expect(dataRequestError({ code: 'CONFLICT', details })).toEqual({ key: 'conflict' });
    },
  );

  it('carries retryAfterSeconds on 429', () => {
    expect(
      dataRequestError({ code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 90 } }),
    ).toEqual({ key: 'tooManyRequests', seconds: 90 });
    expect(dataRequestError({ code: 'TOO_MANY_REQUESTS' })).toEqual({ key: 'tooManyRequests' });
  });

  it.each([
    ['FORBIDDEN', 'forbidden'],
    ['NOT_FOUND', 'notFound'],
    ['GONE', 'gone'],
    ['VALIDATION_ERROR', 'invalid'],
    ['UNPROCESSABLE_ENTITY', 'invalid'],
    ['UNAUTHORIZED', 'unauthorized'],
    ['SOMETHING', 'generic'],
  ])('maps %s', (code, key) => {
    expect(dataRequestError({ code })).toEqual({ key });
  });

  it('falls back to generic without a code', () => {
    expect(dataRequestError(undefined)).toEqual({ key: 'generic' });
  });
});

describe('dataRequestErrorWithStatus', () => {
  it('fills the code from the status when the body has none', () => {
    expect(dataRequestErrorWithStatus(undefined, 410)).toEqual({ code: 'GONE' });
  });

  it('keeps the body code', () => {
    expect(dataRequestErrorWithStatus({ code: 'FORBIDDEN' }, 409)).toEqual({ code: 'FORBIDDEN' });
  });

  it('adds nothing for an unmapped status', () => {
    expect(dataRequestErrorWithStatus(undefined, 500)).toEqual({});
  });
});
