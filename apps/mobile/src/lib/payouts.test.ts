import { describe, expect, it } from '@jest/globals';

import { isHttpsUrl, payoutsState, type PayoutsState } from './payouts';

describe('payoutsState', () => {
  it.each<[boolean, boolean, boolean, PayoutsState]>([
    [false, false, false, 'notStarted'],
    [true, false, false, 'incomplete'],
    [false, false, true, 'incomplete'],
    [true, false, true, 'incomplete'],
    [true, true, true, 'enabled'],
    [false, true, false, 'enabled'],
    [false, true, true, 'enabled'],
  ])(
    'maps onboardingComplete=%s payoutsEnabled=%s accountConnected=%s to %s',
    (stripeOnboardingComplete, stripePayoutsEnabled, stripeAccountConnected, expected) => {
      expect(
        payoutsState({ stripeOnboardingComplete, stripePayoutsEnabled, stripeAccountConnected }),
      ).toBe(expected);
    },
  );
});

describe('isHttpsUrl', () => {
  it('accepts an https url', () => {
    expect(isHttpsUrl('https://connect.stripe.com/setup/e/acct_1/abc')).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['a number', 42],
    ['an empty string', ''],
    ['http', 'http://connect.stripe.com/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['a relative path', '/studio/payouts'],
    ['a custom scheme', 'photoo://payouts'],
  ])('rejects %s', (_label, value) => {
    expect(isHttpsUrl(value)).toBe(false);
  });
});
