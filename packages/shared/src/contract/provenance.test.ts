import { describe, expect, it } from 'vitest';
import {
  AdminProvenanceCheckSchema,
  AdminProvenanceCheckSummarySchema,
  AdminProvenancePhotographerSchema,
  AdminProvenanceQuerySchema,
  PortfolioImageProvenanceSchema,
  PROVENANCE_DECISION_STATUSES,
  ProvenanceDecisionRequestSchema,
} from './provenance.js';

const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

const validPhotographer = {
  id,
  displayName: 'Jane Doe',
  slug: 'jane-doe',
};

const validCheckSummary = {
  id,
  portfolioImageId: id,
  portfolioImageStatus: 'approved',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  photographer: validPhotographer,
  verdict: 'pass',
  score: 0.05,
  checkedAt: '2026-09-16T12:00:00.000Z',
  reviewedAt: null,
};

const validCheck = {
  ...validCheckSummary,
  aiScore: 0.12,
  aiVendor: 'hive',
  reverseMatches: ['https://example.com/match.jpg'],
  c2paValid: true,
  exifCamera: 'Canon EOS R5',
  exifCapturedAt: '2026-08-01T10:00:00.000Z',
  reviewedByAdminId: null,
  note: null,
};

describe('PortfolioImageProvenanceSchema', () => {
  it('accepts a well-formed provenance summary', () => {
    expect(
      PortfolioImageProvenanceSchema.safeParse({
        verdict: 'pass',
        status: 'approved',
        checkedAt: '2026-09-16T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('accepts a null checkedAt', () => {
    expect(
      PortfolioImageProvenanceSchema.safeParse({
        verdict: 'review',
        status: 'pending_review',
        checkedAt: null,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown verdict', () => {
    expect(
      PortfolioImageProvenanceSchema.safeParse({
        verdict: 'suspicious',
        status: 'approved',
        checkedAt: null,
      }).success,
    ).toBe(false);
  });

  it('rejects a score field: never exposed to the photographer', () => {
    expect(
      PortfolioImageProvenanceSchema.safeParse({
        verdict: 'pass',
        status: 'approved',
        checkedAt: null,
        score: 0.1,
      }).success,
    ).toBe(false);
  });
});

describe('AdminProvenanceQuerySchema', () => {
  it('accepts an empty query, defaulting the limit', () => {
    const result = AdminProvenanceQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts a verdict and status filter with a cursor', () => {
    expect(
      AdminProvenanceQuerySchema.safeParse({
        verdict: 'review',
        status: 'pending_review',
        cursor: 'abc',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown verdict filter', () => {
    expect(AdminProvenanceQuerySchema.safeParse({ verdict: 'suspicious' }).success).toBe(false);
  });

  it('rejects a limit above 100', () => {
    expect(AdminProvenanceQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('AdminProvenancePhotographerSchema', () => {
  it('accepts a well-formed photographer', () => {
    expect(AdminProvenancePhotographerSchema.safeParse(validPhotographer).success).toBe(true);
  });

  it('rejects an email field: identity only, no PII beyond the public profile', () => {
    expect(
      AdminProvenancePhotographerSchema.safeParse({
        ...validPhotographer,
        email: 'jane@example.com',
      }).success,
    ).toBe(false);
  });
});

describe('AdminProvenanceCheckSummarySchema', () => {
  it('accepts a well-formed summary', () => {
    expect(AdminProvenanceCheckSummarySchema.safeParse(validCheckSummary).success).toBe(true);
  });

  it('accepts a null score and checkedAt for a not-yet-checked image', () => {
    expect(
      AdminProvenanceCheckSummarySchema.safeParse({
        ...validCheckSummary,
        score: null,
        checkedAt: null,
      }).success,
    ).toBe(true);
  });

  it('rejects an aiVendor field: only the single-check endpoint carries forensic detail', () => {
    expect(
      AdminProvenanceCheckSummarySchema.safeParse({ ...validCheckSummary, aiVendor: 'hive' })
        .success,
    ).toBe(false);
  });

  it('rejects an unknown verdict', () => {
    expect(
      AdminProvenanceCheckSummarySchema.safeParse({ ...validCheckSummary, verdict: 'suspicious' })
        .success,
    ).toBe(false);
  });
});

describe('AdminProvenanceCheckSchema', () => {
  it('accepts a well-formed provenance check', () => {
    expect(AdminProvenanceCheckSchema.safeParse(validCheck).success).toBe(true);
  });

  it('accepts all forensic fields null before a check has run', () => {
    expect(
      AdminProvenanceCheckSchema.safeParse({
        ...validCheck,
        score: null,
        checkedAt: null,
        aiScore: null,
        aiVendor: null,
        reverseMatches: null,
        c2paValid: null,
        exifCamera: null,
        exifCapturedAt: null,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown verdict', () => {
    expect(
      AdminProvenanceCheckSchema.safeParse({ ...validCheck, verdict: 'suspicious' }).success,
    ).toBe(false);
  });

  it('rejects a note longer than 2000 characters', () => {
    expect(
      AdminProvenanceCheckSchema.safeParse({ ...validCheck, note: 'a'.repeat(2001) }).success,
    ).toBe(false);
  });
});

describe('PROVENANCE_DECISION_STATUSES', () => {
  it('lists approved, flagged and rejected', () => {
    expect(PROVENANCE_DECISION_STATUSES).toEqual(['approved', 'flagged', 'rejected']);
  });
});

describe('ProvenanceDecisionRequestSchema', () => {
  it('accepts a well-formed decision', () => {
    expect(
      ProvenanceDecisionRequestSchema.safeParse({ status: 'approved', note: 'Looks fine' }).success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      ProvenanceDecisionRequestSchema.safeParse({ status: 'archived', note: 'Looks fine' }).success,
    ).toBe(false);
  });

  it('rejects an empty note', () => {
    expect(ProvenanceDecisionRequestSchema.safeParse({ status: 'flagged', note: '' }).success).toBe(
      false,
    );
  });

  it('rejects a note longer than 2000 characters', () => {
    expect(
      ProvenanceDecisionRequestSchema.safeParse({ status: 'rejected', note: 'a'.repeat(2001) })
        .success,
    ).toBe(false);
  });
});
