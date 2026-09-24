import type { CollectedExport } from './collect.js';

export interface ExportManifest {
  generatedAt: string;
  policyVersion: string | null;
  files: Record<string, number>;
}

export function buildManifest(data: CollectedExport, policyVersion: string | null): ExportManifest {
  return {
    generatedAt: new Date().toISOString(),
    policyVersion,
    files: {
      'user.json': 1,
      'accounts.json': data.accounts.length,
      'sessions.json': data.sessions.length,
      'devices.json': data.devices.length,
      'consents.json': data.consents.length,
      'notifications.json': data.notifications.length,
      'requests.json': data.requests.length,
      'quotes.json': data.quotes.length,
      'photographer-profile.json': data.photographerProfile ? 1 : 0,
      'professional-profile.json': data.professionalProfile ? 1 : 0,
      'job-offers.json': data.jobOffers.length,
      'job-applications.json': data.jobApplications.length,
      'products.json': data.products.length,
      'portfolio-images.json': data.portfolioImages.length,
      'uploads.json': data.uploads.length,
      'verification-cases.json': data.verificationCases.length,
      'messages.json': data.messages.length,
    },
  };
}
