import {
  AUDIT_ACTOR_TYPES,
  CONSENT_PURPOSES,
  DEVICE_PLATFORMS,
  NOTIFICATION_CHANNELS,
  SUPPORTED_LOCALES,
  UPLOAD_PURPOSES,
  UPLOAD_STATUSES,
  USER_ROLES,
  USER_STATUSES,
  VIRUS_SCAN_STATUSES,
} from '@photoo/shared';
import { describe, expect, it } from 'vitest';
import {
  AuditActorType,
  ConsentPurpose,
  DevicePlatform,
  Locale,
  NotificationChannel,
  UploadPurpose,
  UploadStatus,
  UserRole,
  UserStatus,
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
});
