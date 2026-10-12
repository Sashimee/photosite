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

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
