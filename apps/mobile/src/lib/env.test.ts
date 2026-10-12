import { afterEach, describe, expect, it, jest } from '@jest/globals';

const originalEnv = process.env;

function loadWith(values: Record<string, string>) {
  jest.resetModules();
  const base = Object.fromEntries(
    Object.entries(originalEnv).filter(([key]) => !key.startsWith('EXPO_PUBLIC_STRIPE')),
  );
  process.env = { ...base, ...values } as NodeJS.ProcessEnv;
  return jest.requireActual<typeof import('./env')>('./env').env;
}

afterEach(() => {
  process.env = originalEnv;
});

describe('stripe env', () => {
  it('leaves both unset by default', () => {
    const env = loadWith({});
    expect(env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER).toBeUndefined();
  });

  it('accepts a test key and a merchant identifier', () => {
    const env = loadWith({
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_abc123',
      EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER: 'merchant.lu.photoo.app',
    });
    expect(env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY).toBe('pk_test_abc123');
    expect(env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER).toBe('merchant.lu.photoo.app');
  });

  it('rejects a live publishable key loudly', () => {
    expect(() => loadWith({ EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_abc123' })).toThrow(
      /EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY.*pk_test_/,
    );
  });

  it('rejects a merchant identifier without the merchant. prefix', () => {
    expect(() => loadWith({ EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER: 'lu.photoo.app' })).toThrow(
      /EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER/,
    );
  });
});
