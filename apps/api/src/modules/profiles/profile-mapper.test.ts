import { describe, expect, it } from 'vitest';
import type { PortfolioImage as DbPortfolioImage, ProvenanceCheck, Upload } from '@photoo/db';
import { mapOwnProfile, mapPortfolioImage, type ProfileWithUploads } from './profile-mapper.js';

const BASE_URL = 'https://cdn.example.com';

function fakeImage(overrides: Partial<DbPortfolioImage> = {}): DbPortfolioImage {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    profileId: '22222222-2222-4222-8222-222222222222',
    uploadId: '33333333-3333-4333-8333-333333333333',
    width: 1200,
    height: 800,
    order: 1,
    status: 'pending_review',
    deletedAt: null,
    createdAt: new Date('2026-01-15T09:00:00.000Z'),
    updatedAt: new Date('2026-01-15T09:00:00.000Z'),
    ...overrides,
  };
}

function fakeUpload(overrides: Partial<Upload> = {}): Upload {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    variants: { medium_jpeg: 'uploads/medium.jpg' },
    ...overrides,
  } as Upload;
}

function fakeProvenanceCheck(overrides: Partial<ProvenanceCheck> = {}): ProvenanceCheck {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    portfolioImageId: '11111111-1111-4111-8111-111111111111',
    aiScore: '0.910',
    aiVendor: 'vendor-x',
    reverseMatches: [],
    c2paValid: null,
    exifCamera: null,
    exifCapturedAt: null,
    score: '0.910',
    verdict: 'pass',
    reviewedByAdminId: null,
    reviewedAt: null,
    note: null,
    decisionReason: null,
    decisionReasonText: null,
    raw: null,
    createdAt: new Date('2026-01-15T10:00:00.000Z'),
    updatedAt: new Date('2026-01-15T10:00:00.000Z'),
    ...overrides,
  } as ProvenanceCheck;
}

describe('mapPortfolioImage', () => {
  it('returns provenance: null when no provenance check is passed', () => {
    const result = mapPortfolioImage(fakeImage(), fakeUpload(), BASE_URL);

    expect(result.provenance).toBeNull();
  });

  it('returns provenance: null when the provenance check is explicitly null', () => {
    const result = mapPortfolioImage(fakeImage(), fakeUpload(), BASE_URL, null);

    expect(result.provenance).toBeNull();
  });

  it('returns the provenance summary when a check is passed', () => {
    const image = fakeImage({ status: 'approved' });
    const check = fakeProvenanceCheck({ verdict: 'pass' });

    const result = mapPortfolioImage(image, fakeUpload(), BASE_URL, check);

    expect(result.provenance).toEqual({
      verdict: 'pass',
      status: 'approved',
      checkedAt: '2026-01-15T10:00:00.000Z',
      decisionReason: null,
      decisionReasonText: null,
    });
  });

  it('derives provenance.status from the image, not the check', () => {
    const image = fakeImage({ status: 'flagged' });
    const check = fakeProvenanceCheck({ verdict: 'fail' });

    const result = mapPortfolioImage(image, fakeUpload(), BASE_URL, check);

    expect(result.provenance).toEqual({
      verdict: 'fail',
      status: 'flagged',
      checkedAt: '2026-01-15T10:00:00.000Z',
      decisionReason: null,
      decisionReasonText: null,
    });
  });

  it('surfaces the decision reason and text to the image owner, but never the admin note', () => {
    const image = fakeImage({ status: 'rejected' });
    const check = fakeProvenanceCheck({
      verdict: 'fail',
      note: 'admin-internal detail',
      decisionReason: 'ai_generated',
      decisionReasonText: 'Detected generative artifacts',
    });

    const result = mapPortfolioImage(image, fakeUpload(), BASE_URL, check);

    expect(result.provenance).toEqual({
      verdict: 'fail',
      status: 'rejected',
      checkedAt: '2026-01-15T10:00:00.000Z',
      decisionReason: 'ai_generated',
      decisionReasonText: 'Detected generative artifacts',
    });
    expect(JSON.stringify(result)).not.toContain('admin-internal detail');
  });
});

describe('mapOwnProfile stripeAccountConnected', () => {
  function fakeProfile(overrides: Partial<ProfileWithUploads> = {}): ProfileWithUploads {
    return {
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'jane-doe',
      displayName: 'Jane Doe',
      headline: null,
      bio: {},
      links: { other: [] },
      categories: [],
      languages: ['en'],
      serviceRadiusKm: 25,
      city: 'Luxembourg',
      countryCode: 'LU',
      ratingAvg: '0',
      ratingCount: 0,
      verificationStatus: 'unverified',
      isPublished: false,
      stripeAccountId: null,
      stripeOnboardingComplete: false,
      stripePayoutsEnabled: false,
      avatarUpload: null,
      coverUpload: null,
      portfolio: [],
      ...overrides,
    } as unknown as ProfileWithUploads;
  }
  const location = { lat: 49.6116, lng: 6.1319 };

  it('is false when the profile has no stripe account id', () => {
    const result = mapOwnProfile(fakeProfile(), location, BASE_URL);

    expect(result.stripeAccountConnected).toBe(false);
  });

  it('is true when a stripe account id exists and never exposes the id', () => {
    const result = mapOwnProfile(fakeProfile({ stripeAccountId: 'acct_123' }), location, BASE_URL);

    expect(result.stripeAccountConnected).toBe(true);
    expect(result).not.toHaveProperty('stripeAccountId');
  });
});
