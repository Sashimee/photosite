import { loadStripe, type Stripe } from '@stripe/stripe-js';

import { env } from './env';

let stripePromise: Promise<Stripe | null> | undefined;

// Memoized per Stripe's guidance (call loadStripe once, module scope) to
// avoid re-fetching js.stripe.com on every mount. Resolves null when no
// publishable key is configured (local STRIPE_FAKE stack, CI) so callers
// show "payment is not available" instead of mounting Elements against a
// key that doesn't exist.
export function getStripe(): Promise<Stripe | null> {
  if (!env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
    return Promise.resolve(null);
  }
  stripePromise ??= loadStripe(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
}
