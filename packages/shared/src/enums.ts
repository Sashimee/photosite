export const USER_ROLES = ['client', 'photographer', 'professional', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const PHOTOGRAPHER_CATEGORIES = [
  'wedding',
  'portrait',
  'event',
  'product',
  'real-estate',
  'corporate',
] as const;

export type PhotographerCategory = (typeof PHOTOGRAPHER_CATEGORIES)[number];

export const VERIFICATION_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const PORTFOLIO_IMAGE_STATUSES = [
  'processing',
  'pending_review',
  'approved',
  'flagged',
  'rejected',
] as const;

export type PortfolioImageStatus = (typeof PORTFOLIO_IMAGE_STATUSES)[number];

export const LICENCE_USAGES = ['personal', 'commercial', 'editorial', 'extended'] as const;

export type LicenceUsage = (typeof LICENCE_USAGES)[number];

export const REQUEST_STATUSES = ['open', 'quoted', 'booked', 'closed', 'cancelled'] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const BOOKING_STATUSES = [
  'pending_payment',
  'paid_held',
  'in_progress',
  'delivered',
  'released',
  'refunded',
  'disputed',
  'cancelled',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const LEDGER_ENTRY_TYPES = [
  'charge',
  'platform_fee',
  'transfer',
  'refund',
  'reversal',
  'payout',
] as const;

export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

// Our own simplified dispute lifecycle, not Stripe's full `dispute.status`
// enum (docs/PAYMENTS.md): `open` from `charge.dispute.created`, `won`/`lost`
// from `charge.dispute.closed`. No automatic refund or reversal follows a
// dispute; a human decides.
export const DISPUTE_STATUSES = ['open', 'won', 'lost'] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

export const CONVERSATION_TYPES = ['request', 'quote', 'booking', 'direct'] as const;

export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const ATTACHMENT_KINDS = ['image', 'pdf', 'other'] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const VIRUS_SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const;

export type VirusScanStatus = (typeof VIRUS_SCAN_STATUSES)[number];

export const UPLOAD_STATUSES = [
  'pending_upload',
  'uploaded',
  'scanning',
  'clean',
  'infected',
  'failed',
  'processed',
] as const;

export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const VERIFICATION_CASE_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'approved',
  'rejected',
  'expired',
] as const;

export type VerificationCaseStatus = (typeof VERIFICATION_CASE_STATUSES)[number];

export const PROVENANCE_VERDICTS = ['pass', 'review', 'fail'] as const;

export type ProvenanceVerdict = (typeof PROVENANCE_VERDICTS)[number];

export const DATA_REQUEST_TYPES = ['export', 'delete'] as const;

export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];

export const DATA_REQUEST_STATUSES = [
  'pending',
  'processing',
  'ready',
  'completed',
  'failed',
  'cancelled',
] as const;

export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

export const ADMIN_PERMISSIONS = [
  'support',
  'moderation',
  'verification',
  'finance',
  'superadmin',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_TARGET_TYPES = [
  'photographer_profile',
  'portfolio_image',
  'request',
  'job_offer',
] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;

export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const CONSENT_PURPOSES = ['analytics', 'ads', 'marketing'] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const AUDIT_ACTOR_TYPES = ['user', 'admin', 'system'] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['email', 'push', 'in_app'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TYPES = [
  'quote_received',
  'quote_accepted',
  'quote_declined',
  'quote_withdrawn',
  'quote_expired',
  'message_received',
  'verification_approved',
  'verification_rejected',
  'job_application_received',
  'job_application_status_changed',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const JOB_OFFER_STATUSES = ['draft', 'published', 'closed', 'expired'] as const;

export type JobOfferStatus = (typeof JOB_OFFER_STATUSES)[number];

export const JOB_APPLICATION_STATUSES = [
  'submitted',
  'shortlisted',
  'rejected',
  'withdrawn',
] as const;

export type JobApplicationStatus = (typeof JOB_APPLICATION_STATUSES)[number];

export const LISTING_KINDS = ['job_offer', 'featured_profile'] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];

// Free forever at launch (D8); 'paid' and 'featured' are switched on in
// Phase 3 without a schema change.
export const LISTING_PLANS = ['free', 'paid', 'featured'] as const;

export type ListingPlan = (typeof LISTING_PLANS)[number];

// Feature flags are booleans the admin can toggle at runtime, but the set of
// known flags is fixed here rather than free text, so a flag nothing reads
// or a typo'd key turning a live one off can't happen (docs/steps/1D.7-settings.md).
export const FEATURE_FLAG_KEYS = ['maintenanceMode', 'newSignupsPaused'] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
