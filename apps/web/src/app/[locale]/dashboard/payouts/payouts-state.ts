export type PayoutsState = 'notStarted' | 'incomplete' | 'enabled';

export function payoutsState(profile: {
  stripeOnboardingComplete: boolean;
  stripePayoutsEnabled: boolean;
  stripeAccountConnected: boolean;
}): PayoutsState {
  if (profile.stripePayoutsEnabled) {
    return 'enabled';
  }
  return profile.stripeOnboardingComplete || profile.stripeAccountConnected
    ? 'incomplete'
    : 'notStarted';
}
