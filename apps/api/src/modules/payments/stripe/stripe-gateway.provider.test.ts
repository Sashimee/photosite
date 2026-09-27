import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { FakeStripeGateway } from './fake-stripe-gateway.js';
import { LiveStripeGateway } from './live-stripe-gateway.js';
import { createStripeGateway } from './stripe-gateway.provider.js';

function logger(warn = vi.fn()) {
  return { log: vi.fn(), warn } as unknown as Logger;
}

describe('createStripeGateway', () => {
  it('returns the live gateway when STRIPE_SECRET_KEY is set', () => {
    const gateway = createStripeGateway(
      {
        NODE_ENV: 'development',
        STRIPE_SECRET_KEY: 'sk_test_unit',
        STRIPE_WEBHOOK_SECRET: 'whsec_unit',
      },
      logger(),
    );
    expect(gateway).toBeInstanceOf(LiveStripeGateway);
  });

  it('returns the live gateway in production when the key is set', () => {
    const gateway = createStripeGateway(
      {
        NODE_ENV: 'production',
        STRIPE_SECRET_KEY: 'sk_test_unit',
        STRIPE_WEBHOOK_SECRET: 'whsec_unit',
      },
      logger(),
    );
    expect(gateway).toBeInstanceOf(LiveStripeGateway);
  });

  it.each(['development', 'test'] as const)(
    'falls back to the fake gateway with a warning in %s without a key',
    (nodeEnv) => {
      const warn = vi.fn();
      const gateway = createStripeGateway(
        { NODE_ENV: nodeEnv, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined },
        logger(warn),
      );
      expect(gateway).toBeInstanceOf(FakeStripeGateway);
      expect(warn).toHaveBeenCalledOnce();
    },
  );

  it('refuses to boot in production without a key', () => {
    expect(() =>
      createStripeGateway(
        {
          NODE_ENV: 'production',
          STRIPE_SECRET_KEY: undefined,
          STRIPE_WEBHOOK_SECRET: 'whsec_unit',
        },
        logger(),
      ),
    ).toThrow(/STRIPE_SECRET_KEY is required when NODE_ENV=production/);
  });
});
