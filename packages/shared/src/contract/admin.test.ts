import { describe, expect, it } from 'vitest';
import {
  AdminBookingDetailSchema,
  AdminBookingSchema,
  AdminBookingsExportQuerySchema,
  AdminBookingsQuerySchema,
  AdminCountryLegalTextsResponseSchema,
  AdminCountrySchema,
  AdminDataRequestSchema,
  AdminDataRequestsQuerySchema,
  AdminEmailTemplatePreviewQuerySchema,
  AdminLegalTextVersionSchema,
  AdminLogDataRequestBodySchema,
  AdminReportSchema,
  AdminReportsQuerySchema,
  AdminRefundConflictErrorSchema,
  AdminReverseTransferConflictErrorSchema,
  AdminUserSearchQuerySchema,
  AdminVerificationCasesQuerySchema,
  DirectTakedownRequestSchema,
  EmailTemplateNameSchema,
  PlatformSettingsSchema,
  PublishLegalTextRequestSchema,
  RefundBookingRequestSchema,
  RejectVerificationCaseRequestSchema,
  ResolveReportRequestSchema,
  ReverseBookingTransferRequestSchema,
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
    refundedCents: 0,
    reversedCents: 0,
    refundableCents: 0,
    reversibleCents: 0,
    disputeStatus: null,
  };

  it('accepts payment identifiers for finance admins', () => {
    expect(AdminBookingSchema.safeParse(validBooking).success).toBe(true);
  });

  it('accepts a disputed booking with refunds and reversals', () => {
    expect(
      AdminBookingSchema.safeParse({
        ...validBooking,
        status: 'disputed',
        refundedCents: 5000,
        reversedCents: 4750,
        disputeStatus: 'open',
      }).success,
    ).toBe(true);
  });

  it('rejects negative ledger sums and unknown dispute statuses', () => {
    expect(AdminBookingSchema.safeParse({ ...validBooking, refundedCents: -1 }).success).toBe(
      false,
    );
    expect(AdminBookingSchema.safeParse({ ...validBooking, reversedCents: 1.5 }).success).toBe(
      false,
    );
    expect(
      AdminBookingSchema.safeParse({ ...validBooking, disputeStatus: 'pending' }).success,
    ).toBe(false);
    expect(AdminBookingSchema.safeParse({ ...validBooking, refundableCents: -1 }).success).toBe(
      false,
    );
  });

  it('requires the server-computed money hints', () => {
    const withoutHint: Partial<typeof validBooking> = { ...validBooking };
    delete withoutHint.refundableCents;
    expect(AdminBookingSchema.safeParse(withoutHint).success).toBe(false);
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

  it('accepts a non-negative integer expectedRefundedCents only', () => {
    const base = { amountCents: 5000, reason: 'Client cancelled' };
    expect(
      RefundBookingRequestSchema.safeParse({ ...base, expectedRefundedCents: 0 }).success,
    ).toBe(true);
    expect(
      RefundBookingRequestSchema.safeParse({ ...base, expectedRefundedCents: -1 }).success,
    ).toBe(false);
    expect(
      RefundBookingRequestSchema.safeParse({ ...base, expectedRefundedCents: 1.5 }).success,
    ).toBe(false);
  });
});

describe('ReverseBookingTransferRequestSchema', () => {
  it('accepts a non-negative integer expectedReversedCents only', () => {
    expect(
      ReverseBookingTransferRequestSchema.safeParse({ reason: 'Chargeback lost' }).success,
    ).toBe(true);
    expect(
      ReverseBookingTransferRequestSchema.safeParse({
        reason: 'Chargeback lost',
        expectedReversedCents: 4750,
      }).success,
    ).toBe(true);
    expect(
      ReverseBookingTransferRequestSchema.safeParse({
        reason: 'Chargeback lost',
        expectedReversedCents: -5,
      }).success,
    ).toBe(false);
  });
});

