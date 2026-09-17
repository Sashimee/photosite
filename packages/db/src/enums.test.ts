import {
  AUDIT_ACTOR_TYPES,
  CONSENT_PURPOSES,
  CONVERSATION_TYPES,
  DEVICE_PLATFORMS,
  LICENCE_USAGES,
  NOTIFICATION_CHANNELS,
  PHOTOGRAPHER_CATEGORIES,
  PORTFOLIO_IMAGE_STATUSES,
  QUOTE_STATUSES,
  REQUEST_STATUSES,
  SUPPORTED_LOCALES,
  UPLOAD_PURPOSES,
  UPLOAD_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  VERIFICATION_STATUSES,
  VIRUS_SCAN_STATUSES,
} from '@photoo/shared';
import { describe, expect, it } from 'vitest';
import {
  AuditActorType,
  ConsentPurpose,
  ConversationType,
  DevicePlatform,
  LicenceUsage,
  Locale,
  NotificationChannel,
  PhotographerCategory,
  PortfolioImageStatus,
  QuoteStatus,
  RequestStatus,
  UploadPurpose,
  UploadStatus,
  UserRole,
  UserStatus,
  VerificationStatus,
  VirusScanStatus,
} from './index.js';

describe('Prisma enums mirror packages/shared enums', () => {
  it('Locale matches SUPPORTED_LOCALES', () => {
    expect(Object.values(Locale).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('UserRole matches USER_ROLES', () => {
    expect(Object.values(UserRole).sort()).toEqual([...USER_ROLES].sort());
  });

  it('UserStatus matches USER_STATUSES', () => {
    expect(Object.values(UserStatus).sort()).toEqual([...USER_STATUSES].sort());
  });

  it('DevicePlatform matches DEVICE_PLATFORMS', () => {
    expect(Object.values(DevicePlatform).sort()).toEqual([...DEVICE_PLATFORMS].sort());
  });

  it('ConsentPurpose matches CONSENT_PURPOSES', () => {
    expect(Object.values(ConsentPurpose).sort()).toEqual([...CONSENT_PURPOSES].sort());
  });

  it('AuditActorType matches AUDIT_ACTOR_TYPES', () => {
    expect(Object.values(AuditActorType).sort()).toEqual([...AUDIT_ACTOR_TYPES].sort());
  });

  it('NotificationChannel matches NOTIFICATION_CHANNELS', () => {
    expect(Object.values(NotificationChannel).sort()).toEqual([...NOTIFICATION_CHANNELS].sort());
  });

  it('UploadPurpose matches UPLOAD_PURPOSES', () => {
    expect(Object.values(UploadPurpose).sort()).toEqual([...UPLOAD_PURPOSES].sort());
  });

  it('UploadStatus matches UPLOAD_STATUSES', () => {
    expect(Object.values(UploadStatus).sort()).toEqual([...UPLOAD_STATUSES].sort());
  });

  it('VirusScanStatus matches VIRUS_SCAN_STATUSES', () => {
    expect(Object.values(VirusScanStatus).sort()).toEqual([...VIRUS_SCAN_STATUSES].sort());
  });

  // Prisma enum values can't contain a hyphen, so 'real-estate' is mapped to
  // the `real_estate` identifier (schema.prisma `@map`) and stored as
  // 'real-estate' in Postgres; only the Prisma Client-facing name differs.
  it('PhotographerCategory matches PHOTOGRAPHER_CATEGORIES', () => {
    const dbFacing = Object.values(PhotographerCategory).map((value) => value.replace('_', '-'));
    expect(dbFacing.sort()).toEqual([...PHOTOGRAPHER_CATEGORIES].sort());
  });

  it('VerificationStatus matches VERIFICATION_STATUSES', () => {
    expect(Object.values(VerificationStatus).sort()).toEqual([...VERIFICATION_STATUSES].sort());
  });

  it('PortfolioImageStatus matches PORTFOLIO_IMAGE_STATUSES', () => {
    expect(Object.values(PortfolioImageStatus).sort()).toEqual(
      [...PORTFOLIO_IMAGE_STATUSES].sort(),
    );
  });

  it('LicenceUsage matches LICENCE_USAGES', () => {
    expect(Object.values(LicenceUsage).sort()).toEqual([...LICENCE_USAGES].sort());
  });

  it('RequestStatus matches REQUEST_STATUSES', () => {
    expect(Object.values(RequestStatus).sort()).toEqual([...REQUEST_STATUSES].sort());
  });

  it('QuoteStatus matches QUOTE_STATUSES', () => {
    expect(Object.values(QuoteStatus).sort()).toEqual([...QUOTE_STATUSES].sort());
  });

  it('ConversationType matches CONVERSATION_TYPES', () => {
    expect(Object.values(ConversationType).sort()).toEqual([...CONVERSATION_TYPES].sort());
  });
});
