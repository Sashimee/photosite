import { describe, expect, it } from 'vitest';
import type { CollectedExport } from './collect.js';
import { buildManifest } from './manifest.js';

function fakeCollected(overrides: Partial<CollectedExport> = {}): CollectedExport {
  return {
    user: {
      id: 'u1',
      email: 'u1@photoo.test',
      emailVerifiedAt: null,
      name: null,
      locale: 'en',
      countryCode: 'LU',
      roles: [],
      status: 'active',
      twoFactorEnabled: false,
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    accounts: [],
    sessions: [],
    devices: [],
    consents: [],
    notifications: [],
    requests: [],
    quotes: [],
    photographerProfile: null,
    professionalProfile: null,
    jobOffers: [],
    jobApplications: [],
    products: [],
    portfolioImages: [],
    uploads: [],
    verificationCases: [],
    messages: [{} as never, {} as never],
    files: [],
    ...overrides,
  };
}

describe('buildManifest', () => {
  it('counts every section and records the policy version', () => {
    const manifest = buildManifest(fakeCollected(), '12');

    expect(manifest.policyVersion).toBe('12');
    expect(manifest.files['user.json']).toBe(1);
    expect(manifest.files['messages.json']).toBe(2);
    expect(manifest.files['photographer-profile.json']).toBe(0);
    expect(typeof manifest.generatedAt).toBe('string');
  });

  it('records photographer-profile.json as 1 row when a profile exists', () => {
    const manifest = buildManifest(fakeCollected({ photographerProfile: {} as never }), null);

    expect(manifest.files['photographer-profile.json']).toBe(1);
    expect(manifest.policyVersion).toBeNull();
  });

  it('records professional-profile.json and job-applications.json counts', () => {
    const manifest = buildManifest(
      fakeCollected({
        professionalProfile: {} as never,
        jobApplications: [{} as never, {} as never, {} as never],
      }),
      null,
    );

    expect(manifest.files['professional-profile.json']).toBe(1);
    expect(manifest.files['job-applications.json']).toBe(3);
  });

  it('records job-offers.json count', () => {
    const manifest = buildManifest(fakeCollected({ jobOffers: [{} as never, {} as never] }), null);

    expect(manifest.files['job-offers.json']).toBe(2);
  });
});