describe('AdminBookingsQuerySchema', () => {
  it('normalises one or several statuses to a sorted, de-duplicated array', () => {
    expect(AdminBookingsQuerySchema.parse({ status: 'released' }).status).toEqual(['released']);
    expect(
      AdminBookingsQuerySchema.parse({ status: ['released', 'disputed', 'released'] }).status,
    ).toEqual(['disputed', 'released']);
    expect(AdminBookingsQuerySchema.parse({}).status).toBeUndefined();
  });

  it('rejects an unknown status, dispute filter or key', () => {
    expect(AdminBookingsQuerySchema.safeParse({ status: 'paid' }).success).toBe(false);
    expect(AdminBookingsQuerySchema.safeParse({ status: ['released', 'paid'] }).success).toBe(
      false,
    );
    expect(AdminBookingsQuerySchema.safeParse({ status: [] }).success).toBe(false);
    expect(AdminBookingsQuerySchema.safeParse({ dispute: 'closed' }).success).toBe(false);
    expect(AdminBookingsQuerySchema.safeParse({ clientId: id }).success).toBe(false);
  });

  it('accepts each dispute filter', () => {
    for (const dispute of ['any', 'open', 'none']) {
      expect(AdminBookingsQuerySchema.safeParse({ dispute }).success).toBe(true);
    }
  });

  it('accepts a half-open date range up to 366 days', () => {
    expect(
      AdminBookingsQuerySchema.safeParse({ createdFrom: '2026-10-01', createdTo: '2026-10-02' })
        .success,
    ).toBe(true);
    expect(
      AdminBookingsQuerySchema.safeParse({ createdFrom: '2026-01-01', createdTo: '2027-01-02' })
        .success,
    ).toBe(true);
  });

  it('rejects an empty, inverted, too long, half-given or non-date range', () => {
    const invalid = [
      { createdFrom: '2026-10-01', createdTo: '2026-10-01' },
      { createdFrom: '2026-10-02', createdTo: '2026-10-01' },
      { createdFrom: '2026-01-01', createdTo: '2027-01-03' },
      { createdFrom: '2026-10-01' },
      { createdTo: '2026-10-01' },
      { createdFrom: '2026-10-01T00:00:00Z', createdTo: '2026-10-02T00:00:00Z' },
      { createdFrom: '2026-02-30', createdTo: '2026-03-02' },
    ];
    for (const query of invalid) {
      expect(AdminBookingsQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe('AdminBookingsExportQuerySchema', () => {
  it('takes the list filters with the same rules', () => {
    expect(
      AdminBookingsExportQuerySchema.parse({
        status: ['released', 'disputed'],
        createdFrom: '2026-10-01',
        createdTo: '2026-11-01',
        dispute: 'open',
      }),
    ).toEqual({
      status: ['disputed', 'released'],
      createdFrom: '2026-10-01',
      createdTo: '2026-11-01',
      dispute: 'open',
    });
    expect(AdminBookingsExportQuerySchema.parse({})).toEqual({});
    expect(AdminBookingsExportQuerySchema.safeParse({ createdFrom: '2026-10-01' }).success).toBe(
      false,
    );
    expect(
      AdminBookingsExportQuerySchema.safeParse({
        createdFrom: '2026-01-01',
        createdTo: '2027-01-03',
      }).success,
    ).toBe(false);
    expect(AdminBookingsExportQuerySchema.safeParse({ status: 'paid' }).success).toBe(false);
  });

  it('rejects paging parameters', () => {
    expect(AdminBookingsExportQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(false);
    expect(AdminBookingsExportQuerySchema.safeParse({ limit: '10' }).success).toBe(false);
  });
});

describe('admin refund and reverse-transfer conflicts', () => {
  const requestId = id;

  it('tells the 409 codes apart with their details', () => {
    expect(
      AdminRefundConflictErrorSchema.parse({
        code: 'BOOKING_STATE',
        message: 'm',
        details: { status: 'paid_held' },
        requestId,
      }),
    ).toMatchObject({ details: { status: 'paid_held' } });
    expect(
      AdminRefundConflictErrorSchema.parse({
        code: 'PENDING_REVERSAL_MISMATCH',
        message: 'm',
        details: { pendingCents: 3000 },
        requestId,
      }),
    ).toMatchObject({ details: { pendingCents: 3000 } });
    for (const code of ['BOOKING_BUSY', 'LEDGER_CHANGED']) {
      expect(
        AdminRefundConflictErrorSchema.safeParse({ code, message: 'm', requestId }).success,
      ).toBe(true);
    }
  });

  it('requires the details each code carries', () => {
    expect(
      AdminRefundConflictErrorSchema.safeParse({ code: 'BOOKING_STATE', message: 'm', requestId })
        .success,
    ).toBe(false);
    expect(
      AdminRefundConflictErrorSchema.safeParse({
        code: 'PENDING_REVERSAL_MISMATCH',
        message: 'm',
        details: { pendingCents: 0 },
        requestId,
      }).success,
    ).toBe(false);
    expect(
      AdminRefundConflictErrorSchema.safeParse({ code: 'CONFLICT', message: 'm', requestId })
        .success,
    ).toBe(false);
  });

  it('never answers a reverse-transfer with a pending reversal mismatch', () => {
    expect(
      AdminReverseTransferConflictErrorSchema.safeParse({
        code: 'PENDING_REVERSAL_MISMATCH',
        message: 'm',
        details: { pendingCents: 3000 },
        requestId,
      }).success,
    ).toBe(false);
  });
});

describe('AdminBookingDetailSchema', () => {
  const booking = {
    id,
    quoteId: id,
    clientId: id,
    photographerId: id,
    scheduledAt: null,
    location: null,
    total: { amountCents: 25050, currency: 'EUR' },
    status: 'released',
    releaseDueAt: null,
    deliveredAt: null,
    releasedAt: '2026-10-08T10:00:00.000Z',
    cancelledAt: null,
    cancellationReason: null,
    paymentIntentId: 'pi_1',
    chargeId: 'ch_1',
    transferId: 'tr_1',
    refundedCents: 0,
    reversedCents: 0,
    refundableCents: 23797,
    reversibleCents: 23797,
    disputeStatus: 'won',
  };
  const entry = {
    id,
    type: 'transfer',
    amountCents: -23797,
    currency: 'EUR',
    stripeObjectId: 'tr_1',
    occurredAt: '2026-10-08T10:00:00.000Z',
  };
  const dispute = {
    id,
    status: 'won',
    reason: 'fraudulent',
    resolution: null,
    amountRefundedCents: null,
    openedById: id,
    adminId: null,
    openedAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
  };
  const detail = {
    ...booking,
    ledger: [entry],
    ledgerTruncated: false,
    disputes: [dispute],
    payout: {
      stripeAccountId: 'acct_1',
      onboardingComplete: true,
      payoutsEnabled: true,
      entries: [],
    },
  };

  it('accepts signed ledger rows, disputes and a payout block', () => {
    expect(AdminBookingDetailSchema.safeParse(detail).success).toBe(true);
    expect(AdminBookingDetailSchema.safeParse({ ...detail, payout: null }).success).toBe(true);
  });

  it('rejects a ledger longer than the cap', () => {
    expect(
      AdminBookingDetailSchema.safeParse({
        ...detail,
        ledger: Array.from({ length: 201 }, () => entry),
        ledgerTruncated: true,
      }).success,
    ).toBe(false);
  });

  it('rejects names or emails on a dispute', () => {
    expect(
      AdminBookingDetailSchema.safeParse({
        ...detail,
        disputes: [{ ...dispute, openedByEmail: 'client@example.com' }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown ledger type', () => {
    expect(
      AdminBookingDetailSchema.safeParse({ ...detail, ledger: [{ ...entry, type: 'fee' }] })
        .success,
    ).toBe(false);
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

  it('accepts a feePercent with two decimals and rejects a third', () => {
    expect(
      PlatformSettingsSchema.safeParse({ feePercent: 7.35, autoReleaseDays: 7, featureFlags })
        .success,
    ).toBe(true);
    expect(UpdatePlatformSettingsRequestSchema.safeParse({ feePercent: 5.05 }).success).toBe(true);
    expect(UpdatePlatformSettingsRequestSchema.safeParse({ feePercent: 12.345 }).success).toBe(
      false,
    );
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
    channel: 'in_app',
    requestedAt: '2026-08-01T10:00:00.000Z',
    receivedAt: '2026-08-01T10:00:00.000Z',
    completedAt: null,
    expiresAt: null,
    failureReason: null,
    cancelledAt: null,
    responseDueAt: null,
    answeredLate: false,
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

  it('accepts an export answered late', () => {
    expect(AdminDataRequestSchema.safeParse({ ...validRequest, answeredLate: true }).success).toBe(
      true,
    );
  });

  it('rejects a missing answeredLate', () => {
    const withoutAnsweredLate: Partial<typeof validRequest> = { ...validRequest };
    delete withoutAnsweredLate.answeredLate;
    expect(AdminDataRequestSchema.safeParse(withoutAnsweredLate).success).toBe(false);
  });

  it('rejects a non-boolean answeredLate', () => {
    expect(
      AdminDataRequestSchema.safeParse({ ...validRequest, answeredLate: 'true' }).success,
    ).toBe(false);
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

  it('accepts a channel filter', () => {
    expect(AdminDataRequestsQuerySchema.safeParse({ channel: 'support' }).success).toBe(true);
  });

  it('rejects an unknown channel', () => {
    expect(AdminDataRequestsQuerySchema.safeParse({ channel: 'phone' }).success).toBe(false);
  });
});

describe('AdminLogDataRequestBodySchema', () => {
  const validBody = {
    userId: id,
    type: 'export',
    channel: 'support',
    receivedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  };

  it('accepts a well-formed body', () => {
    expect(AdminLogDataRequestBodySchema.safeParse(validBody).success).toBe(true);
  });

  it('accepts the email channel', () => {
    expect(
      AdminLogDataRequestBodySchema.safeParse({ ...validBody, channel: 'email' }).success,
    ).toBe(true);
  });

  it('accepts the support channel', () => {
    expect(
      AdminLogDataRequestBodySchema.safeParse({ ...validBody, channel: 'support' }).success,
    ).toBe(true);
  });

  it('rejects the in_app channel', () => {
    expect(
      AdminLogDataRequestBodySchema.safeParse({ ...validBody, channel: 'in_app' }).success,
    ).toBe(false);
  });

  it('rejects an unknown channel', () => {
    expect(
      AdminLogDataRequestBodySchema.safeParse({ ...validBody, channel: 'phone' }).success,
    ).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(AdminLogDataRequestBodySchema.safeParse({ ...validBody, type: 'wipe' }).success).toBe(
      false,
    );
  });

  it('rejects a non-uuid userId', () => {
    expect(
      AdminLogDataRequestBodySchema.safeParse({ ...validBody, userId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects a non-ISO receivedAt', () => {
    expect(
      AdminLogDataRequestBodySchema.safeParse({ ...validBody, receivedAt: '2026-08-01' }).success,
    ).toBe(false);
  });

  it('rejects a missing receivedAt', () => {
    const withoutReceivedAt: Partial<typeof validBody> = { ...validBody };
    delete withoutReceivedAt.receivedAt;
    expect(AdminLogDataRequestBodySchema.safeParse(withoutReceivedAt).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(AdminLogDataRequestBodySchema.safeParse({ ...validBody, ip: '127.0.0.1' }).success).toBe(
      false,
    );
  });

  // The 1-minute future skew and 30-day past bounds are enforced in
  // AdminDataRequestsService.logOffline (apps/api/src/modules/admin/admin-data-requests.service.ts),
  // not by this schema, so they are covered by the API integration suite instead.
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
