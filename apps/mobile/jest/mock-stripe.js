/* global jest */
// Based on the package's bundled mock. useStripe and StripeProvider are plain
// functions so suites that call jest.resetAllMocks() keep rendering; the
// underlying functions stay jest.fn and are driven per test.
jest.mock('@stripe/stripe-react-native', () => {
  const bundled = jest.requireActual('@stripe/stripe-react-native/jest/mock');
  const providerProps = [];
  return {
    ...bundled,
    providerProps,
    StripeProvider: ({ children, ...props }) => {
      providerProps.push(props);
      return children;
    },
    useStripe: () => ({
      retrievePaymentIntent: bundled.retrievePaymentIntent,
      initPaymentSheet: bundled.initPaymentSheet,
      presentPaymentSheet: bundled.presentPaymentSheet,
      handleURLCallback: bundled.handleURLCallback,
    }),
  };
});
