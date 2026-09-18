import { describe, expect, it } from 'vitest';
import {
  AdminBookingSchema,
  AdminCountryLegalTextsResponseSchema,
  AdminCountrySchema,
  AdminLegalTextVersionSchema,
  AdminProvenanceCheckSchema,
  AdminReportSchema,
  AdminReportsQuerySchema,
  AdminUserSearchQuerySchema,
  AdminVerificationCasesQuerySchema,
  PlatformSettingsSchema,
  PublishLegalTextRequestSchema,
  RefundBookingRequestSchema,
  RejectVerificationCaseRequestSchema,
  ResolveReportRequestSchema,
  SetUserRolesRequestSchema,
  SuspendUserRequestSchema,
  TakedownReportRequestSchema,
  UpdateCountryRequestSchema,
  UpdateFeatureFlagsRequestSchema,
  UpdatePlatformSettingsRequestSchema,
} from './admin.js';

const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('AdminUserSearchQuerySchema', () => {
  it('defaults limit to 20', () => {
    const result = AdminUserSearchQuerySchema.parse({});
    expect(result.limit).toBe(20);
  });

  it('rejects an unknown role', () => {
    expect(AdminUserSearchQuerySchema.safeParse({ role: 'moderator' }).success).toBe(false);
  });
});

describe('SuspendUserRequestSchema', () => {
  it('requires a non-empty reason', () => {
    expect(SuspendUserRequestSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(SuspendUserRequestSchema.safeParse({ reason: 'Fraudulent listings' }).success).toBe(
      true,
    );
  });
});

describe('SetUserRolesRequestSchema', () => {
  it('accepts a unique role list', () => {
    expect(SetUserRolesRequestSchema.safeParse({ roles: ['client', 'photographer'] }).success).toBe(
      true,
    );
  });

  it('rejects duplicate roles', () => {
    expect(SetUserRolesRequestSchema.safeParse({ roles: ['client', 'client'] }).success).toBe(
      false,
    );
  });

  it('rejects an empty role list', () => {
    expect(SetUserRolesRequestSchema.safeParse({ roles: [] }).success).toBe(false);
  });
});

describe('AdminReportSchema and ResolveReportRequestSchema', () => {
  const validReport = {
    id,
    reporterId: id,
    targetType: 'portfolio_image',
    targetId: id,
    reason: 'Suspected AI-generated image',
    status: 'open',
    adminId: null,
    resolution: null,
  };

  it('accepts a well-formed report', () => {
    expect(AdminReportSchema.safeParse(validReport).success).toBe(true);
  });

  it('accepts a null reporterId for an anonymous notice', () => {
    expect(AdminReportSchema.safeParse({ ...validReport, reporterId: null }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(AdminReportSchema.safeParse({ ...validReport, status: 'escalated' }).success).toBe(
      false,
    );
  });

  it('resolve request requires a resolution', () => {
    expect(
      ResolveReportRequestSchema.safeParse({ status: 'resolved', resolution: '' }).success,
    ).toBe(false);
    expect(
      ResolveReportRequestSchema.safeParse({
        status: 'resolved',
        resolution: 'Image removed',
      }).success,
    ).toBe(true);
  });

  it('takedown request requires a resolution', () => {
    expect(TakedownReportRequestSchema.safeParse({ resolution: '' }).success).toBe(false);
    expect(TakedownReportRequestSchema.safeParse({ resolution: 'Image removed' }).success).toBe(
      true,
    );
  });
});

describe('AdminReportsQuerySchema', () => {
  it('defaults limit to 20 with no filters', () => {
    const result = AdminReportsQuerySchema.parse({});
    expect(result.limit).toBe(20);
  });

  it('accepts status and target filters', () => {
    expect(
      AdminReportsQuerySchema.safeParse({
        status: 'open',
        targetType: 'portfolio_image',
        targetId: id,
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(AdminReportsQuerySchema.safeParse({ status: 'escalated' }).success).toBe(false);
  });
});

describe('AdminProvenanceCheckSchema', () => {
  const validCheck = {
    id,
    portfolioImageId: id,
    aiScore: 0.12,
    aiVendor: 'hive',
    reverseMatches: ['https://example.com/match.jpg'],
    c2paValid: true,
    exifCamera: 'Canon EOS R5',
    exifCapturedAt: '2026-08-01T10:00:00.000Z',
    score: 0.05,
    verdict: 'pass',
    reviewedByAdminId: null,
    reviewedAt: null,
    note: null,
  };

  it('accepts a well-formed provenance check', () => {
    expect(AdminProvenanceCheckSchema.safeParse(validCheck).success).toBe(true);
  });

  it('rejects an unknown verdict', () => {
    expect(AdminProvenanceCheckSchema.safeParse({ ...validCheck, verdict: 'maybe' }).success).toBe(
      false,
    );
  });
});

describe('AdminBookingSchema', () => {
  const validBooking = {
    id,
    quoteId: id,
    clientId: id,
    photographerId: id,
    scheduledAt: '2026-10-01T10:00:00.000Z',
    location: { lat: 49.6116, lng: 6.1319 },
    total: { amountCents: 150000, currency: 'EUR' },
    status: 'paid_held',
    releaseDueAt: '2026-10-08T10:00:00.000Z',
    deliveredAt: null,
    releasedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    paymentIntentId: 'pi_123',
    chargeId: 'ch_123',
    transferId: null,
  };

  it('accepts payment identifiers for finance admins', () => {
    expect(AdminBookingSchema.safeParse(validBooking).success).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(
      AdminBookingSchema.safeParse({ ...validBooking, stripeSecretKey: 'sk_live' }).success,
    ).toBe(false);
  });
});

describe('RefundBookingRequestSchema', () => {
  it('requires a positive amount and a reason', () => {
    expect(
      RefundBookingRequestSchema.safeParse({ amountCents: 0, reason: 'Client cancelled' }).success,
    ).toBe(false);
    expect(
      RefundBookingRequestSchema.safeParse({ amountCents: 5000, reason: 'Client cancelled' })
        .success,
    ).toBe(true);
  });
});

describe('PlatformSettingsSchema and UpdatePlatformSettingsRequestSchema', () => {
  const featureFlags = [{ key: 'maintenanceMode' as const, description: 'x', enabled: false }];

  it('accepts feePercent and autoReleaseDays within range', () => {
    expect(
      PlatformSettingsSchema.safeParse({ feePercent: 5, autoReleaseDays: 7, featureFlags }).success,
    ).toBe(true);
  });

  it('accepts a null feePercent, distinguishing unconfigured from a default', () => {
    expect(
      PlatformSettingsSchema.safeParse({ feePercent: null, autoReleaseDays: 7, featureFlags })
        .success,
    ).toBe(true);
  });

  it('rejects a feePercent outside 0..100', () => {
    expect(
      PlatformSettingsSchema.safeParse({ feePercent: 101, autoReleaseDays: 7, featureFlags })
        .success,
    ).toBe(false);
  });

  it('rejects an autoReleaseDays outside 1..60', () => {
    expect(
      PlatformSettingsSchema.safeParse({ feePercent: 5, autoReleaseDays: 61, featureFlags })
        .success,
    ).toBe(false);
  });

  it('accepts a partial update', () => {
    expect(UpdatePlatformSettingsRequestSchema.safeParse({ feePercent: 6 }).success).toBe(true);
  });

  it('rejects an update with an unknown feature flag key', () => {
    expect(
      UpdatePlatformSettingsRequestSchema.safeParse({
        featureFlags: [{ key: 'notARealFlag', enabled: true }],
      }).success,
    ).toBe(false);
  });

  it('rejects a repeated feature flag key in the same update', () => {
    expect(
      UpdateFeatureFlagsRequestSchema.safeParse([
        { key: 'maintenanceMode', enabled: true },
        { key: 'maintenanceMode', enabled: false },
      ]).success,
    ).toBe(false);
  });
});

describe('AdminCountrySchema and UpdateCountryRequestSchema', () => {
  it('accepts a full admin country row', () => {
    expect(
      AdminCountrySchema.safeParse({
        code: 'LU',
        name: 'Luxembourg',
        enabled: true,
        currency: 'EUR',
        vatRate: 17,
        defaultLocale: 'fr',
        accountCount: 42,
      }).success,
    ).toBe(true);
  });

  it('accepts a partial update naming only enabled', () => {
    expect(UpdateCountryRequestSchema.safeParse({ enabled: false }).success).toBe(true);
  });

  it('rejects an unknown field', () => {
    expect(UpdateCountryRequestSchema.safeParse({ code: 'LU' }).success).toBe(false);
  });
});

describe('AdminLegalTextVersionSchema, AdminCountryLegalTextsResponseSchema and PublishLegalTextRequestSchema', () => {
  it('accepts a published version', () => {
    expect(
      AdminLegalTextVersionSchema.safeParse({
        version: '1',
        kind: 'terms',
        locale: 'en',
        content: 'Terms of service.',
        publishedAt: '2026-01-01T00:00:00.000Z',
        publishedByAdminId: id,
      }).success,
    ).toBe(true);
  });

  it('accepts a history response with no versions yet', () => {
    expect(
      AdminCountryLegalTextsResponseSchema.safeParse({ countryCode: 'LU', versions: [] }).success,
    ).toBe(true);
  });

  it('rejects an empty content body when publishing', () => {
    expect(
      PublishLegalTextRequestSchema.safeParse({ kind: 'terms', locale: 'en', content: '' }).success,
    ).toBe(false);
  });
});

describe('RejectVerificationCaseRequestSchema', () => {
  it('accepts a reason within 1..1000 characters', () => {
    expect(
      RejectVerificationCaseRequestSchema.safeParse({ reason: 'Illegible document' }).success,
    ).toBe(true);
  });

  it('rejects an empty reason', () => {
    expect(RejectVerificationCaseRequestSchema.safeParse({ reason: '' }).success).toBe(false);
  });

  it('rejects a reason longer than 1000 characters', () => {
    expect(
      RejectVerificationCaseRequestSchema.safeParse({ reason: 'a'.repeat(1001) }).success,
    ).toBe(false);
  });
});

describe('AdminVerificationCasesQuerySchema', () => {
  it('defaults limit to 20 with no filters', () => {
    const result = AdminVerificationCasesQuerySchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.status).toBeUndefined();
    expect(result.countryCode).toBeUndefined();
  });

  it('accepts a status and countryCode filter', () => {
    expect(
      AdminVerificationCasesQuerySchema.safeParse({ status: 'submitted', countryCode: 'LU' })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(AdminVerificationCasesQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
  });
});
