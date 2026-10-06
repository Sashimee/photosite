export type PayoutsState = 'notStarted' | 'incomplete' | 'enabled';

export function payoutsState(profile: {
  stripeOnboardingComplete: boolean;
  stripePayoutsEnabled: boolean;
}): PayoutsState {
  if (profile.stripePayoutsEnabled) {
    return 'enabled';
  }
  return profile.stripeOnboardingComplete ? 'incomplete' : 'notStarted';
}
