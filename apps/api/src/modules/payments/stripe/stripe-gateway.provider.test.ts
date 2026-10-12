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
        STRIPE_FAKE: false,
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
        STRIPE_FAKE: false,
        STRIPE_SECRET_KEY: 'sk_test_unit',
        STRIPE_WEBHOOK_SECRET: 'whsec_unit',
      },
      logger(),
    );
    expect(gateway).toBeInstanceOf(LiveStripeGateway);
  });

  it.each(['development', 'test'] as const)(
    'returns the fake gateway with a warning in %s when STRIPE_FAKE is set',
    (nodeEnv) => {
      const warn = vi.fn();
      const gateway = createStripeGateway(
        {
          NODE_ENV: nodeEnv,
          STRIPE_FAKE: true,
          STRIPE_SECRET_KEY: undefined,
          STRIPE_WEBHOOK_SECRET: 'whsec_unit',
        },
        logger(warn),
      );
      expect(gateway).toBeInstanceOf(FakeStripeGateway);
      expect(warn).toHaveBeenCalledOnce();
    },
  );

  it.each(['development', 'test'] as const)(
    'refuses to fall back to the fake in %s without STRIPE_FAKE',
    (nodeEnv) => {
      expect(() =>
        createStripeGateway(
          {
            NODE_ENV: nodeEnv,
            STRIPE_FAKE: false,
            STRIPE_SECRET_KEY: undefined,
            STRIPE_WEBHOOK_SECRET: undefined,
          },
          logger(),
        ),
      ).toThrow(/set STRIPE_FAKE=true to use the in-memory fake outside production/);
    },
  );

  it('refuses the fake in production even when STRIPE_FAKE is set', () => {
    expect(() =>
      createStripeGateway(
        {
          NODE_ENV: 'production',
          STRIPE_FAKE: true,
          STRIPE_SECRET_KEY: undefined,
          STRIPE_WEBHOOK_SECRET: 'whsec_unit',
        },
        logger(),
      ),
    ).toThrow(/STRIPE_SECRET_KEY is required when NODE_ENV=production/);
  });

  it('refuses STRIPE_FAKE together with a key', () => {
    expect(() =>
      createStripeGateway(
        {
          NODE_ENV: 'development',
          STRIPE_FAKE: true,
          STRIPE_SECRET_KEY: 'sk_test_unit',
          STRIPE_WEBHOOK_SECRET: 'whsec_unit',
        },
        logger(),
      ),
    ).toThrow(/STRIPE_FAKE and STRIPE_SECRET_KEY are both set/);
  });

  it('refuses to boot in production without a key', () => {
    expect(() =>
      createStripeGateway(
        {
          NODE_ENV: 'production',
          STRIPE_FAKE: false,
          STRIPE_SECRET_KEY: undefined,
          STRIPE_WEBHOOK_SECRET: 'whsec_unit',
        },
        logger(),
      ),
    ).toThrow(/STRIPE_SECRET_KEY is required when NODE_ENV=production/);
  });
});
