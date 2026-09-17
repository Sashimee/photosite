import { describe, expect, it } from 'vitest';
import { PublishPolicy } from './publish-policy.js';

describe('PublishPolicy.canPublish', () => {
  it('requires both verified status and enabled Stripe payouts', () => {
    expect(
      PublishPolicy.canPublish({ verificationStatus: 'verified', stripePayoutsEnabled: true }),
    ).toBe(true);
  });

  it('refuses when verification is not verified', () => {
    expect(
      PublishPolicy.canPublish({ verificationStatus: 'pending', stripePayoutsEnabled: true }),
    ).toBe(false);
  });

  it('refuses when Stripe payouts are not enabled yet', () => {
    expect(
      PublishPolicy.canPublish({ verificationStatus: 'verified', stripePayoutsEnabled: false }),
    ).toBe(false);
  });

  it('refuses when neither condition holds', () => {
    expect(
      PublishPolicy.canPublish({ verificationStatus: 'unverified', stripePayoutsEnabled: false }),
    ).toBe(false);
  });
});
