import { describe, expect, it, vi } from 'vitest';

import { reportTargetLabel } from './report-target-label';

const t = vi.fn((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key,
);

describe('reportTargetLabel', () => {
  it("uses the profile's display name", () => {
    expect(
      reportTargetLabel(t, {
        targetType: 'photographer_profile',
        displayName: 'Jane Doe Photography',
        slug: 'jane-doe-photography',
        isPublished: true,
        deletedAt: null,
      }),
    ).toBe('Jane Doe Photography');
  });

  it("uses the request's title", () => {
    expect(
      reportTargetLabel(t, {
        targetType: 'request',
        title: 'Wedding photographer needed',
        description: 'Looking for someone in Luxembourg City.',
        deletedAt: null,
      }),
    ).toBe('Wedding photographer needed');
  });

  it("uses the job offer's title", () => {
    expect(
      reportTargetLabel(t, {
        targetType: 'job_offer',
        title: 'Second shooter for weddings',
        description: 'Weekend availability required.',
        companyName: 'Studio Lumière',
        deletedAt: null,
      }),
    ).toBe('Second shooter for weddings');
  });

  it('falls back to a generic label for a portfolio image, which has no name of its own', () => {
    expect(
      reportTargetLabel(t, {
        targetType: 'portfolio_image',
        url: 'https://media.example.com/image.jpg',
        width: 1200,
        height: 800,
        status: 'approved',
        deletedAt: null,
      }),
    ).toBe('target.portfolioImage.label');
  });

  it("names the job offer a job application is attached to, not the applicant's message", () => {
    expect(
      reportTargetLabel(t, {
        targetType: 'job_application',
        message: 'I would love to shoot this event.',
        jobOfferTitle: 'Second shooter for weddings',
        deletedAt: null,
      }),
    ).toBe('target.jobApplication.label:{"jobOfferTitle":"Second shooter for weddings"}');
  });
});
