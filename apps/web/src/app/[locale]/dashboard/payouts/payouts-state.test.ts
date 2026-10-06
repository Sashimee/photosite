import { describe, expect, it } from 'vitest';

import { payoutsState } from './payouts-state';

describe('payoutsState', () => {
  it.each([
    [false, false, 'notStarted'],
    [true, false, 'incomplete'],
    [true, true, 'enabled'],
    [false, true, 'enabled'],
  ] as const)(
    'maps onboardingComplete=%s payoutsEnabled=%s to %s',
    (stripeOnboardingComplete, stripePayoutsEnabled, expected) => {
      expect(payoutsState({ stripeOnboardingComplete, stripePayoutsEnabled })).toBe(expected);
    },
  );
});
