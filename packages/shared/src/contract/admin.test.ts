import { describe, expect, it } from 'vitest';
import {
  AdminBookingSchema,
  AdminProvenanceCheckSchema,
  AdminReportSchema,
  AdminUserSearchQuerySchema,
  PlatformSettingsSchema,
  RefundBookingRequestSchema,
  ResolveReportRequestSchema,
  SetUserRolesRequestSchema,
  SuspendUserRequestSchema,
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
  it('accepts feePercent and autoReleaseDays within range', () => {
    expect(PlatformSettingsSchema.safeParse({ feePercent: 5, autoReleaseDays: 7 }).success).toBe(
      true,
    );
  });

  it('rejects a feePercent outside 0..100', () => {
    expect(PlatformSettingsSchema.safeParse({ feePercent: 101, autoReleaseDays: 7 }).success).toBe(
      false,
    );
  });

  it('rejects an autoReleaseDays outside 1..60', () => {
    expect(PlatformSettingsSchema.safeParse({ feePercent: 5, autoReleaseDays: 61 }).success).toBe(
      false,
    );
  });

  it('accepts a partial update', () => {
    expect(UpdatePlatformSettingsRequestSchema.safeParse({ feePercent: 6 }).success).toBe(true);
  });
});
