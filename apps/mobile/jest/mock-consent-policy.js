/* global jest */
// Plain function, not jest.fn: suites that call jest.resetAllMocks() would wipe
// a jest.fn implementation. Keeps the root layout's consent provider from
// consuming the sequential api.GET mocks that screen tests queue up.
jest.mock('../src/lib/consent-sync', () => ({
  ...jest.requireActual('../src/lib/consent-sync'),
  fetchPolicyVersion: () => Promise.resolve(null),
}));
