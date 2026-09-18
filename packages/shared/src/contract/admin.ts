import {
  ADMIN_PERMISSIONS,
  PROVENANCE_VERDICTS,
  REPORT_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  VERIFICATION_CASE_STATUSES,
  type AdminPermission,
} from '../enums.js';
import { UserSchema } from './auth.js';
import { BookingBaseSchema } from './bookings.js';
import {
  CountryCodeSchema,
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  SlugSchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { ADMIN_SECURITY, apiPath, registry } from './registry.js';
import { AdminVerificationCaseSchema, AdminVerificationCaseSummarySchema } from './verification.js';
import { z } from './zod.js';

function adminOperation(permission?: AdminPermission, options?: { requires2fa?: boolean }) {
  return {
    ...(permission ? { 'x-required-permission': permission } : {}),
    ...(options?.requires2fa ? { 'x-requires-2fa': true } : {}),
  };
}

const AdminPhotographerProfileSummarySchema = z
  .object({
    slug: SlugSchema,
    isPublished: z.boolean(),
  })
  .strict()
  .openapi('AdminPhotographerProfileSummary');

// Admin-only: `name` defaults to the account's email local part (#140,
// apps/api/src/modules/chat/chat-mapper.ts) and must never reach another
// *user*, but an admin with `support` already sees the full email on the
// user detail page, so surfacing it here is not a new disclosure.
export const AdminUserSchema = UserSchema.extend({
  name: z.string().min(1).max(200).nullable(),
  photographerProfile: AdminPhotographerProfileSummarySchema.nullable(),
})
  .strict()
  .openapi('AdminUser');

export const AdminMeSchema = z
  .object({
    permissions: z.array(z.enum(ADMIN_PERMISSIONS)),
    twoFactorExpiresAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .openapi('AdminMe');

export const AdminUserSearchQuerySchema = z
  .object({
    q: z.string().min(1).max(200).optional(),
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const SuspendUserRequestSchema = z
  .object({
    reason: z.string().min(1).max(2000),
  })
  .strict();

export const SetUserRolesRequestSchema = z
  .object({
    roles: z
      .array(z.enum(USER_ROLES))
      .min(1)
      .refine((roles) => new Set(roles).size === roles.length, 'roles must be unique'),
  })
  .strict();

export const AdminReportSchema = z
  .object({
    id: IdSchema,
    reporterId: IdSchema.nullable(),
    targetType: z.string().min(1).max(60).openapi({ example: 'portfolio_image' }),
    targetId: IdSchema,
    reason: z.string().min(1).max(2000),
    status: z.enum(REPORT_STATUSES),
    adminId: IdSchema.nullable(),
    resolution: z.string().max(2000).nullable(),
  })
  .strict()
  .openapi('AdminReport');

export const AdminReportsQuerySchema = CursorPaginationQuerySchema.extend({
  status: z.enum(REPORT_STATUSES).optional(),
  targetType: z.string().min(1).max(60).optional(),
  targetId: IdSchema.optional(),
}).strict();

export const ResolveReportRequestSchema = z
  .object({
    status: z.enum(['resolved', 'dismissed']),
    resolution: z.string().min(1).max(2000),
  })
  .strict();

export const TakedownReportRequestSchema = z
  .object({
    resolution: z.string().min(1).max(2000),
  })
  .strict();

export const AdminProvenanceCheckSchema = z
  .object({
    id: IdSchema,
    portfolioImageId: IdSchema,
    aiScore: z.number().min(0).max(1).nullable(),
    aiVendor: z.string().min(1).max(60).nullable(),
    reverseMatches: z.array(z.url()).nullable(),
    c2paValid: z.boolean().nullable(),
    exifCamera: z.string().min(1).max(120).nullable(),
    exifCapturedAt: IsoDateTimeSchema.nullable(),
    score: z.number().min(0).max(1).nullable(),
    verdict: z.enum(PROVENANCE_VERDICTS),
    reviewedByAdminId: IdSchema.nullable(),
    reviewedAt: IsoDateTimeSchema.nullable(),
    note: z.string().max(2000).nullable(),
  })
  .strict()
  .openapi('AdminProvenanceCheck');

export const RejectProvenanceCheckRequestSchema = z
  .object({
    note: z.string().min(1).max(2000).optional(),
  })
  .strict();

export const AdminBookingSchema = BookingBaseSchema.extend({
  paymentIntentId: z.string().nullable(),
  chargeId: z.string().nullable(),
  transferId: z.string().nullable(),
})
  .strict()
  .openapi('AdminBooking');

export const RefundBookingRequestSchema = z
  .object({
    amountCents: z.int().positive(),
    reason: z.string().min(1).max(2000),
  })
  .strict();

export const ReverseBookingTransferRequestSchema = z
  .object({
    reason: z.string().min(1).max(2000),
  })
  .strict();

export const PlatformSettingsSchema = z
  .object({
    feePercent: z.number().min(0).max(100),
    autoReleaseDays: z.int().min(1).max(60),
  })
  .strict()
  .openapi('PlatformSettings');

export const UpdatePlatformSettingsRequestSchema = PlatformSettingsSchema.partial();

export const AdminAuditLogQuerySchema = z
  .object({
    actorId: IdSchema.optional(),
    entityType: z.string().min(1).max(60).optional(),
    targetId: IdSchema.optional(),
    from: IsoDateTimeSchema.optional(),
    to: IsoDateTimeSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const AdminAuditLogEntrySchema = z
  .object({
    id: IdSchema,
    actorId: IdSchema.nullable(),
    action: z.string().min(1).max(100),
    targetType: z.string().min(1).max(60),
    targetId: IdSchema.nullable(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    ip: z.string().min(1).max(64).nullable(),
    occurredAt: IsoDateTimeSchema,
  })
  .strict()
  .openapi('AdminAuditLogEntry');

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/me'),
  summary: "Get the caller's admin permissions and second-factor status",
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation(),
  responses: {
    '200': {
      description: "The caller's granted permissions and second-factor expiry",
      content: { 'application/json': { schema: AdminMeSchema } },
    },
    ...errorResponses([401, 403]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/users'),
  summary: 'Search users',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('support'),
  request: {
    query: AdminUserSearchQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of users',
      content: { 'application/json': { schema: paginatedResponseSchema(AdminUserSchema) } },
    },
    ...errorResponses([400, 401, 403, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/users/{id}'),
  summary: 'Get a user',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('support'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The user',
      content: { 'application/json': { schema: AdminUserSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/users/{id}/suspend'),
  summary: 'Suspend a user',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('support'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: SuspendUserRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'User suspended',
      content: { 'application/json': { schema: AdminUserSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/users/{id}/reactivate'),
  summary: 'Reactivate a suspended user',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('support'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'User reactivated',
      content: { 'application/json': { schema: AdminUserSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

registry.registerPath({
  method: 'put',
  path: apiPath('/admin/users/{id}/roles'),
  summary: "Set a user's roles",
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('superadmin'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: SetUserRolesRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Roles updated',
      content: { 'application/json': { schema: AdminUserSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 422]),
  },
});

export const AdminVerificationCasesQuerySchema = CursorPaginationQuerySchema.extend({
  status: z.enum(VERIFICATION_CASE_STATUSES).optional(),
  countryCode: CountryCodeSchema.optional(),
}).strict();

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/verification-cases'),
  summary: 'List the verification queue',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('verification', { requires2fa: true }),
  request: {
    query: AdminVerificationCasesQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of verification cases',
      content: {
        'application/json': { schema: paginatedResponseSchema(AdminVerificationCaseSummarySchema) },
      },
    },
    ...errorResponses([400, 401, 403, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/verification-cases/{id}'),
  summary: 'Get a verification case',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('verification', { requires2fa: true }),
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The verification case',
      content: { 'application/json': { schema: AdminVerificationCaseSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/verification-cases/{id}/start-review'),
  summary: 'Start reviewing a verification case',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('verification', { requires2fa: true }),
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Verification case moved to in_review',
      content: { 'application/json': { schema: AdminVerificationCaseSummarySchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/verification-cases/{id}/approve'),
  summary: 'Approve a verification case',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('verification', { requires2fa: true }),
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Verification case approved',
      content: { 'application/json': { schema: AdminVerificationCaseSummarySchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

export const RejectVerificationCaseRequestSchema = z
  .object({
    reason: z.string().min(1).max(1000),
  })
  .strict();

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/verification-cases/{id}/reject'),
  summary: 'Reject a verification case',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('verification', { requires2fa: true }),
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: RejectVerificationCaseRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Verification case rejected',
      content: { 'application/json': { schema: AdminVerificationCaseSummarySchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/provenance-checks'),
  summary: 'List the provenance review queue',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('moderation'),
  request: {
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of provenance checks',
      content: {
        'application/json': { schema: paginatedResponseSchema(AdminProvenanceCheckSchema) },
      },
    },
    ...errorResponses([401, 403]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/provenance-checks/{id}'),
  summary: 'Get a provenance check',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('moderation'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The provenance check',
      content: { 'application/json': { schema: AdminProvenanceCheckSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/provenance-checks/{id}/approve'),
  summary: 'Approve a flagged portfolio image',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('moderation'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'Provenance check approved',
      content: { 'application/json': { schema: AdminProvenanceCheckSchema } },
    },
    ...errorResponses([401, 403, 404, 409]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/provenance-checks/{id}/reject'),
  summary: 'Reject a flagged portfolio image',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('moderation'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: RejectProvenanceCheckRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Provenance check rejected',
      content: { 'application/json': { schema: AdminProvenanceCheckSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/bookings'),
  summary: 'List bookings',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('finance'),
  request: {
    query: CursorPaginationQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of bookings',
      content: { 'application/json': { schema: paginatedResponseSchema(AdminBookingSchema) } },
    },
    ...errorResponses([401, 403]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/bookings/{id}'),
  summary: 'Get a booking',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('finance'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
  },
  responses: {
    '200': {
      description: 'The booking',
      content: { 'application/json': { schema: AdminBookingSchema } },
    },
    ...errorResponses([401, 403, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/bookings/{id}/refund'),
  summary: 'Refund a booking',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('finance', { requires2fa: true }),
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: RefundBookingRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Booking refunded',
      content: { 'application/json': { schema: AdminBookingSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/bookings/{id}/reverse-transfer'),
  summary: 'Reverse the payout transfer for a booking',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('finance', { requires2fa: true }),
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: ReverseBookingTransferRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Transfer reversed',
      content: { 'application/json': { schema: AdminBookingSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/reports'),
  summary: 'List reports',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('moderation'),
  request: {
    query: AdminReportsQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of reports',
      content: { 'application/json': { schema: paginatedResponseSchema(AdminReportSchema) } },
    },
    ...errorResponses([400, 401, 403, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/reports/{id}/resolve'),
  summary: 'Resolve a report',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('moderation'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: ResolveReportRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Report resolved',
      content: { 'application/json': { schema: AdminReportSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'post',
  path: apiPath('/admin/reports/{id}/takedown'),
  summary: 'Resolve a report by taking down its target',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('moderation'),
  request: {
    params: z.object({ id: IdSchema }).strict(),
    body: { content: { 'application/json': { schema: TakedownReportRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Report resolved and its target taken down',
      content: { 'application/json': { schema: AdminReportSchema } },
    },
    ...errorResponses([400, 401, 403, 404, 409, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/settings'),
  summary: 'Get platform settings',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('superadmin'),
  responses: {
    '200': {
      description: 'The platform settings',
      content: { 'application/json': { schema: PlatformSettingsSchema } },
    },
    ...errorResponses([401, 403]),
  },
});

registry.registerPath({
  method: 'patch',
  path: apiPath('/admin/settings'),
  summary: 'Update platform settings',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('superadmin'),
  request: {
    body: { content: { 'application/json': { schema: UpdatePlatformSettingsRequestSchema } } },
  },
  responses: {
    '200': {
      description: 'Platform settings updated',
      content: { 'application/json': { schema: PlatformSettingsSchema } },
    },
    ...errorResponses([400, 401, 403, 422]),
  },
});

registry.registerPath({
  method: 'get',
  path: apiPath('/admin/audit-log'),
  summary: 'Query the audit log',
  tags: ['admin'],
  security: ADMIN_SECURITY,
  ...adminOperation('superadmin'),
  request: {
    query: AdminAuditLogQuerySchema,
  },
  responses: {
    '200': {
      description: 'A page of audit log entries',
      content: {
        'application/json': { schema: paginatedResponseSchema(AdminAuditLogEntrySchema) },
      },
    },
    ...errorResponses([400, 401, 403, 422]),
  },
});
