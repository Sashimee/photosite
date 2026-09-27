import { describe, expect, it } from 'vitest';
import {
  mapAdminProvenanceCheck,
  mapAdminProvenanceCheckSummary,
} from './admin-provenance-mapper.js';
import type { ProvenanceCheckWithRelations } from './admin-provenance.repository.js';

const BASE_URL = 'https://cdn.example.com';

function fakeCheck(
  overrides: Partial<ProvenanceCheckWithRelations> = {},
): ProvenanceCheckWithRelations {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    portfolioImageId: '22222222-2222-4222-8222-222222222222',
    aiScore: '0.910',
    aiVendor: 'vendor-x',
    reverseMatches: [{ url: 'https://example.com/match', domain: 'example.com', similarity: 0.87 }],
    c2paValid: true,
    exifCamera: 'Canon EOS R5',
    exifCapturedAt: new Date('2026-01-01T00:00:00.000Z'),
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
    portfolioImage: {
      id: '22222222-2222-4222-8222-222222222222',
      profileId: '33333333-3333-4333-8333-333333333333',
      uploadId: '44444444-4444-4444-8444-444444444444',
      width: 1200,
      height: 800,
      order: 0,
      status: 'processing',
      deletedAt: null,
      createdAt: new Date('2026-01-15T09:00:00.000Z'),
      updatedAt: new Date('2026-01-15T09:00:00.000Z'),
      profile: {
        id: '33333333-3333-4333-8333-333333333333',
        displayName: 'Jane Doe',
        slug: 'jane-doe',
      },
      upload: {
        variants: { medium_jpeg: 'uploads/medium.jpg' },
      },
    },
    ...overrides,
  } as unknown as ProvenanceCheckWithRelations;
}

describe('mapAdminProvenanceCheckSummary', () => {
  it('maps the check and its photographer into the summary shape', () => {
    const summary = mapAdminProvenanceCheckSummary(fakeCheck(), BASE_URL);

    expect(summary).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      portfolioImageId: '22222222-2222-4222-8222-222222222222',
      portfolioImageStatus: 'processing',
      thumbnailUrl: 'https://cdn.example.com/uploads/medium.jpg',
      photographer: {
        id: '33333333-3333-4333-8333-333333333333',
        displayName: 'Jane Doe',
        slug: 'jane-doe',
      },
      verdict: 'pass',
      score: 0.91,
      checkedAt: '2026-01-15T10:00:00.000Z',
      reviewedAt: null,
    });
  });

  it('throws when the upload has no portfolio thumbnail variant', () => {
    const check = fakeCheck({
      portfolioImage: {
        ...fakeCheck().portfolioImage,
        upload: { variants: {} },
      },
    } as Partial<ProvenanceCheckWithRelations>);

    expect(() => mapAdminProvenanceCheckSummary(check, BASE_URL)).toThrow(
      /has no portfolio thumbnail variant/,
    );
  });
});

describe('mapAdminProvenanceCheck', () => {
  it('extends the summary with detail fields', () => {
    const detail = mapAdminProvenanceCheck(fakeCheck(), BASE_URL);

    expect(detail).toMatchObject({
      aiScore: 0.91,
      aiVendor: 'vendor-x',
      reverseMatches: ['https://example.com/match'],
      c2paValid: true,
      exifCamera: 'Canon EOS R5',
      exifCapturedAt: '2026-01-01T00:00:00.000Z',
      reviewedByAdminId: null,
      note: null,
    });
  });

  it('maps a null aiScore and exifCapturedAt to null', () => {
    const detail = mapAdminProvenanceCheck(
      fakeCheck({ aiScore: null, exifCapturedAt: null }),
      BASE_URL,
    );

    expect(detail.aiScore).toBeNull();
    expect(detail.exifCapturedAt).toBeNull();
  });

  it('maps a null reverseMatches to null', () => {
    const detail = mapAdminProvenanceCheck(fakeCheck({ reverseMatches: null }), BASE_URL);

    expect(detail.reverseMatches).toBeNull();
  });

  it('includes the decision reason and text alongside the admin note', () => {
    const detail = mapAdminProvenanceCheck(
      fakeCheck({
        note: 'admin-internal detail',
        decisionReason: 'ai_generated',
        decisionReasonText: 'Detected generative artifacts',
      }),
      BASE_URL,
    );

    expect(detail.decisionReason).toBe('ai_generated');
    expect(detail.decisionReasonText).toBe('Detected generative artifacts');
    expect(detail.note).toBe('admin-internal detail');
  });

  it('drops malformed reverse match entries instead of trusting their shape', () => {
    const detail = mapAdminProvenanceCheck(
      fakeCheck({
        reverseMatches: [
          { url: 'https://example.com/a', domain: 'example.com', similarity: 0.5 },
          { domain: 'no-url.example.com', similarity: 0.5 },
          'https://not-an-object.example.com',
          null,
        ],
      }),
      BASE_URL,
    );

    expect(detail.reverseMatches).toEqual(['https://example.com/a']);
  });
});
