import { describe, expect, it } from 'vitest';
import {
  AdminBookingSchema,
  AdminCountryLegalTextsResponseSchema,
  AdminCountrySchema,
  AdminDataRequestSchema,
  AdminDataRequestsQuerySchema,
  AdminEmailTemplatePreviewQuerySchema,
  AdminLegalTextVersionSchema,
  AdminProvenanceCheckSchema,
  AdminReportSchema,
  AdminReportsQuerySchema,
  AdminUserSearchQuerySchema,
  AdminVerificationCasesQuerySchema,
  DirectTakedownRequestSchema,
  EmailTemplateNameSchema,
  PlatformSettingsSchema,
  PublishLegalTextRequestSchema,
  RefundBookingRequestSchema,
  RejectVerificationCaseRequestSchema,
  ResolveReportRequestSchema,
  RestoreReportRequestSchema,
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
    createdAt: '2026-08-01T10:00:00.000Z',
    resolvedAt: null,
    target: {
      targetType: 'portfolio_image',
      url: 'https://cdn.photoo.lu/portfolio/abc123.jpg',
      width: 1600,
      height: 900,
      status: 'approved',
      deletedAt: null,
    },
  };

  it('accepts a well-formed report', () => {
    expect(AdminReportSchema.safeParse(validReport).success).toBe(true);
  });

  it('accepts a null reporterId for an anonymous notice', () => {
    expect(AdminReportSchema.safeParse({ ...validReport, reporterId: null }).success).toBe(true);
  });

  it('accepts a null target when the reported row is gone', () => {
    expect(AdminReportSchema.safeParse({ ...validReport, target: null }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(AdminReportSchema.safeParse({ ...validReport, status: 'escalated' }).success).toBe(
      false,
    );
  });

  it('accepts every target variant', () => {
    const variants = [
      {
        targetType: 'photographer_profile',
        displayName: 'Jane Doe',
        slug: 'jane-doe',
        isPublished: true,
        deletedAt: null,
      },
      {
        targetType: 'portfolio_image',
        url: null,
        width: null,
        height: null,
        status: 'processing',
        deletedAt: null,
      },
      {
        targetType: 'request',
        title: 'Wedding photographer needed',
        description: 'Looking for a photographer for our wedding',
        deletedAt: null,
      },
      {
        targetType: 'job_offer',
        title: 'Studio assistant',
        description: 'Part-time studio assistant',
        companyName: 'Studio Doe',
        deletedAt: '2026-08-02T10:00:00.000Z',
      },
      {
        targetType: 'job_application',
        message: '',
        jobOfferTitle: 'Studio assistant',
        deletedAt: null,
      },
    ];
    for (const target of variants) {
      expect(AdminReportSchema.safeParse({ ...validReport, target }).success).toBe(true);
    }
  });

  it('rejects a target with an unknown targetType', () => {
    expect(
      AdminReportSchema.safeParse({ ...validReport, target: { targetType: 'user' } }).success,
    ).toBe(false);
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

  it('restore request requires a resolution', () => {
    expect(RestoreReportRequestSchema.safeParse({ resolution: '' }).success).toBe(false);
    expect(RestoreReportRequestSchema.safeParse({ resolution: 'Wrongly removed' }).success).toBe(
      true,
    );
  });
});

describe('DirectTakedownRequestSchema', () => {
  it('accepts a photographer_profile or job_offer target with a resolution', () => {
    expect(
      DirectTakedownRequestSchema.safeParse({
        targetType: 'photographer_profile',
        targetId: id,
        resolution: 'Confirmed impersonation, profile removed',
      }).success,
    ).toBe(true);
    expect(
      DirectTakedownRequestSchema.safeParse({
        targetType: 'job_offer',
        targetId: id,
        resolution: 'Confirmed fraud, offer removed',
      }).success,
    ).toBe(true);
  });

  it('rejects a target type outside the two named entry points', () => {
    expect(
      DirectTakedownRequestSchema.safeParse({
        targetType: 'portfolio_image',
        targetId: id,
        resolution: 'Removed',
      }).success,
    ).toBe(false);
  });

  it('requires a resolution', () => {
    expect(
      DirectTakedownRequestSchema.safeParse({
        targetType: 'photographer_profile',
        targetId: id,
        resolution: '',
      }).success,
    ).toBe(false);
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

describe('AdminDataRequestSchema', () => {
  const validRequest = {
    id,
    type: 'delete',
    status: 'pending',
    requestedAt: '2026-08-01T10:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    failureReason: null,
    cancelledAt: null,
    responseDueAt: null,
    user: { id, email: 'user@example.com' },
  };

  it('accepts a well-formed data request', () => {
    expect(AdminDataRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it('accepts an export with a responseDueAt', () => {
    expect(
      AdminDataRequestSchema.safeParse({
        ...validRequest,
        type: 'export',
        responseDueAt: '2026-09-01T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a missing responseDueAt', () => {
    const withoutResponseDueAt: Partial<typeof validRequest> = { ...validRequest };
    delete withoutResponseDueAt.responseDueAt;
    expect(AdminDataRequestSchema.safeParse(withoutResponseDueAt).success).toBe(false);
  });

  it('rejects an exportKey field', () => {
    expect(
      AdminDataRequestSchema.safeParse({ ...validRequest, exportKey: 'private/key.zip' }).success,
    ).toBe(false);
  });

  it('rejects a null user', () => {
    expect(AdminDataRequestSchema.safeParse({ ...validRequest, user: null }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(AdminDataRequestSchema.safeParse({ ...validRequest, status: 'archived' }).success).toBe(
      false,
    );
  });
});

describe('AdminDataRequestsQuerySchema', () => {
  it('defaults limit to 20 with no filters', () => {
    const result = AdminDataRequestsQuerySchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.status).toBeUndefined();
    expect(result.type).toBeUndefined();
    expect(result.userId).toBeUndefined();
  });

  it('accepts status, type and userId filters', () => {
    expect(
      AdminDataRequestsQuerySchema.safeParse({ status: 'pending', type: 'delete', userId: id })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(AdminDataRequestsQuerySchema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(AdminDataRequestsQuerySchema.safeParse({ type: 'wipe' }).success).toBe(false);
  });
});

describe('EmailTemplateNameSchema', () => {
  it('accepts a known template name', () => {
    expect(EmailTemplateNameSchema.safeParse('verify-email').success).toBe(true);
  });

  it('rejects an unknown template name', () => {
    expect(EmailTemplateNameSchema.safeParse('not_a_template').success).toBe(false);
  });

  it('rejects a path-traversal-ish template value', () => {
    expect(EmailTemplateNameSchema.safeParse('../../etc/passwd').success).toBe(false);
  });

  it('rejects an empty template value', () => {
    expect(EmailTemplateNameSchema.safeParse('').success).toBe(false);
  });
});

describe('AdminEmailTemplatePreviewQuerySchema', () => {
  it('accepts a supported locale', () => {
    expect(AdminEmailTemplatePreviewQuerySchema.safeParse({ locale: 'fr' }).success).toBe(true);
  });

  it('rejects a missing locale', () => {
    expect(AdminEmailTemplatePreviewQuerySchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unsupported locale', () => {
    expect(AdminEmailTemplatePreviewQuerySchema.safeParse({ locale: 'xx' }).success).toBe(false);
  });

  it('rejects a garbage locale value', () => {
    expect(AdminEmailTemplatePreviewQuerySchema.safeParse({ locale: '<script>' }).success).toBe(
      false,
    );
  });

  it('rejects unknown query keys', () => {
    expect(
      AdminEmailTemplatePreviewQuerySchema.safeParse({ locale: 'en', extra: 'x' }).success,
    ).toBe(false);
  });
});
