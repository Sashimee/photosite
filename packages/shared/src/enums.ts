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

export const CONVERSATION_TYPES = ['request', 'quote', 'booking', 'direct'] as const;

export type ConversationType = (typeof CONVERSATION_TYPES)[number];

export const ATTACHMENT_KINDS = ['image', 'pdf', 'other'] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const VIRUS_SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const;

export type VirusScanStatus = (typeof VIRUS_SCAN_STATUSES)[number];

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

export const DATA_REQUEST_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

export const ADMIN_PERMISSIONS = [
  'support',
  'moderation',
  'verification',
  'finance',
  'superadmin',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
