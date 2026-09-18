import { describe, expect, it } from 'vitest';
import {
  ConsentRecordSchema,
  ConsentsResponseSchema,
  CreateConsentRequestSchema,
  CreateDataRequestRequestSchema,
  DataRequestDownloadResponseSchema,
  DataRequestSchema,
  UpdateConsentsRequestSchema,
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
