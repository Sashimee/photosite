import { describe, expect, it } from 'vitest';
import {
  CancelDataRequestRequestSchema,
  ConsentRecordSchema,
  ConsentsResponseSchema,
  CreateConsentRequestSchema,
  CreateDataRequestRequestSchema,
  DataRequestDownloadResponseSchema,
  DataRequestSchema,
  UpdateConsentsRequestSchema,
  gdprResponseDueAt,
} from './gdpr.js';

const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('CreateDataRequestRequestSchema', () => {
  it('accepts export and delete types', () => {
    expect(CreateDataRequestRequestSchema.safeParse({ type: 'export' }).success).toBe(true);
    expect(CreateDataRequestRequestSchema.safeParse({ type: 'delete' }).success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(CreateDataRequestRequestSchema.safeParse({ type: 'anonymize' }).success).toBe(false);
  });
});

describe('DataRequestSchema', () => {
  const validRequest = {
    id,
    type: 'export',
    status: 'pending',
    requestedAt: '2026-09-16T12:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    failureReason: null,
    cancelledAt: null,
  };

  it('accepts a well-formed data request', () => {
    expect(DataRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it('accepts a ready export with an expiry and a cancelled deletion', () => {
    expect(
      DataRequestSchema.safeParse({
        ...validRequest,
        status: 'ready',
        completedAt: '2026-09-16T13:00:00.000Z',
        expiresAt: '2026-09-23T13:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      DataRequestSchema.safeParse({
        ...validRequest,
        type: 'delete',
        status: 'cancelled',
        cancelledAt: '2026-09-17T09:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('accepts a failed export with a failure reason', () => {
    expect(
      DataRequestSchema.safeParse({
        ...validRequest,
        status: 'failed',
        failureReason: 'ARCHIVE_BUILD_FAILED',
      }).success,
    ).toBe(true);
  });

  it('rejects an exportKey field', () => {
    expect(
      DataRequestSchema.safeParse({ ...validRequest, exportKey: 'exports/abc.zip' }).success,
    ).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(DataRequestSchema.safeParse({ ...validRequest, status: 'queued' }).success).toBe(false);
  });

  it('accepts every status in DATA_REQUEST_STATUSES', () => {
    for (const status of ['pending', 'processing', 'ready', 'completed', 'failed', 'cancelled']) {
      expect(DataRequestSchema.safeParse({ ...validRequest, status }).success).toBe(true);
    }
  });
});

describe('gdprResponseDueAt', () => {
  it('adds one calendar month for a normal date', () => {
    expect(gdprResponseDueAt(new Date('2026-09-16T12:00:00.000Z'), 'UTC').toISOString()).toBe(
      '2026-10-16T12:00:00.000Z',
    );
  });

  it('clamps to the last day of a shorter target month', () => {
    expect(gdprResponseDueAt(new Date('2026-01-31T00:00:00.000Z'), 'UTC').toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('clamps to Feb 29 on a leap year', () => {
    expect(gdprResponseDueAt(new Date('2028-01-31T00:00:00.000Z'), 'UTC').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('rolls over the year when requested in December', () => {
    expect(gdprResponseDueAt(new Date('2026-12-15T08:30:00.000Z'), 'UTC').toISOString()).toBe(
      '2027-01-15T08:30:00.000Z',
    );
  });

  it('clamps to the last day of a target month with 30 days', () => {
    expect(gdprResponseDueAt(new Date('2026-08-31T00:00:00.000Z'), 'UTC').toISOString()).toBe(
      '2026-09-30T00:00:00.000Z',
    );
  });

  it('preserves the time of day, including milliseconds, when clamping', () => {
    expect(gdprResponseDueAt(new Date('2026-01-31T14:23:05.123Z'), 'UTC').toISOString()).toBe(
      '2026-02-28T14:23:05.123Z',
    );
  });

  it('returns the UTC result when it is earlier than the zoned one, just after local midnight', () => {
    // 2026-02-28T23:30Z is 2026-03-01T00:30 CET in Luxembourg, so the zoned
    // calculation adds a month to that and lands on 2026-04-01T00:30 CEST
    // (2026-03-31T22:30Z), a day later than the UTC result of
    // 2026-03-28T23:30Z. The earlier, UTC, result wins.
    expect(
      gdprResponseDueAt(new Date('2026-02-28T23:30:00.000Z'), 'Europe/Luxembourg').toISOString(),
    ).toBe('2026-03-28T23:30:00.000Z');
  });

  it('returns the zoned result when it is earlier than the UTC one, clamped in the local month', () => {
    // 2026-01-30T23:30Z is 2026-01-31T00:30 CET in Luxembourg. Adding a
    // month and clamping to the last day of February 2026 gives
    // 2026-02-28T00:30 CET (2026-02-27T23:30Z), a day earlier than the UTC
    // result of 2026-02-28T23:30Z. The earlier, zoned, result wins.
    expect(
      gdprResponseDueAt(new Date('2026-01-30T23:30:00.000Z'), 'Europe/Luxembourg').toISOString(),
    ).toBe('2026-02-27T23:30:00.000Z');
  });

  it('resolves a spring-forward gap target to the instant just before the gap (Europe/Luxembourg)', () => {
    // Local target is 2048-02-29T02:30 + 1 month = 2048-03-29T02:30, inside
    // the Europe/Luxembourg gap where clocks jump from 02:00 to 03:00.
    expect(
      gdprResponseDueAt(new Date('2048-02-29T01:30:00.000Z'), 'Europe/Luxembourg').toISOString(),
    ).toBe('2048-03-29T00:30:00.000Z');
  });

  it('resolves a spring-forward gap target to the instant just before the gap (America/New_York)', () => {
    // Local target is 2026-02-08T02:30 + 1 month = 2026-03-08T02:30, inside
    // the America/New_York gap where clocks jump from 02:00 to 03:00.
    expect(
      gdprResponseDueAt(new Date('2026-02-08T07:30:00.000Z'), 'America/New_York').toISOString(),
    ).toBe('2026-03-08T06:30:00.000Z');
  });

  it('resolves a fall-back overlap target to the earlier instant (Europe/Luxembourg)', () => {
    // Local target is 2026-09-25T02:30 + 1 month = 2026-10-25T02:30, which
    // occurs twice in Europe/Luxembourg as clocks fall back from CEST to
    // CET. The earlier (CEST) instant wins.
    expect(
      gdprResponseDueAt(new Date('2026-09-25T00:30:00.000Z'), 'Europe/Luxembourg').toISOString(),
    ).toBe('2026-10-25T00:30:00.000Z');
  });

  it('resolves a fall-back overlap target to the earlier instant (America/New_York)', () => {
    // Local target is 2026-10-01T01:30 + 1 month = 2026-11-01T01:30, which
    // occurs twice in America/New_York as clocks fall back from EDT to EST.
    // The earlier (EDT) instant wins.
    expect(
      gdprResponseDueAt(new Date('2026-10-01T05:30:00.000Z'), 'America/New_York').toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
  });

  it('resolves a fall-back overlap target to the earlier instant in a positive-offset zone (Australia/Sydney)', () => {
    // Local target is 2026-03-05T02:30 + 1 month = 2026-04-05T02:30, which
    // occurs twice in Australia/Sydney as clocks fall back from AEDT to
    // AEST. The earlier (AEDT) instant wins.
    expect(
      gdprResponseDueAt(new Date('2026-03-04T15:30:00.000Z'), 'Australia/Sydney').toISOString(),
    ).toBe('2026-04-04T15:30:00.000Z');
  });

  it('clamps to Feb 29 on a leap year in a zone other than UTC', () => {
    expect(
      gdprResponseDueAt(new Date('2028-01-30T23:30:00.000Z'), 'Europe/Luxembourg').toISOString(),
    ).toBe('2028-02-28T23:30:00.000Z');
  });

  it('preserves non-zero milliseconds exactly through the zoned calculation', () => {
    expect(
      gdprResponseDueAt(new Date('2026-06-16T12:00:00.789Z'), 'Europe/Luxembourg').toISOString(),
    ).toBe('2026-07-16T12:00:00.789Z');
  });

  it('throws with the zone name for an invalid IANA time zone', () => {
    expect(() => gdprResponseDueAt(new Date('2026-09-16T12:00:00.000Z'), 'Not/AZone')).toThrow(
      'Not/AZone',
    );
  });
});

describe('CancelDataRequestRequestSchema', () => {
  it('defaults to an empty body for an ordinary in-session cancel', () => {
    expect(CancelDataRequestRequestSchema.safeParse(undefined)).toEqual({
      success: true,
      data: {},
    });
  });

  it('accepts a token for a soft-deleted account', () => {
    expect(CancelDataRequestRequestSchema.safeParse({ token: 'abc123' }).success).toBe(true);
  });

  it('rejects an empty token', () => {
    expect(CancelDataRequestRequestSchema.safeParse({ token: '' }).success).toBe(false);
  });
});

describe('DataRequestDownloadResponseSchema', () => {
  it('accepts a presigned url and expiry', () => {
    expect(
      DataRequestDownloadResponseSchema.safeParse({
        url: 'https://storage.photoo.lu/exports/abc123?signature=xyz',
        expiresAt: '2026-09-16T12:10:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a non-url', () => {
    expect(
      DataRequestDownloadResponseSchema.safeParse({
        url: 'not-a-url',
        expiresAt: '2026-09-16T12:10:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('CreateConsentRequestSchema', () => {
  it('accepts a consent for an authenticated session without anonymousId', () => {
    expect(
      CreateConsentRequestSchema.safeParse({
        purpose: 'analytics',
        granted: true,
      }).success,
    ).toBe(true);
  });

  it('accepts a consent for an anonymous visitor', () => {
    expect(
      CreateConsentRequestSchema.safeParse({
        anonymousId: 'anon_abc123',
        purpose: 'ads',
        granted: false,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown purpose', () => {
    expect(
      CreateConsentRequestSchema.safeParse({
        purpose: 'newsletter',
        granted: true,
      }).success,
    ).toBe(false);
  });

  it('rejects a client-supplied policyVersion', () => {
    expect(
      CreateConsentRequestSchema.safeParse({
        purpose: 'analytics',
        granted: true,
        policyVersion: '2026-01-01',
      }).success,
    ).toBe(false);
  });
});

describe('ConsentRecordSchema', () => {
  it('never exposes ip or userAgent', () => {
    expect(
      ConsentRecordSchema.safeParse({
        id,
        purpose: 'analytics',
        granted: true,
        policyVersion: '2026-01-01',
        recordedAt: '2026-09-16T12:00:00.000Z',
        ip: '203.0.113.1',
      }).success,
    ).toBe(false);
  });
});

describe('ConsentsResponseSchema', () => {
  it('accepts one entry per consent purpose, including undecided ones', () => {
    expect(
      ConsentsResponseSchema.safeParse({
        consents: [
          {
            purpose: 'analytics',
            granted: true,
            policyVersion: '2026-01-01',
            recordedAt: '2026-09-16T12:00:00.000Z',
          },
          { purpose: 'ads', granted: false, policyVersion: null, recordedAt: null },
          { purpose: 'marketing', granted: false, policyVersion: null, recordedAt: null },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects a missing purpose entry', () => {
    expect(
      ConsentsResponseSchema.safeParse({
        consents: [
          {
            purpose: 'analytics',
            granted: true,
            policyVersion: '2026-01-01',
            recordedAt: '2026-09-16T12:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('UpdateConsentsRequestSchema', () => {
  it('accepts one or more changed purposes', () => {
    expect(
      UpdateConsentsRequestSchema.safeParse({
        consents: [{ purpose: 'analytics', granted: false }],
      }).success,
    ).toBe(true);
  });

  it('rejects a client-supplied policyVersion', () => {
    expect(
      UpdateConsentsRequestSchema.safeParse({
        consents: [{ purpose: 'analytics', granted: false, policyVersion: '2026-01-01' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a duplicate purpose in the same request', () => {
    expect(
      UpdateConsentsRequestSchema.safeParse({
        consents: [
          { purpose: 'analytics', granted: true },
          { purpose: 'analytics', granted: false },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects an empty consents array', () => {
    expect(UpdateConsentsRequestSchema.safeParse({ consents: [] }).success).toBe(false);
  });
});
