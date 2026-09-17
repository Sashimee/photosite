import type { VerificationStatus } from '@photoo/shared';

export interface PublishablePhotographerProfile {
  verificationStatus: VerificationStatus;
  stripePayoutsEnabled: boolean;
}

// Single place for the DATA-MODEL.md invariant ("isPublished requires
// verificationStatus = verified and stripePayoutsEnabled = true"), so every
// caller that decides whether a profile can be published or must be
// unpublished (the future publish endpoint, and this step's
// reject-a-verified-photographer transition) checks the same thing instead
// of re-deriving it.
export const PublishPolicy = {
  canPublish(profile: PublishablePhotographerProfile): boolean {
    return profile.verificationStatus === 'verified' && profile.stripePayoutsEnabled;
  },
};
