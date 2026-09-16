import { describe, expect, it } from 'vitest';
import {
  ConsentRecordSchema,
  CreateConsentRequestSchema,
  CreateDataRequestRequestSchema,
  DataRequestSchema,
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
  };

  it('accepts a well-formed data request', () => {
    expect(DataRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it('rejects an exportKey field', () => {
    expect(
      DataRequestSchema.safeParse({ ...validRequest, exportKey: 'exports/abc.zip' }).success,
    ).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(DataRequestSchema.safeParse({ ...validRequest, status: 'queued' }).success).toBe(false);
  });
});

describe('CreateConsentRequestSchema', () => {
  it('accepts a consent for an authenticated session without anonymousId', () => {
    expect(
      CreateConsentRequestSchema.safeParse({
        purpose: 'analytics',
        granted: true,
        policyVersion: '2026-01-01',
      }).success,
    ).toBe(true);
  });

  it('accepts a consent for an anonymous visitor', () => {
    expect(
      CreateConsentRequestSchema.safeParse({
        anonymousId: 'anon_abc123',
        purpose: 'ads',
        granted: false,
        policyVersion: '2026-01-01',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown purpose', () => {
    expect(
      CreateConsentRequestSchema.safeParse({
        purpose: 'newsletter',
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
