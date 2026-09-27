import type { Provider } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import Stripe from 'stripe';
import { APP_CONFIG, type Env } from '../../../config/env.js';
import { FakeStripeGateway } from './fake-stripe-gateway.js';
import { LiveStripeGateway } from './live-stripe-gateway.js';
import { STRIPE_GATEWAY, type StripeGateway } from './stripe-gateway.js';

type StripeGatewayEnv = Pick<
  Env,
  'NODE_ENV' | 'STRIPE_FAKE' | 'STRIPE_SECRET_KEY' | 'STRIPE_WEBHOOK_SECRET'
>;

export function createStripeGateway(env: StripeGatewayEnv, logger: Logger): StripeGateway {
  // loadEnv already rejects these combinations; repeated here so the fake can
  // never be reached through a hand-built env.
  if (env.STRIPE_FAKE && env.STRIPE_SECRET_KEY) {
    throw new Error(
      'stripe gateway: STRIPE_FAKE and STRIPE_SECRET_KEY are both set; unset one of them',
    );
  }
  if (env.STRIPE_SECRET_KEY) {
    logger.log({ stripeGateway: 'live' }, 'stripe gateway selected');
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, typescript: true });
    return new LiveStripeGateway(stripe, env.STRIPE_WEBHOOK_SECRET, logger);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'stripe gateway: STRIPE_SECRET_KEY is required when NODE_ENV=production; set it in the API environment',
    );
  }
  if (!env.STRIPE_FAKE) {
    throw new Error(
      'stripe gateway: STRIPE_SECRET_KEY is not set; set it, or set STRIPE_FAKE=true to use the in-memory fake outside production',
    );
  }
  logger.warn({ stripeGateway: 'fake' }, 'STRIPE_FAKE=true, using the in-memory fake');
  return new FakeStripeGateway(env.STRIPE_WEBHOOK_SECRET);
}

export const stripeGatewayProvider: Provider = {
  provide: STRIPE_GATEWAY,
  inject: [APP_CONFIG, Logger],
  useFactory: (env: Env, logger: Logger) => createStripeGateway(env, logger),
};
