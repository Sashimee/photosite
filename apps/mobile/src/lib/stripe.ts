import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import type { PaymentSheet } from '@stripe/stripe-react-native';

// The platform Stripe account's country (docs/steps/1C.6-mobile-payments.md, O2), not the buyer's.
export const STRIPE_MERCHANT_COUNTRY_CODE = 'LU';
export const STRIPE_REDIRECT_PATH = 'stripe-redirect';
export const PAYMENT_POLL_DELAYS_MS: readonly number[] = [2000, 4000, 8000, 16000, 32000];

// The native SDK reports PaymentIntent statuses in PascalCase, unlike stripe-js.
const IN_FLIGHT_PAYMENT_INTENT_STATUSES: ReadonlySet<string> = new Set([
  'Processing',
  'Succeeded',
  'RequiresCapture',
]);

const STRIPE_REDIRECT_URL = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/?stripe-redirect(?:[/?#]|$)/i;

export function isPaymentIntentInFlight(status: string): boolean {
  return IN_FLIGHT_PAYMENT_INTENT_STATUSES.has(status);
}

export function isStripeRedirect(url: string): boolean {
  return STRIPE_REDIRECT_URL.test(url);
}

export function appUrlScheme(): string | undefined {
  const scheme = Constants.expoConfig?.scheme;
  return typeof scheme === 'string' ? scheme : undefined;
}

export function paymentSheetParams(
  clientSecret: string,
  merchantIdentifier: string | undefined,
): PaymentSheet.SetupParams {
  return {
    paymentIntentClientSecret: clientSecret,
    merchantDisplayName: 'Photoo',
    returnURL: Linking.createURL(STRIPE_REDIRECT_PATH),
    ...(merchantIdentifier
      ? { applePay: { merchantCountryCode: STRIPE_MERCHANT_COUNTRY_CODE } }
      : {}),
    googlePay: { merchantCountryCode: STRIPE_MERCHANT_COUNTRY_CODE, testEnv: true },
    allowsDelayedPaymentMethods: false,
  };
}
