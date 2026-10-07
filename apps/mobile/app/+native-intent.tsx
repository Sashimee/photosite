import { handleURLCallback } from '@stripe/stripe-react-native';

import { isStripeRedirect } from '../src/lib/stripe';

// Synchronous for every path but Stripe's: an async hook here delays the first render.
// The redirect URL carries the PaymentIntent client secret, so a failure is swallowed
// rather than reported; a throw out of this hook crashes the app.
async function handleStripeRedirect(url: string): Promise<null> {
  try {
    await handleURLCallback(url);
  } catch {
    return null;
  }
  return null;
}

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string | Promise<string | null> {
  return isStripeRedirect(path) ? handleStripeRedirect(path) : path;
}
