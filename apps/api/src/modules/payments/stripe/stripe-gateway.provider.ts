import type { Provider } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import Stripe from 'stripe';
import { APP_CONFIG, type Env } from '../../../config/env.js';
import { FakeStripeGateway } from './fake-stripe-gateway.js';
import { LiveStripeGateway } from './live-stripe-gateway.js';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe-gateway.js';

type StripeGatewayEnv = Pick<Env, 'NODE_ENV' | 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET'>;

export function createStripeGateway(env: StripeGatewayEnv, logger: Logger): StripeGateway {
  if (env.STRIPE_SECRET_KEY) {
    logger.log({ stripeGateway: 'live' }, 'stripe gateway selected');
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, typescript: true });
    return new LiveStripeGateway(stripe, env.STRIPE_WEBHOOK_SECRET, logger);
  }
  // loadEnv already rejects this; repeated here so the fake can never be
  // reached in production through a hand-built env.
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'stripe gateway: STRIPE_SECRET_KEY is required when NODE_ENV=production; set it in the API environment',
    );
  }
  logger.warn({ stripeGateway: 'fake' }, 'STRIPE_SECRET_KEY not set, using the in-memory fake');
  return new FakeStripeGateway(env.STRIPE_WEBHOOK_SECRET);
}

export const stripeGatewayProvider: Provider = {
  provide: STRIPE_GATEWAY,
  inject: [APP_CONFIG, Logger],
  useFactory: (env: Env, logger: Logger) => createStripeGateway(env, logger),
};
