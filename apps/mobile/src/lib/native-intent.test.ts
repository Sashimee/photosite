import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as stripe from '@stripe/stripe-react-native';

import { redirectSystemPath } from '../../app/+native-intent';

const mockedHandle = jest.mocked(stripe.handleURLCallback);

beforeEach(() => {
  jest.resetAllMocks();
  mockedHandle.mockResolvedValue(true);
});

describe('redirectSystemPath', () => {
  it.each([
    'photoo://stripe-redirect',
    'photoo://stripe-redirect?payment_intent=pi_1&redirect_status=succeeded',
    '/stripe-redirect?redirect_status=succeeded',
    'photoo://stripe-redirect/',
  ])('hands %s to Stripe and stays on the current screen', async (url) => {
    await expect(redirectSystemPath({ path: url, initial: false })).resolves.toBeNull();
    expect(mockedHandle).toHaveBeenCalledWith(url);
  });

  it.each([
    '/bookings/b1',
    'photoo://bookings/b1',
    '/',
    'photoo://stripe-redirects',
    '/messages/stripe-redirect',
  ])('leaves %s untouched', (path) => {
    expect(redirectSystemPath({ path, initial: true })).toBe(path);
    expect(mockedHandle).not.toHaveBeenCalled();
  });

  it('still returns null when Stripe throws, instead of crashing the app', async () => {
    mockedHandle.mockRejectedValue(new Error('native module not ready'));

    await expect(
      redirectSystemPath({ path: 'photoo://stripe-redirect?x=1', initial: true }),
    ).resolves.toBeNull();
  });
});
