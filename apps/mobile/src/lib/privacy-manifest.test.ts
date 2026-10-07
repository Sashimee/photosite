import { describe, expect, it } from '@jest/globals';

import config from '../../app.config';

const manifest = config.ios?.privacyManifests;

const APPLE_COLLECTED_DATA_TYPES = [
  'NSPrivacyCollectedDataTypeName',
  'NSPrivacyCollectedDataTypeEmailAddress',
  'NSPrivacyCollectedDataTypePhoneNumber',
  'NSPrivacyCollectedDataTypePhysicalAddress',
  'NSPrivacyCollectedDataTypeOtherUserContactInfo',
  'NSPrivacyCollectedDataTypeHealth',
  'NSPrivacyCollectedDataTypeFitness',
  'NSPrivacyCollectedDataTypePaymentInfo',
  'NSPrivacyCollectedDataTypeCreditInfo',
  'NSPrivacyCollectedDataTypeOtherFinancialInfo',
  'NSPrivacyCollectedDataTypePreciseLocation',
  'NSPrivacyCollectedDataTypeCoarseLocation',
  'NSPrivacyCollectedDataTypeSensitiveInfo',
  'NSPrivacyCollectedDataTypeContacts',
  'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
  'NSPrivacyCollectedDataTypePhotosorVideos',
  'NSPrivacyCollectedDataTypeAudioData',
  'NSPrivacyCollectedDataTypeGameplayContent',
  'NSPrivacyCollectedDataTypeCustomerSupport',
  'NSPrivacyCollectedDataTypeOtherUserContent',
  'NSPrivacyCollectedDataTypeBrowsingHistory',
  'NSPrivacyCollectedDataTypeSearchHistory',
  'NSPrivacyCollectedDataTypeUserID',
  'NSPrivacyCollectedDataTypeDeviceID',
  'NSPrivacyCollectedDataTypePurchaseHistory',
  'NSPrivacyCollectedDataTypeProductInteraction',
  'NSPrivacyCollectedDataTypeAdvertisingData',
  'NSPrivacyCollectedDataTypeOtherUsageData',
  'NSPrivacyCollectedDataTypeCrashData',
  'NSPrivacyCollectedDataTypePerformanceData',
  'NSPrivacyCollectedDataTypeOtherDiagnosticData',
  'NSPrivacyCollectedDataTypeEnvironmentScanning',
  'NSPrivacyCollectedDataTypeHands',
  'NSPrivacyCollectedDataTypeHead',
  'NSPrivacyCollectedDataTypeOtherDataTypes',
];

describe('iOS privacy manifest', () => {
  it('declares no tracking and no tracking domains', () => {
    expect(manifest?.NSPrivacyTracking).toBe(false);
    expect(manifest?.NSPrivacyTrackingDomains).toEqual([]);
  });

  it('declares only documented required-reason codes', () => {
    expect(manifest?.NSPrivacyAccessedAPITypes).toEqual([
      {
        NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
        NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
      },
      {
        NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
        NSPrivacyAccessedAPITypeReasons: ['3B52.1'],
      },
    ]);
  });

  it('uses only valid Apple collected-data-type keys and pins the declared set', () => {
    const keys = (manifest?.NSPrivacyCollectedDataTypes ?? []).map(
      (entry) => entry.NSPrivacyCollectedDataType,
    );
    expect(keys.filter((key) => !APPLE_COLLECTED_DATA_TYPES.includes(key))).toEqual([]);
    expect([...keys].sort()).toEqual(
      [
        'NSPrivacyCollectedDataTypeEmailAddress',
        'NSPrivacyCollectedDataTypeName',
        'NSPrivacyCollectedDataTypePhysicalAddress',
        'NSPrivacyCollectedDataTypePreciseLocation',
        'NSPrivacyCollectedDataTypeCoarseLocation',
        'NSPrivacyCollectedDataTypePhotosorVideos',
        'NSPrivacyCollectedDataTypeEmailsOrTextMessages',
        'NSPrivacyCollectedDataTypeOtherUserContent',
        'NSPrivacyCollectedDataTypePaymentInfo',
        'NSPrivacyCollectedDataTypePurchaseHistory',
        'NSPrivacyCollectedDataTypeUserID',
        'NSPrivacyCollectedDataTypeDeviceID',
        'NSPrivacyCollectedDataTypeCrashData',
        'NSPrivacyCollectedDataTypeOtherDiagnosticData',
      ].sort(),
    );
  });

  it('never marks a collected data type as used for tracking', () => {
    const collected = manifest?.NSPrivacyCollectedDataTypes ?? [];
    expect(collected.length).toBeGreaterThan(0);
    expect(collected.some((entry) => entry.NSPrivacyCollectedDataTypeTracking)).toBe(false);
  });

  it('keeps crash and diagnostic data unlinked from the account', () => {
    const unlinked = (manifest?.NSPrivacyCollectedDataTypes ?? [])
      .filter((entry) => !entry.NSPrivacyCollectedDataTypeLinked)
      .map((entry) => entry.NSPrivacyCollectedDataType);
    expect(unlinked).toEqual([
      'NSPrivacyCollectedDataTypeCrashData',
      'NSPrivacyCollectedDataTypeOtherDiagnosticData',
    ]);
  });
});
