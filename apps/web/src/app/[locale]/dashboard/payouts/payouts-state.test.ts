import { describe, expect, it } from 'vitest';

import { payoutsState } from './payouts-state';

describe('payoutsState', () => {
  it.each([
    [false, false, false, 'notStarted'],
    [true, false, false, 'incomplete'],
    [false, false, true, 'incomplete'],
    [true, false, true, 'incomplete'],
    [true, true, true, 'enabled'],
    [false, true, false, 'enabled'],
    [false, true, true, 'enabled'],
  ] as const)(
    'maps onboardingComplete=%s payoutsEnabled=%s accountConnected=%s to %s',
    (stripeOnboardingComplete, stripePayoutsEnabled, stripeAccountConnected, expected) => {
      expect(
        payoutsState({ stripeOnboardingComplete, stripePayoutsEnabled, stripeAccountConnected }),
      ).toBe(expected);
    },
  );
});
