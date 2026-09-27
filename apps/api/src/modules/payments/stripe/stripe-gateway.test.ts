import { describe, expect, it } from 'vitest';
import { parseConnectedAccount } from './stripe-gateway.js';

describe('parseConnectedAccount', () => {
  it('maps a Stripe account object to camelCase flags', () => {
    expect(
      parseConnectedAccount({
        id: 'acct_123',
        object: 'account',
        charges_enabled: true,
        payouts_enabled: false,
        details_submitted: true,
      }),
    ).toEqual({
      id: 'acct_123',
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
  });

  it('rejects an id that is not a connected account', () => {
    expect(() =>
      parseConnectedAccount({
        id: 'cus_123',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
    ).toThrow();
  });

  it('rejects an object with a missing flag', () => {
    expect(() =>
      parseConnectedAccount({ id: 'acct_123', charges_enabled: true, details_submitted: true }),
    ).toThrow();
  });
});
