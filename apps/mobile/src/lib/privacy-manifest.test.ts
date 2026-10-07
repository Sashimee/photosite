import { describe, expect, it } from '@jest/globals';

import config from '../../app.config';

const manifest = config.ios?.privacyManifests;

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
